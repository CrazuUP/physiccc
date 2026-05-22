var right_menu_h = {
    id: -2,

    update_entity() {
        var nid=canvas_events.selected_entity;
        if(nid===right_menu_h.id){ right_menu_h.change_info(); return; }
        right_menu_h.id=nid;
        if(nid<0) right_menu_h.open_setup();
        else       right_menu_h.open_entity();
    },

    change_info(read_only) {
        var before=read_only===true?null:canvas_events.history.serialize();
        var get=id=>{ var el=document.getElementById(id); return el?el.value:null; };
        var set=(id,v)=>{ var el=document.getElementById(id); if(el) el.value=v; };
        var sync=(id,obj,key,ro)=>{
            var readonly=ro&&read_only===true;
            if(readonly){
                set(id,typeof obj[key]==='number'?+obj[key].toPrecision(6):obj[key]);
            } else {
                var val=get(id); if(val===null) return;
                if(!is_valid_float(val)) set(id,obj[key]);
                else obj[key]=parseFloat(val);
            }
            var el=document.getElementById(id); if(el) el.disabled=readonly;
        };

        if(right_menu_h.id<0){
            sync('rm_eps',engine_info.constants,'eps');
            var e_el=document.getElementById('rm_e');    if(e_el)  engine_info.constants.e    =parseFloat(e_el.value);
            var m_el=document.getElementById('rm_m');    if(m_el)  engine_info.constants.m    =parseFloat(m_el.value);
            var sc_el=document.getElementById('rm_scale');if(sc_el) engine_info.constants.scale=parseFloat(sc_el.value);
        } else {
            var obj=engine_info.get_entities()[right_menu_h.id]; if(!obj) return;
            if(obj.type==='q'){
                sync('rm_q',obj,'q');
                sync('rm_x',obj,'x',true); sync('rm_y',obj,'y',true);
                sync('rm_vx',obj,'vx',true); sync('rm_vy',obj,'vy',true);
                sync('rm_m',obj,'m');
                var ic=document.getElementById('rm_is_const'); if(ic) obj.is_const=(ic.value==='true');
            } else if(obj.type==='p'){
                var dl={circle:3,rectangle:4,ring:4}[obj.shape]||4;
                for(var k=0;k<dl;k++) sync('rm_d'+k,obj.data,k);
                if(!Number.isFinite(obj.Q_total)) obj.Q_total=0;
                sync('rm_p_qtotal',obj,'Q_total');
            }
        }

        if(read_only!==true){
            var after=canvas_events.history.serialize();
            if(!canvas_events.history.equal(before,after)) canvas_events.history.push(before);
            engine_info.change();
            // НЕ вызываем after_scene_change — она сбрасывает right_menu_h.id и выбор.
            canvas_events.need_repaint();
        }
    },

    open_setup() {
        var c=engine_info.constants;
        right_menu.innerHTML=
            `<div class="right_menu_id">Глобальные настройки</div>`+
            `<div class="right_menu_data">`+
            `Единица заряда:<br>`+right_menu_h.mkselect('rm_e',c.e,[1e9,1e6,1e3,1,1e-3,1e-6,1e-9],['ГКл','МКл','кКл','Кл','мКл','мкКл','нКл'])+`<br>`+
            `k (Н·м²/Кл²):<br><input type="text" id="rm_eps" onchange="setTimeout(right_menu_h.change_info)"><br>`+
            `Единица массы:<br>`+right_menu_h.mkselect('rm_m',c.m,[1e6,1e3,1,1e-3,1e-6,1e-9],['Гг','Мг','кг','г','мг','мкг'])+`<br>`+
            `Единица расстояния:<br>`+right_menu_h.mkselect('rm_scale',c.scale,[1e9,1e6,1e3,1,1e-3,1e-6,1e-9],['Гм','Мм','км','м','мм','мкм','нм'])+
            `</div>`;
        setTimeout(right_menu_h.change_info);
    },

    open_entity() {
        var obj=engine_info.get_entities()[right_menu_h.id]; if(!obj) return;
        var html=`<div class="right_menu_id">ID: <var>${right_menu_h.id}</var></div>`;
        var inp=(id,label)=>`${label}:<br><input type="text" id="${id}" onchange="setTimeout(right_menu_h.change_info)"><br>`;

        if(obj.type==='q'){
            html+=
                `<div class="right_menu_const_data">Тип: <var>Точечный заряд</var></div>`+
                `<div class="right_menu_data">`+
                inp('rm_q','Заряд q')+inp('rm_x','X')+inp('rm_y','Y')+
                `Положение: `+right_menu_h.mkselect('rm_is_const',obj.is_const,[true,false],['фиксировано','подвижно'])+`<br>`+
                inp('rm_vx','Скорость Vx')+inp('rm_vy','Скорость Vy')+inp('rm_m','Масса m')+
                `</div>`;
        } else if(obj.type==='p'){
            var sname={rectangle:'Прямоугольник',circle:'Круг',ring:'Кольцо'}[obj.shape];
            var labels={
                rectangle:['X левого края','Y верхнего края','Ширина','Высота'],
                circle:   ['Центр X','Центр Y','Радиус'],
                ring:     ['Центр X','Центр Y','Радиус внутр.','Радиус внешн.'],
            }[obj.shape];
            html+=
                `<div class="right_menu_const_data">Тип: <var>Проводник</var><br>Форма: <var>${sname}</var></div>`+
                `<div class="right_menu_data">`+
                labels.map((l,k)=>inp('rm_d'+k,l)).join('')+
                inp('rm_p_qtotal','Суммарный заряд Q')+
                `</div>`;

            var bem=engine_info.get_bem_charges(), segs=bem[right_menu_h.id];
            if(segs&&segs.length){
                var qsum=segs.reduce((a,s)=>a+s.q,0);
                var smax=Math.max(...segs.map(s=>Math.abs(s.sigma)));
                html+=
                    `<div class="right_menu_const_data" style="font-size:11px;margin-top:4px">`+
                    `BEM-сегменты: ${segs.length}<br>`+
                    `Q заданный = ${(Number.isFinite(obj.Q_total)?obj.Q_total:0).toExponential(2)} e<br>`+
                    `∑q инд. = ${qsum.toExponential(2)}<br>`+
                    `|σ|_max = ${smax.toExponential(2)} e/м`+
                    `</div>`;
            }
        }

        html+=`<div class="right_menu_buttons"><input type="button" value="Удалить объект" onclick="right_menu_h.remove()"></div>`;
        right_menu.innerHTML=html;
        setTimeout(right_menu_h.change_info);
    },

    remove() {
        var id = right_menu_h.id;
        if (id < 0) return;                              // нечего удалять
        var ents = engine_info.get_entities();
        if (id >= ents.length) return;                   // индекс устарел

        canvas_events.history.push();                    // сохранить состояние ДО удаления
        engine_info.set_entities(ents.filter((_, i) => i !== id));
        canvas_events.selected_entity = -1;
        right_menu_h.id = -2;                            // сбросить до перерисовки
        engine_info.change();
        canvas_events.need_repaint();
        right_menu_h.update_entity();                    // покажет глобальные настройки
    },

    mkselect(id, value, options, texts) {
        var best=0;
        if(value!==true&&value!==false)
            options.forEach((o,i)=>{ if(Math.abs(o-value)<Math.abs(options[best]-value)) best=i; });
        var opts=options.map((o,i)=>{
            var sel=(value===true||value===false)?(o===value):(i===best);
            return `<option value="${o}"${sel?' selected':''}>${texts[i]}</option>`;
        }).join('');
        return `<select id="${id}" onchange="setTimeout(right_menu_h.change_info)">${opts}</select>`;
    },
};

_onload.push(right_menu_h.update_entity);

// ── Delete / Backspace — удалить выбранный объект ─────────────────────────
_onload.push(function() {
    document.addEventListener('keydown', function(ev) {
        if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
        var tgt = ev.target;
        if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
        if (right_menu_h.id >= 0) {
            ev.preventDefault();
            right_menu_h.remove();
        }
    });
});
