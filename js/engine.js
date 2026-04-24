/* ============================================================
   engine.js  —  физический движок электростатики
   ============================================================
   Типы сущностей:
     'q'  — точечный заряд
     'p'  — проводник (геометрический барьер + BEM-заряды)
   Формы проводников: 'rectangle' | 'circle' | 'ring'
   ============================================================ */

var engine_info = (()=>{

  // ── Константы ───────────────────────────────────────────────────────────
  var constants = {
    e:   1e-9,                    // единица заряда [Кл]
    eps: 8.9875517873681764e9,    // k = 1/(4πε₀) [Н·м²/Кл²]
    t:   1,                       // множитель времени симуляции
    m:   1e-3,                    // единица массы [кг]
    scale: 1,                     // метров на единицу координат
  };

  // ── Принадлежность точки форме ──────────────────────────────────────────
  var in_shape = {
    rectangle: ([x1, y1, w, h], x, y) =>
      x >= x1 && x <= x1+w && y >= y1 && y <= y1+h,

    circle: ([cx, cy, r], x, y) =>
      (x-cx)**2 + (y-cy)**2 <= r*r,

    ring: ([cx, cy, r1, r2], x, y) => {
      var d2 = (x-cx)**2 + (y-cy)**2;
      return d2 <= r2*r2 && d2 >= r1*r1;
    }
  };

  // ── BEM: дискретизация границы проводника ───────────────────────────────
  // Возвращает массив точек на границе [{x, y, nx, ny, ds}]
  // nx,ny — внешняя нормаль; ds — длина сегмента
  function conductor_boundary_points(entity, N) {
    var pts = [];
    var d = entity.data, sh = entity.shape;

    if (sh === 'circle') {
      var [cx, cy, r] = d;
      for (var i = 0; i < N; i++) {
        var phi = (2*Math.PI*i)/N;
        pts.push({ x: cx + r*Math.cos(phi), y: cy + r*Math.sin(phi),
                   nx: Math.cos(phi), ny: Math.sin(phi), ds: 2*Math.PI*r/N });
      }
    } else if (sh === 'ring') {
      // Внешняя граница (r2)
      var [cx, cy, r1, r2] = d;
      var Nouter = Math.round(N * r2/(r1+r2));
      var Ninner = N - Nouter;
      for (var i = 0; i < Nouter; i++) {
        var phi = (2*Math.PI*i)/Nouter;
        pts.push({ x: cx + r2*Math.cos(phi), y: cy + r2*Math.sin(phi),
                   nx:  Math.cos(phi), ny:  Math.sin(phi), ds: 2*Math.PI*r2/Nouter });
      }
      // Внутренняя граница (r1), нормаль смотрит внутрь (в сторону центра)
      for (var i = 0; i < Ninner; i++) {
        var phi = (2*Math.PI*i)/Ninner;
        pts.push({ x: cx + r1*Math.cos(phi), y: cy + r1*Math.sin(phi),
                   nx: -Math.cos(phi), ny: -Math.sin(phi), ds: 2*Math.PI*r1/Ninner });
      }
    } else if (sh === 'rectangle') {
      var [x0, y0, w, h] = d;
      var perim = 2*(w+h);
      var ds = perim / N;
      // Обход по периметру
      var sides = [
        {dx:1, dy:0, len:w, ox:x0,   oy:y0,   nx:0,  ny:-1},
        {dx:0, dy:1, len:h, ox:x0+w, oy:y0,   nx:1,  ny:0},
        {dx:-1,dy:0, len:w, ox:x0+w, oy:y0+h, nx:0,  ny:1},
        {dx:0, dy:-1,len:h, ox:x0,   oy:y0+h, nx:-1, ny:0},
      ];
      var dist = 0;
      var si = 0, spos = 0;
      for (var i = 0; i < N; i++) {
        var t = i * perim / N;
        while (si < 4 && t >= spos + sides[si].len) { spos += sides[si].len; si++; }
        if (si >= 4) si = 3;
        var s = sides[si];
        var frac = (t - spos) / s.len;
        pts.push({ x: s.ox + s.dx*s.len*frac, y: s.oy + s.dy*s.len*frac,
                   nx: s.nx, ny: s.ny, ds: ds });
      }
    }
    return pts;
  }

  // ── BEM: решение задачи — нахождение σᵢ ────────────────────────────────
  // Метод: каждый граничный узел несёт заряд qᵢ = σᵢ·dsᵢ.
  // Условие проводника: φ(rᵢ) = const для всех i.
  // φ(rᵢ) = Σⱼ k·qⱼ/|rᵢ-rⱼ| + φ_ext(rᵢ)
  // → матричное уравнение A·q = b (b = -φ_ext + V_conductor)
  // Решаем итерационно методом Гаусса-Зейделя (нет зависимостей на matlib).
  function solve_bem(conductor_entity, ext_charges, N_pts) {
    var pts = conductor_boundary_points(conductor_entity, N_pts);
    var n = pts.length;
    if (n === 0) return [];

    // Внешний потенциал в каждой граничной точке
    var phi_ext = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var px = pts[i].x, py = pts[i].y;
      for (var c of ext_charges) {
        var dx = (c.x - px) * constants.scale;
        var dy = (c.y - py) * constants.scale;
        var d2 = dx*dx + dy*dy;
        if (d2 < 1e-6) continue;
        phi_ext[i] += constants.eps * c.q * constants.e / Math.sqrt(d2);
      }
    }

    // Матрица влияния A[i][j] = k / |rᵢ - rⱼ| (для i≠j),  A[i][i] = k/r_self
    // r_self ≈ ds/4 (регуляризация самовлияния для 2D)
    var A = [];
    for (var i = 0; i < n; i++) {
      A.push(new Float64Array(n));
      for (var j = 0; j < n; j++) {
        if (i === j) {
          A[i][j] = constants.eps * constants.e / (pts[j].ds * 0.25);
        } else {
          var dx = (pts[i].x - pts[j].x) * constants.scale;
          var dy = (pts[i].y - pts[j].y) * constants.scale;
          var d = Math.sqrt(dx*dx + dy*dy);
          A[i][j] = d > 1e-10 ? constants.eps * constants.e / d : 0;
        }
      }
    }

    // Целевой потенциал проводника — среднее φ_ext (незаряженный проводник,
    // полный индуцированный заряд = 0)
    var phi_target = conductor_entity.V_conductor !== undefined
      ? conductor_entity.V_conductor
      : phi_ext.reduce((a,b)=>a+b,0)/n;

    // Правая часть: b[i] = phi_target - phi_ext[i]
    var b = new Float64Array(n);
    for (var i = 0; i < n; i++) b[i] = phi_target - phi_ext[i];

    // Гаусс-Зейдель (20 итераций — хватает для визуализации)
    var q = new Float64Array(n); // начальное приближение = 0
    for (var iter = 0; iter < 20; iter++) {
      for (var i = 0; i < n; i++) {
        var s = b[i];
        for (var j = 0; j < n; j++) if (j !== i) s -= A[i][j]*q[j];
        q[i] = s / A[i][i];
      }
    }

    // Проверка: суммарный индуцированный заряд должен быть ~0
    // (применяем простую коррекцию, чтобы ∑q = 0)
    var qsum = 0;
    for (var i = 0; i < n; i++) qsum += q[i];
    var correction = qsum / n;
    for (var i = 0; i < n; i++) q[i] -= correction;

    // Собираем результат: [{x, y, q, sigma, ds, nx, ny}]
    var result = [];
    for (var i = 0; i < n; i++) {
      result.push({
        x: pts[i].x, y: pts[i].y,
        nx: pts[i].nx, ny: pts[i].ny,
        ds: pts[i].ds,
        q: q[i],                   // заряд сегмента [в единицах e]
        sigma: q[i] / pts[i].ds    // поверхностная плотность заряда σ [e/м]
      });
    }
    return result;
  }

  // ── Начальные сущности ──────────────────────────────────────────────────
  var entities = [
    { type:'q', is_const:false, q:1000, x:0.01, y:1,  vx:0, vy:0, m:10, in_conductor:false },
    { type:'q', is_const:false, q:-1000, x:-0.01, y:-1, vx:0, vy:0, m:10, in_conductor:false },
  ];

  // BEM-заряды по проводникам: { [entity_index]: [{x,y,q,sigma,ds,nx,ny}] }
  var bem_charges = {};

  // ── Обновление BEM ──────────────────────────────────────────────────────
  var BEM_N = 48; // точек на проводник

  function update_bem() {
    var point_charges = entities.filter(e => e.type === 'q');
    bem_charges = {};
    entities.forEach((e, i) => {
      if (e.type !== 'p') return;
      bem_charges[i] = solve_bem(e, point_charges, BEM_N);
    });
  }

  // ── Расчёт поля в точке (мировые координаты) ───────────────────────────
  function get_electric_field(x, y) {
    var ex = 0, ey = 0, p = 0;

    // Точечные заряды
    entities.forEach(e => {
      if (e.type !== 'q') return;
      var dx = (e.x - x) * constants.scale;
      var dy = (e.y - y) * constants.scale;
      var d2 = dx*dx + dy*dy;
      if (d2 < 0.001) return;
      var d  = Math.sqrt(d2);
      var em = constants.eps * e.q * constants.e / d2;
      ex += em * dx/d;
      ey += em * dy/d;
      p  += constants.eps * e.q * constants.e / d;
    });

    // BEM-заряды (индуцированные заряды на проводниках)
    Object.values(bem_charges).forEach(segs => {
      segs.forEach(s => {
        var dx = (s.x - x) * constants.scale;
        var dy = (s.y - y) * constants.scale;
        var d2 = dx*dx + dy*dy;
        if (d2 < 1e-6) return;
        var d  = Math.sqrt(d2);
        var em = constants.eps * s.q * constants.e / d2;
        ex += em * dx/d;
        ey += em * dy/d;
        p  += constants.eps * s.q * constants.e / d;
      });
    });

    return { ex, ey, p };
  }

  // ── Сетка поля для фона ────────────────────────────────────────────────
  var feelds_in_line = 10;
  var canvas_electric_field = [];

  function change() {
    var [canvas, ctx] = canvas_events.get_canvas();
    var state = canvas_events.get_canvas_state();
    if (!canvas || !ctx || !state) return;

    update_bem(); // пересчитываем индуцированные заряды

    var xx = 1000;
    if (entities.length > 50)    xx = 500;
    if (entities.length > 500)   xx = 300;
    if (entities.length > 1000)  xx = 200;
    feelds_in_line = Math.max(Math.floor(Math.sqrt(xx)), 4);

    var step_x = canvas.width  / feelds_in_line / state.size;
    var step_y = canvas.height / feelds_in_line / state.size;
    var ox = -state.x / state.size;
    var oy = -state.y / state.size;

    canvas_electric_field = [];
    for (var yi = 0; yi <= feelds_in_line; yi++) {
      for (var xi = 0; xi <= feelds_in_line; xi++) {
        var wx = ox + xi*step_x;
        var wy = oy + yi*step_y;
        canvas_electric_field.push({
          x: canvas.width  / feelds_in_line * xi,
          y: canvas.height / feelds_in_line * yi,
          feeld: get_electric_field(wx, wy)
        });
      }
    }

    // Нормировка для цветовой карты
    var p_vals = canvas_electric_field.map(e => Math.abs(e.feeld.p));
    canvas_electric_field._p_max = Math.max(...p_vals) || 1;

    if (runner.running) right_menu_h.change_info(true);
  }

  // ── Итерация движка — симплектический Эйлер ────────────────────────────
  function engine_iteration(dt_real) {
    var dt = dt_real * constants.t;
    var conductors = entities.filter(e => e.type === 'p');

    // 1. Накопить ускорения
    entities.forEach((entity, i) => {
      if (entity.type !== 'q' || entity.is_const) return;
      var fx = 0, fy = 0;

      // От точечных зарядов
      entities.forEach((e, j) => {
        if (j === i || e.type !== 'q') return;
        var dx = (e.x - entity.x) * constants.scale;
        var dy = (e.y - entity.y) * constants.scale;
        var d2 = dx*dx + dy*dy;
        if (d2 < 0.01) return;
        var d  = Math.sqrt(d2);
        var f  = constants.eps * entity.q * e.q * constants.e**2 / d2;
        fx -= f * dx/d;
        fy -= f * dy/d;
      });

      // От BEM-зарядов проводников
      Object.values(bem_charges).forEach(segs => {
        segs.forEach(s => {
          var dx = (s.x - entity.x) * constants.scale;
          var dy = (s.y - entity.y) * constants.scale;
          var d2 = dx*dx + dy*dy;
          if (d2 < 0.001) return;
          var d  = Math.sqrt(d2);
          var f  = constants.eps * entity.q * s.q * constants.e**2 / d2;
          fx -= f * dx/d;
          fy -= f * dy/d;
        });
      });

      var mass = entity.m * constants.m;
      entity._ax = fx / mass;
      entity._ay = fy / mass;
    });

    // 2. Обновить скорости и позиции (симплектический Эйлер)
    entities.forEach((entity) => {
      if (entity.type !== 'q' || entity.is_const) return;

      // Новые скорости
      var nvx = entity.vx + (entity._ax||0) * dt;
      var nvy = entity.vy + (entity._ay||0) * dt;

      // Softcap
      var v2 = nvx*nvx + nvy*nvy;
      if (v2 > 1e12) { var k = 1e6/Math.sqrt(v2); nvx*=k; nvy*=k; }

      // Новые позиции
      var nx = entity.x + nvx * dt / constants.scale;
      var ny = entity.y + nvy * dt / constants.scale;

      // Коллизия с проводниками — бинарный поиск по пути
      var was_inside = conductors.some(c => in_shape[c.shape](c.data, entity.x, entity.y));
      if (was_inside) {
        var lo = 0, hi = 1;
        for (var k = 0; k < 8; k++) {
          var mid = (lo+hi)/2;
          var mx = entity.x + nvx*dt*mid/constants.scale;
          var my = entity.y + nvy*dt*mid/constants.scale;
          if (conductors.some(c => in_shape[c.shape](c.data, mx, my))) hi = mid;
          else lo = mid;
        }
        nx = entity.x + nvx*dt*lo/constants.scale;
        ny = entity.y + nvy*dt*lo/constants.scale;
        nvx *= 0.05; nvy *= 0.05; // поглощение: заряды «прилипают»
      }

      entity.x  = nx; entity.y  = ny;
      entity.vx = nvx; entity.vy = nvy;
    });

    change();
    canvas_events.need_repaint();
  }

  // ── Публичный API ───────────────────────────────────────────────────────
  return {
    constants,
    run:                engine_iteration,
    get_entities:       () => entities,
    set_entities:       e  => { entities = e; bem_charges = {}; },
    electric_field:     get_electric_field,
    change,
    get_electric_field: () => canvas_electric_field,
    get_feelds_in_line: () => feelds_in_line,
    get_bem_charges:    () => bem_charges,
    in_shape,
  };
})();
