/* ============================================================
   canvas.js  —  отрисовка, события мыши/тач, тултип
   ============================================================ */

var canvas_events = {
  selected_entity: -1,

  // Настройки слоёв (можно переключать из UI)
  layers: {
    potential_map: true,
    field_arrows:  true,
    sigma:         true,  // поверхностная плотность заряда
  },

  on_draw_background: [],  // заполняется ниже после _onload
  on_draw: [],
  on_move: [],
  on_click: [],

  autopaint: false,
  need_repaint: () => {
    if (!canvas_events.autopaint)
      requestAnimationFrame(canvas_events.repaint);
    canvas_events.autopaint = true;
  },
  get_canvas:       () => [null, null],
  repaint:          () => {},
  get_canvas_state: () => ({ x:0, y:0, size:1 }),
  set_canvas_state: () => {},
};

// ──────────────────────────────────────────────────────────────────────────────

_onload.push(() => {
  const canvas = document.getElementById('canvas');
  const ctx    = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  canvas_events.get_canvas = () => [canvas, ctx];

  // ── Вспомогательные функции ────────────────────────────────────────────
  function getTransformed(ox, oy) {
    return ctx.getTransform().invertSelf().transformPoint(new DOMPoint(ox, oy));
  }

  canvas_events.get_canvas_state = () => {
    var p = ctx.getTransform();
    return { x: p.e, y: p.f, size: p.a };
  };
  canvas_events.set_canvas_state = obj => {
    ctx.setTransform(obj.size, 0, 0, obj.size, obj.x, obj.y);
    canvas_events.need_repaint();
  };

  // ── Репейнт ────────────────────────────────────────────────────────────
  canvas_events.repaint = () => {
    canvas_events.autopaint = false;
    var state = canvas_events.get_canvas_state();
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (canvas.width < 10 || canvas.height < 10) { ctx.restore(); return; }
    // Фоновые слои (в пространстве экрана)
    canvas_events.on_draw_background.forEach(fn => fn(ctx, canvas, state));
    ctx.restore();
    // Объекты (в мировом пространстве)
    canvas_events.on_draw.forEach(fn => fn(ctx, canvas, state));
  };

  // ── Фон: карта потенциала + стрелки поля ──────────────────────────────
  canvas_events.on_draw_background.push((_, canvas, state) => {
    var field  = engine_info.get_electric_field();
    var N      = engine_info.get_feelds_in_line();
    if (!field.length) return;

    var cols = N+1, rows = N+1;
    var p_max = field._p_max || 1;

    // ── Карта потенциала ────────────────────────────────────────────────
    if (canvas_events.layers.potential_map) {
      var imgD = _.createImageData(cols, rows);
      var data = imgD.data;
      for (var i = 0; i < data.length; i += 4) {
        var idx    = i >> 2;
        if (idx >= field.length) break;
        var pn = Math.max(-1, Math.min(1, field[idx].feeld.p / p_max));
        // Синий (отриц.) → серый (0) → красный (полож.)
        data[i]   = Math.round(pn > 0 ?  60 + pn*170 : 60 + pn*40);  // R
        data[i+1] = Math.round(55 - Math.abs(pn)*40);                  // G
        data[i+2] = Math.round(pn < 0 ? 60 - pn*170 : 60 - pn*40);   // B
        data[i+3] = 210;
      }
      _.putImageData(imgD, 0, 0);
      _.drawImage(canvas, 0, 0, cols, rows, 0, 0, canvas.width, canvas.height);
    } else {
      // Если карта выключена — светлый фон в тон теме
      _.fillStyle = '#e8e3db';
      _.fillRect(0, 0, canvas.width, canvas.height);
    }

    // ── Стрелки напряжённости E ─────────────────────────────────────────
    if (canvas_events.layers.field_arrows) {
      var aw = canvas.width  / N * 0.36;
      var ah = canvas.height / N * 0.36;
      var arrow_len = Math.min(aw, ah);

      var e_mags = field.map(f => Math.hypot(f.feeld.ex, f.feeld.ey));
      var e_max  = Math.max(...e_mags) || 1;

      field.forEach((f, idx) => {
        var emag = e_mags[idx];
        if (emag < 1e-30) return;
        var t    = Math.log10(1 + emag/e_max*9); // лог. нормировка 0..1
        var alpha = Math.round(40 + t*215);
        _.strokeStyle = `rgba(255,255,255,${(alpha/255).toFixed(2)})`;
        _.lineWidth = 1;

        var enx = f.feeld.ex/emag, eny = f.feeld.ey/emag;
        var xl = enx*t*arrow_len, yl = eny*t*arrow_len;
        var x0 = f.x - xl*0.5, y0 = f.y - yl*0.5;
        var x1 = f.x + xl*0.5, y1 = f.y + yl*0.5;
        var hd = Math.max(2.5, t*arrow_len*0.22);

        _.beginPath();
        _.moveTo(x0, y0);
        _.lineTo(x1, y1);
        _.lineTo(x1 - enx*hd*0.8 + eny*hd*0.3, y1 - eny*hd*0.8 - enx*hd*0.3);
        _.moveTo(x1, y1);
        _.lineTo(x1 - enx*hd*0.8 - eny*hd*0.3, y1 - eny*hd*0.8 + enx*hd*0.3);
        _.stroke();
      });
    }
  });

  // ── Объекты (мировые координаты) ──────────────────────────────────────
  canvas_events.on_draw.push((_, canvas, state) => {
    var px   = 1/state.size;
    var many = engine_info.get_entities().length > 1200;

    // ── σ на поверхности проводников ──────────────────────────────────
    if (canvas_events.layers.sigma) {
      var bem = engine_info.get_bem_charges();
      Object.values(bem).forEach(segs => {
        if (!segs.length) return;
        var s_max = Math.max(...segs.map(s => Math.abs(s.sigma))) || 1;
        segs.forEach(s => {
          var t = s.sigma / s_max; // [-1..1]
          // Красный = +, синий = −, толщина = интенсивность
          var r = t > 0 ? 220 : Math.round(60  - t*80);
          var g = Math.round(70  - Math.abs(t)*50);
          var b = t < 0 ? 220 : Math.round(60  + t*80);
          _.strokeStyle = `rgb(${r},${g},${b})`;
          _.lineWidth   = Math.max(1.5*px, Math.abs(t)*10*px);
          _.beginPath();
          // Рисуем маленький отрезок по нормали — показывает знак и величину σ
          var visual_len = 6*px * Math.abs(t) + 2*px;
          _.moveTo(s.x, s.y);
          _.lineTo(s.x + s.nx*visual_len, s.y + s.ny*visual_len);
          _.stroke();
        });
      });
    }

    // ── Проводники ─────────────────────────────────────────────────────
    engine_info.get_entities()
      .map((e,i)=>[e,i]).filter(d=>d[0].type==='p')
      .forEach(([e, ind]) => {
        var sel = ind === canvas_events.selected_entity;
        _.lineWidth   = 2*px;
        _.strokeStyle = sel ? '#e8e0d0' : '#8a8078';
        _.fillStyle   = sel ? 'rgba(220,200,170,0.18)' : 'rgba(160,150,130,0.12)';

        if (e.shape === 'rectangle') {
          _.fillRect  (e.data[0], e.data[1], e.data[2], e.data[3]);
          _.strokeRect(e.data[0], e.data[1], e.data[2], e.data[3]);
        } else if (e.shape === 'ring') {
          var mid = (e.data[2]+e.data[3])/2;
          _.lineWidth   = (e.data[3]-e.data[2]);
          _.strokeStyle = sel ? 'rgba(220,200,170,0.25)' : 'rgba(160,150,130,0.15)';
          _.beginPath(); _.arc(e.data[0],e.data[1],mid,0,2*Math.PI); _.stroke();
          _.lineWidth   = 2*px;
          _.strokeStyle = sel ? '#e8e0d0' : '#8a8078';
          _.beginPath(); _.arc(e.data[0],e.data[1],e.data[2],0,2*Math.PI); _.stroke();
          _.beginPath(); _.arc(e.data[0],e.data[1],e.data[3],0,2*Math.PI); _.stroke();
        } else if (e.shape === 'circle') {
          _.beginPath(); _.arc(e.data[0],e.data[1],e.data[2],0,2*Math.PI);
          _.fill(); _.stroke();
        }
      });

    // ── Точечные заряды ────────────────────────────────────────────────
    engine_info.get_entities()
      .map((e,i)=>[e,i]).filter(d=>d[0].type==='q')
      .forEach(([e, ind]) => {
        var sel = ind === canvas_events.selected_entity;
        _.lineWidth   = 2*px;
        _.strokeStyle = sel ? '#ffffff' : 'rgba(0,0,0,0.5)';

        // Тень/глоу
        if (!many) {
          _.shadowColor = e.q >= 0 ? 'rgba(220,80,80,0.7)' : 'rgba(80,120,220,0.7)';
          _.shadowBlur  = 8*px;
        }
        _.fillStyle = e.q >= 0 ? '#e84040' : '#4070e0';

        if (many) {
          _.fillRect(e.x-10*px, e.y-10*px, 20*px, 20*px);
        } else {
          _.beginPath(); _.arc(e.x, e.y, 11*px, 0, 2*Math.PI);
          _.fill(); _.stroke();
        }
        _.shadowBlur = 0;

        // Знак
        _.fillStyle = '#ffffff';
        if (e.q >= 0) _.fillRect(e.x-1*px, e.y-5.5*px, 2*px, 11*px);
        _.fillRect(e.x-5.5*px, e.y-1*px, 11*px, 2*px);
      });
  });

  // ── Тултип (φ и E по положению мыши) ──────────────────────────────────
  var tooltip_el = document.getElementById('field_tooltip');

  function update_tooltip(worldX, worldY) {
    if (!tooltip_el) return;
    var f = engine_info.electric_field(worldX, worldY);
    var emag = Math.hypot(f.ex, f.ey);
    // Форматирование с авто-приставкой
    function fmt(v) {
      var a = Math.abs(v);
      if (a === 0) return '0';
      if (a >= 1e9) return (v/1e9).toFixed(2)+'G';
      if (a >= 1e6) return (v/1e6).toFixed(2)+'M';
      if (a >= 1e3) return (v/1e3).toFixed(2)+'k';
      if (a >= 1)   return v.toFixed(3);
      if (a >= 1e-3)return (v*1e3).toFixed(2)+'m';
      return v.toExponential(2);
    }
    tooltip_el.innerHTML =
      `<span class="tt-row"><span class="tt-label">φ</span><span class="tt-val">${fmt(f.p)} В</span></span>` +
      `<span class="tt-row"><span class="tt-label">|E|</span><span class="tt-val">${fmt(emag)} В/м</span></span>` +
      `<span class="tt-row"><span class="tt-label">Eₓ</span><span class="tt-val">${fmt(f.ex)}</span></span>` +
      `<span class="tt-row"><span class="tt-label">Eᵧ</span><span class="tt-val">${fmt(f.ey)}</span></span>`;
  }

  // ── Мышь ──────────────────────────────────────────────────────────────
  var isDragging   = false;
  var dragStart    = { x:0, y:0 };
  var startClick   = { x:0, y:0, is_click:true };
  var cursorWorld  = { x:0, y:0 };

  var mousePos         = document.getElementById('mouse-pos');
  var transformedMouse = document.getElementById('transformed-mouse-pos');

  function onMouseDown(ev) {
    isDragging = true;
    startClick = { x: ev.offsetX, y: ev.offsetY, is_click: true };
    dragStart  = getTransformed(ev.offsetX, ev.offsetY);
  }

  function onMouseMove(ev) {
    cursorWorld = getTransformed(ev.offsetX, ev.offsetY);
    if (mousePos)         mousePos.innerText = `X: ${ev.offsetX}  Y: ${ev.offsetY}`;
    if (transformedMouse) transformedMouse.innerText =
      `Мир: ${cursorWorld.x.toFixed(3)}  ${cursorWorld.y.toFixed(3)}`;

    update_tooltip(cursorWorld.x, cursorWorld.y);

    if (isDragging) {
      ctx.translate(cursorWorld.x - dragStart.x, cursorWorld.y - dragStart.y);
      if ((ev.offsetX-startClick.x)**2+(ev.offsetY-startClick.y)**2 > 25)
        startClick.is_click = false;
      if (!runner.running) engine_info.change();
      canvas_events.need_repaint();
    }
  }

  function onMouseUp(ev) {
    if (isDragging && startClick.is_click) {
      var t = getTransformed(startClick.x, startClick.y);
      canvas_events.on_click.forEach(fn => fn(startClick.x, startClick.y, t.x, t.y));
    }
    isDragging = false;
    if (!runner.running) engine_info.change();
    canvas_events.need_repaint();
  }

  function onWheel(ev) {
    var zoom = Math.pow(Math.E, -ev.deltaY * Math.log(1.1)/100);
    ctx.translate(cursorWorld.x, cursorWorld.y);
    ctx.scale(zoom, zoom);
    ctx.translate(-cursorWorld.x, -cursorWorld.y);
    if (!runner.running) engine_info.change();
    canvas_events.need_repaint();
  }

  canvas.addEventListener('mousedown',  onMouseDown,  { passive:true });
  canvas.addEventListener('mousemove',  onMouseMove,  { passive:true });
  canvas.addEventListener('mouseup',    onMouseUp,    { passive:true });
  canvas.addEventListener('mouseleave', onMouseUp,    { passive:true });
  canvas.addEventListener('wheel',      onWheel,      { passive:true });

  // Touch
  function t2o(e, touch) {
    var r = e.target.getBoundingClientRect();
    return {
      offsetX: (touch.clientX-r.x)/r.width  * e.target.offsetWidth,
      offsetY: (touch.clientY-r.y)/r.height * e.target.offsetHeight
    };
  }
  canvas.addEventListener('touchstart',  e => { Object.assign(e, t2o(e,e.touches[0]));        onMouseDown(e); }, {passive:false});
  canvas.addEventListener('touchmove',   e => { Object.assign(e, t2o(e,e.touches[0]));        onMouseMove(e); }, {passive:false});
  canvas.addEventListener('touchend',    e => { Object.assign(e, t2o(e,e.changedTouches[0])); onMouseUp(e);   }, {passive:false});
  canvas.addEventListener('touchcancel', e => { Object.assign(e, t2o(e,e.changedTouches[0])); onMouseUp(e);   }, {passive:false});

  canvas_events.need_repaint();
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'center';

  setTimeout(() => {
    canvas_events.set_canvas_state({
      x: center_menu.clientWidth/2,
      y: center_menu.clientHeight/2,
      size: 14
    });
  }, 200);
});
