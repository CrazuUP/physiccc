/* ============================================================
   right_menu.js  —  панель свойств выбранного объекта
   ============================================================ */

var right_menu_h = {
  id: -2,  // -1 = глобальные настройки, >=0 = индекс сущности

  update_entity: () => {
    var nid = canvas_events.selected_entity;
    if (nid === right_menu_h.id) {
      right_menu_h.change_info();
      return;
    }
    right_menu_h.id = nid;
    if (nid < 0) right_menu_h.open_setup();
    else          right_menu_h.open_entity();
  },

  // ── Синхронизация данных с DOM ────────────────────────────────────────
  change_info: (read_only_mode) => {
    // read_only_mode=true: только обновляем дисплей (во время симуляции)
    var before_state = read_only_mode === true ? null : canvas_events.history.serializeState();
    var get  = id => { var el = document.getElementById(id); return el ? el.value : null; };
    var set  = (id, v) => { var el = document.getElementById(id); if (el) el.value = v; };
    var sync = (id, obj, key, always_readonly) => {
      // Если read_only_mode И поле помечено как readonly — только показываем, не меняем
      var readonly = always_readonly && read_only_mode === true;
      if (readonly) {
        set(id, typeof obj[key] === 'number' ? +obj[key].toPrecision(6) : obj[key]);
      } else {
        var val = get(id);
        if (val === null) return;
        if (!is_valid_float(val)) set(id, obj[key]);
        else obj[key] = parseFloat(val);
      }
      var el = document.getElementById(id);
      if (el) el.disabled = readonly;
    };

    // ── Глобальные настройки ─────────────────────────────────────────
    if (right_menu_h.id < 0) {
      sync('rm_eps', engine_info.constants, 'eps');
      var e_el = document.getElementById('rm_e');
      if (e_el) engine_info.constants.e = parseFloat(e_el.value);
      var m_el = document.getElementById('rm_m');
      if (m_el) engine_info.constants.m = parseFloat(m_el.value);
      var sc_el = document.getElementById('rm_scale');
      if (sc_el) engine_info.constants.scale = parseFloat(sc_el.value);

    // ── Сущность ─────────────────────────────────────────────────────
    } else {
      var obj = engine_info.get_entities()[right_menu_h.id];
      if (!obj) return;

      if (obj.type === 'q') {
        sync('rm_q', obj, 'q');
        sync('rm_x', obj, 'x', true);   // readonly во время симуляции
        sync('rm_y', obj, 'y', true);
        sync('rm_vx', obj, 'vx', true);
        sync('rm_vy', obj, 'vy', true);
        sync('rm_m', obj, 'm');
        var is_c = document.getElementById('rm_is_const');
        if (is_c) obj.is_const = (is_c.value === 'true');

      } else if (obj.type === 'p') {
        var data_len = { circle:3, rectangle:4, ring:4 }[obj.shape] || 4;
        for (var k = 0; k < data_len; k++) sync('rm_d' + k, obj.data, k);
        if (!Number.isFinite(obj.Q_total)) obj.Q_total = 0;
        sync('rm_p_qtotal', obj, 'Q_total');
      }
    }

    if (read_only_mode !== true) {
      var after_state = canvas_events.history.serializeState();
      if (!canvas_events.history.statesEqual(before_state, after_state))
        canvas_events.history.push(before_state);
      engine_info.change();
      canvas_events.after_scene_change();
      canvas_events.need_repaint();
    }
  },

  // ── Глобальные настройки ──────────────────────────────────────────────
  open_setup: () => {
    var c = engine_info.constants;
    right_menu.innerHTML =
      `<div class="right_menu_id">Глобальные настройки</div>` +
      `<div class="right_menu_data">` +
        `Единица заряда:<br>` + right_menu_h.mkselect('rm_e', c.e,
          [1e9,1e6,1e3,1,1e-3,1e-6,1e-9],
          ['ГКл','МКл','кКл','Кл','мКл','мкКл','нКл']) + `<br>` +
        `k (Н·м²/Кл²):<br><input type="text" id="rm_eps" onchange="setTimeout(right_menu_h.change_info)"><br>` +
        `Единица массы:<br>` + right_menu_h.mkselect('rm_m', c.m,
          [1e6,1e3,1,1e-3,1e-6,1e-9],
          ['Гг','Мг','кг','г','мг','мкг']) + `<br>` +
        `Единица расстояния:<br>` + right_menu_h.mkselect('rm_scale', c.scale,
          [1e9,1e6,1e3,1,1e-3,1e-6,1e-9],
          ['Гм','Мм','км','м','мм','мкм','нм']) +
      `</div>`;
    setTimeout(right_menu_h.change_info);
  },

  // ── Свойства объекта ─────────────────────────────────────────────────
  open_entity: () => {
    var obj = engine_info.get_entities()[right_menu_h.id];
    if (!obj) return;

    var html = `<div class="right_menu_id">ID: <var>${right_menu_h.id}</var></div>`;
    var inp  = (id, label) =>
      `${label}:<br><input type="text" id="${id}" onchange="setTimeout(right_menu_h.change_info)"><br>`;

    if (obj.type === 'q') {
      html +=
        `<div class="right_menu_const_data">Тип: <var>Точечный заряд</var></div>` +
        `<div class="right_menu_data">` +
          inp('rm_q',  'Заряд q') +
          inp('rm_x',  'X') +
          inp('rm_y',  'Y') +
          `Положение: ` + right_menu_h.mkselect('rm_is_const', obj.is_const,
            [true, false], ['фиксировано', 'подвижно']) + `<br>` +
          inp('rm_vx', 'Скорость Vx') +
          inp('rm_vy', 'Скорость Vy') +
          inp('rm_m',  'Масса m') +
        `</div>`;

    } else if (obj.type === 'p') {
      var shape_name = { rectangle:'Прямоугольник', circle:'Круг', ring:'Кольцо' }[obj.shape];
      var labels = {
        rectangle: ['X левого края', 'Y верхнего края', 'Ширина', 'Высота'],
        circle:    ['Центр X', 'Центр Y', 'Радиус'],
        ring:      ['Центр X', 'Центр Y', 'Радиус внутр.', 'Радиус внешн.'],
      }[obj.shape];

      html +=
        `<div class="right_menu_const_data">Тип: <var>Проводник</var><br>` +
        `Форма: <var>${shape_name}</var></div>` +
        `<div class="right_menu_data">` +
          labels.map((l, k) => inp('rm_d'+k, l)).join('') +
          inp('rm_p_qtotal', 'Суммарный заряд проводника Q') +
        `</div>`;

      // Показываем статистику BEM-зарядов
      var bem = engine_info.get_bem_charges();
      var segs = bem[right_menu_h.id];
      if (segs && segs.length) {
        var q_sum = segs.reduce((a,s)=>a+s.q, 0);
        var s_max = Math.max(...segs.map(s=>Math.abs(s.sigma)));
        html +=
          `<div class="right_menu_const_data" style="font-size:11px;margin-top:4px">` +
          `BEM-сегменты: ${segs.length}<br>` +
          `Q заданный = ${(Number.isFinite(obj.Q_total) ? obj.Q_total : 0).toExponential(2)} e<br>` +
          `∑q инд. = ${q_sum.toExponential(2)}<br>` +
          `|σ|_max = ${s_max.toExponential(2)} e/м` +
          `</div>`;
      }
    }

    html += `<div class="right_menu_buttons">` +
      `<input type="button" value="Удалить объект" onclick="right_menu_h.remove()">` +
      `</div>`;

    right_menu.innerHTML = html;
    setTimeout(right_menu_h.change_info);
  },

  // ── Удаление ─────────────────────────────────────────────────────────
  remove: () => {
    var id = right_menu_h.id;
    canvas_events.history.push();
    engine_info.set_entities(engine_info.get_entities().filter((_, i) => i !== id));
    canvas_events.selected_entity = -1;
    engine_info.change();
    canvas_events.need_repaint();
    right_menu_h.update_entity();
  },

  // ── Вспомогательное: <select> ─────────────────────────────────────────
  mkselect: (id, value, options, texts) => {
    var best = 0;
    if (value !== true && value !== false)
      options.forEach((o, i) => { if (Math.abs(o-value) < Math.abs(options[best]-value)) best=i; });
    var opts = options.map((o, i) => {
      var sel = (value === true || value === false) ? (o === value) : (i === best);
      return `<option value="${o}"${sel?' selected':''}>${texts[i]}</option>`;
    }).join('');
    return `<select id="${id}" onchange="setTimeout(right_menu_h.change_info)">${opts}</select>`;
  }
};

_onload.push(right_menu_h.update_entity);
