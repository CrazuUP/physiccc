/* ============================================================
   canvas.js  —  отрисовка, события мыши/тач, тултип
   ============================================================ */

var canvas_events = {
  selected_entity: -1,

  // Настройки слоёв (можно переключать из UI)
  layers: {
    potential_map: true,
    field_arrows: true,
    equipotential_lines: false,
    force_lines: false,
    conductors: true,
    charges: true,
    sigma: true, // поверхностная плотность заряда
  },

  on_draw_background: [], // заполняется ниже после _onload
  on_draw: [],
  on_move: [],
  on_click: [],

  autopaint: false,
  need_repaint: () => {
    if (!canvas_events.autopaint)
      requestAnimationFrame(canvas_events.repaint);
    canvas_events.autopaint = true;
  },
  get_canvas: () => [null, null],
  repaint: () => {},
  get_canvas_state: () => ({ x: 0, y: 0, size: 1 }),
  set_canvas_state: () => {},
  sync_layer_ui: () => {},
  after_scene_change: () => {},
  history: {
    past: [],
    future: [],
    maxSteps: 200,
    autosnapshotEveryMs: 100,
    lastAutosnapshotAt: 0,
    suspendPush: false,
    updateControls: () => {
      var undoBtn = document.getElementById('history_undo_btn');
      var redoBtn = document.getElementById('history_redo_btn');
      if (undoBtn) undoBtn.disabled = canvas_events.history.past.length === 0;
      if (redoBtn) redoBtn.disabled = canvas_events.history.future.length === 0;
    },
    serializeState: () => ({
      entities: JSON.parse(JSON.stringify(engine_info.get_entities())),
      constants: JSON.parse(JSON.stringify(engine_info.constants)),
      canvas: JSON.parse(JSON.stringify(canvas_events.get_canvas_state())),
      selected_entity: canvas_events.selected_entity
    }),
    statesEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    push: snapshot => {
      if (canvas_events.history.suspendPush) return;
      var nextSnapshot = snapshot || canvas_events.history.serializeState();
      var last = canvas_events.history.past[canvas_events.history.past.length - 1];
      if (last && canvas_events.history.statesEqual(last, nextSnapshot)) return;
      canvas_events.history.past.push(nextSnapshot);
      if (canvas_events.history.past.length > canvas_events.history.maxSteps)
        canvas_events.history.past.shift();
      canvas_events.history.future = [];
      canvas_events.history.lastAutosnapshotAt = Date.now();
      canvas_events.history.updateControls();
    },
    reset: () => {
      canvas_events.history.past = [];
      canvas_events.history.future = [];
      canvas_events.history.lastAutosnapshotAt = Date.now();
      canvas_events.history.updateControls();
    },
    maybe_autosnapshot: () => {
      if (canvas_events.history.suspendPush) return;
      var now = Date.now();
      if (now - canvas_events.history.lastAutosnapshotAt < canvas_events.history.autosnapshotEveryMs) return;
      canvas_events.history.push();
    },
    applySnapshot: snapshot => {
      if (!snapshot) return;
      canvas_events.history.suspendPush = true;
      if (typeof runner !== 'undefined' && runner.running) {
        runner.running = false;
        runner.last_eval_time = 0;
      }
      engine_info.set_entities(JSON.parse(JSON.stringify(snapshot.entities)));
      Object.assign(engine_info.constants, JSON.parse(JSON.stringify(snapshot.constants)));
      canvas_events.selected_entity = snapshot.selected_entity;
      canvas_events.set_canvas_state(snapshot.canvas);
      engine_info.change();
      canvas_events.after_scene_change();
      canvas_events.need_repaint();
      canvas_events.history.suspendPush = false;
      canvas_events.history.updateControls();
    },
    undo: () => {
      if (!canvas_events.history.past.length) {
        canvas_events.history.updateControls();
        return;
      }
      var current = canvas_events.history.serializeState();
      var target = canvas_events.history.past.pop();
      canvas_events.history.future.push(current);
      canvas_events.history.applySnapshot(target);
    },
    redo: () => {
      if (!canvas_events.history.future.length) {
        canvas_events.history.updateControls();
        return;
      }
      var current = canvas_events.history.serializeState();
      var target = canvas_events.history.future.pop();
      canvas_events.history.past.push(current);
      canvas_events.history.applySnapshot(target);
    }
  }
};

// ──────────────────────────────────────────────────────────────────────────────

_onload.push(() => {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const tooltip_el = document.getElementById('field_tooltip');
  const colorbar_el = document.getElementById('potential_colorbar');
  const colorbar_min_el = document.getElementById('potential_colorbar_min');
  const colorbar_neg_mid_el = document.getElementById('potential_colorbar_neg_mid');
  const colorbar_mid_el = document.getElementById('potential_colorbar_mid');
  const colorbar_pos_mid_el = document.getElementById('potential_colorbar_pos_mid');
  const colorbar_max_el = document.getElementById('potential_colorbar_max');
  const colorbar_range_el = document.getElementById('potential_colorbar_range');
  const colorbar_tick_els = [
    colorbar_min_el,
    colorbar_neg_mid_el,
    colorbar_mid_el,
    colorbar_pos_mid_el,
    colorbar_max_el
  ];
  ctx.imageSmoothingEnabled = false;

  canvas_events.get_canvas = () => [canvas, ctx];

  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }

  function formatMetric(v) {
    var a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'G';
    if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(2) + 'k';
    if (a >= 1) return v.toFixed(3);
    if (a >= 1e-3) return (v * 1e3).toFixed(2) + 'm';
    return v.toExponential(2);
  }

  function trimZeros(text) {
    return text.replace(/\.0+($|[a-zA-ZА-Яа-я])/g, '$1').replace(/(\.\d*?)0+($|[a-zA-ZА-Яа-я])/g, '$1$2');
  }

  function formatMetricCompact(v) {
    var a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1e9) return trimZeros((v / 1e9).toFixed(a >= 1e11 ? 0 : 1) + 'G');
    if (a >= 1e6) return trimZeros((v / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M');
    if (a >= 1e3) return trimZeros((v / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'k');
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return trimZeros(v.toFixed(1));
    if (a >= 1) return trimZeros(v.toFixed(2));
    if (a >= 1e-3) return trimZeros((v * 1e3).toFixed(a >= 0.1 ? 0 : 1) + 'm');
    return v.toExponential(1);
  }

  function formatPotentialTick(v, zeroEpsilon) {
    if (Math.abs(v) <= (zeroEpsilon || 0)) v = 0;
    var sign = v > 0 ? '+' : '';
    return sign + formatMetricCompact(v);
  }

  function formatPotentialTickWithUnit(v, zeroEpsilon) {
    return formatPotentialTick(v, zeroEpsilon) + '\u00a0\u0412';
  }

  function getPotentialColor(pn, alpha) {
    pn = clamp(pn, -1, 1);
    return {
      r: Math.round(pn > 0 ? 60 + pn * 170 : 60 + pn * 40),
      g: Math.round(55 - Math.abs(pn) * 40),
      b: Math.round(pn < 0 ? 60 - pn * 170 : 60 - pn * 40),
      a: alpha === undefined ? 255 : alpha
    };
  }

  function getPotentialColorCss(pn, alpha) {
    var c = getPotentialColor(pn, alpha);
    return `rgba(${c.r},${c.g},${c.b},${(c.a / 255).toFixed(3)})`;
  }

  function getPotentialScale(field) {
    var p_min = Infinity;
    var p_max = -Infinity;
    field.forEach(item => {
      var p = item && item.feeld ? item.feeld.p : NaN;
      if (!Number.isFinite(p)) return;
      p_min = Math.min(p_min, p);
      p_max = Math.max(p_max, p);
    });

    if (!Number.isFinite(p_min) || !Number.isFinite(p_max)) {
      p_min = -1;
      p_max = 1;
    }

    var p_abs_max = Math.max(Math.abs(p_min), Math.abs(p_max), field._p_max || 0, 1e-12);
    if (Math.abs(p_max - p_min) < 1e-12) {
      p_min -= p_abs_max * 0.5;
      p_max += p_abs_max * 0.5;
    }

    return {
      min: p_min,
      max: p_max,
      absMax: p_abs_max
    };
  }

  function buildPotentialGradient(scale) {
    var stops = [];
    var span = scale.max - scale.min;
    for (var i = 0; i <= 12; i++) {
      var pos = i / 12;
      var p = scale.min + span * pos;
      stops.push(`${getPotentialColorCss(p / scale.absMax, 220)} ${(pos * 100).toFixed(2)}%`);
    }
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  }

  function setPotentialColorbarVisible(visible) {
    if (!colorbar_el) return;
    colorbar_el.classList.toggle('visible', visible);
    if (document.body) document.body.classList.toggle('potential-colorbar-visible', visible);
  }

  function updateColorbar(scale) {
    if (!colorbar_el) return;
    var visible = canvas_events.layers.potential_map;
    setPotentialColorbarVisible(visible);
    if (!visible) return;

    var span = scale.max - scale.min;
    var zeroEpsilon = scale.absMax * 1e-9;
    colorbar_el.style.setProperty('--potential-scale', buildPotentialGradient(scale));
    colorbar_el.style.setProperty(
      '--potential-zero-pos',
      `${clamp((0 - scale.min) / span, 0, 1) * 100}%`
    );
    colorbar_el.style.setProperty(
      '--potential-zero-opacity',
      scale.min <= 0 && scale.max >= 0 ? '1' : '0'
    );
    colorbar_tick_els.forEach((el, i) => {
      if (!el) return;
      el.textContent = formatPotentialTickWithUnit(scale.min + span * i / 4, zeroEpsilon);
    });
    if (colorbar_range_el) {
      colorbar_range_el.textContent =
        formatPotentialTickWithUnit(scale.min, zeroEpsilon) + ' ... ' + formatPotentialTickWithUnit(scale.max, zeroEpsilon);
    }
  }

  function getTransformed(ox, oy) {
    return ctx.getTransform().invertSelf().transformPoint(new DOMPoint(ox, oy));
  }

  function getWorldBounds(state) {
    var x0 = -state.x / state.size;
    var y0 = -state.y / state.size;
    return {
      x0,
      y0,
      x1: x0 + canvas.width / state.size,
      y1: y0 + canvas.height / state.size,
      width: canvas.width / state.size,
      height: canvas.height / state.size
    };
  }

  function interpolateIso(level, a, b) {
    var den = b.p - a.p;
    var t = Math.abs(den) < 1e-12 ? 0.5 : (level - a.p) / den;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t
    };
  }

  function isInsideBounds(pt, bounds, pad) {
    pad = pad || 0;
    return pt.x >= bounds.x0 - pad && pt.x <= bounds.x1 + pad && pt.y >= bounds.y0 - pad && pt.y <= bounds.y1 + pad;
  }

  function tooCloseToNegativeCharge(x, y, px) {
    return engine_info.get_entities().some(e =>
      e.type === 'q' && e.q < 0 &&
      (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y) < (px * 18) * (px * 18)
    );
  }

  function traceForceLine(seed, bounds, px) {
    var pts = [{ x: seed.x, y: seed.y }];
    var x = seed.x;
    var y = seed.y;
    var maxSteps = 420;
    var baseStep = Math.max(px * 3.5, Math.min(bounds.width, bounds.height) / 180);
    var minStep = baseStep * 0.45;
    var maxStep = baseStep * 1.8;
    var prevDir = null;

    for (var i = 0; i < maxSteps; i++) {
      var f = engine_info.electric_field(x, y);
      var emag = Math.hypot(f.ex, f.ey);
      if (emag < 1e-8) break;
      var dirx = f.ex / emag;
      var diry = f.ey / emag;
      if (prevDir) {
        var sm = 0.7;
        dirx = prevDir.x * sm + dirx * (1 - sm);
        diry = prevDir.y * sm + diry * (1 - sm);
        var dn = Math.hypot(dirx, diry) || 1;
        dirx /= dn;
        diry /= dn;
      }
      prevDir = { x: dirx, y: diry };

      var localStep = baseStep * (1 / (1 + Math.log10(1 + emag)));
      localStep = clamp(localStep, minStep, maxStep);
      x += dirx * localStep;
      y += diry * localStep;
      if (!isInsideBounds({ x, y }, bounds, localStep * 2.5)) break;

      var last = pts[pts.length - 1];
      if ((last.x - x) * (last.x - x) + (last.y - y) * (last.y - y) < (px * 0.85) * (px * 0.85)) break;
      pts.push({ x, y });
      if (tooCloseToNegativeCharge(x, y, px)) break;
    }
    return pts;
  }

  function getForceLineSeeds(px) {
    var seeds = [];
    var entities = engine_info.get_entities();
    entities.forEach(e => {
      if (e.type !== 'q' || e.q <= 0) return;
      var n = Math.max(14, Math.min(34, Math.round(Math.sqrt(Math.abs(e.q)) * 0.8)));
      for (var i = 0; i < n; i++) {
        var phi = (2 * Math.PI * i) / n;
        seeds.push({
          x: e.x + Math.cos(phi) * px * 14,
          y: e.y + Math.sin(phi) * px * 14
        });
      }
    });

    Object.values(engine_info.get_bem_charges()).forEach(segs => {
      var positive = segs.filter(s => s.sigma > 0);
      if (!positive.length) return;
      var stride = Math.max(1, Math.ceil(positive.length / 40));
      for (var i = 0; i < positive.length; i += stride) {
        var s = positive[i];
        seeds.push({
          x: s.x + s.nx * px * 7,
          y: s.y + s.ny * px * 7
        });
      }
    });
    return seeds;
  }

  function drawPolyline(_, pts) {
    if (pts.length < 2) return;
    _.beginPath();
    _.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) _.lineTo(pts[i].x, pts[i].y);
    _.stroke();
  }

  canvas_events.get_canvas_state = () => {
    var p = ctx.getTransform();
    return { x: p.e, y: p.f, size: p.a };
  };
  canvas_events.set_canvas_state = obj => {
    ctx.setTransform(obj.size, 0, 0, obj.size, obj.x, obj.y);
    canvas_events.need_repaint();
  };

  canvas_events.sync_layer_ui = () => {
    var sigmaLegend = document.getElementById('sigma_legend');
    if (sigmaLegend) sigmaLegend.classList.toggle('visible', !!canvas_events.layers.sigma);
    setPotentialColorbarVisible(!!canvas_events.layers.potential_map);
  };

  canvas_events.after_scene_change = () => {
    canvas_events.sync_layer_ui();
    if (typeof right_menu_h !== 'undefined') {
      right_menu_h.id = -2;
      right_menu_h.update_entity();
    }
  };

  canvas_events.repaint = () => {
    canvas_events.autopaint = false;
    var state = canvas_events.get_canvas_state();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (canvas.width < 10 || canvas.height < 10) {
      ctx.restore();
      return;
    }
    canvas_events.on_draw_background.forEach(fn => fn(ctx, canvas, state));
    ctx.restore();
    canvas_events.on_draw.forEach(fn => fn(ctx, canvas, state));
  };

  canvas_events.on_draw_background.push((_, canvas, state) => {
    var field = engine_info.get_electric_field();
    var N = engine_info.get_feelds_in_line();
    if (!field.length) return;

    var cols = N + 1;
    var rows = N + 1;
    var potentialScale = getPotentialScale(field);
    var p_max = potentialScale.absMax;
    updateColorbar(potentialScale);

    if (canvas_events.layers.potential_map) {
      var imgD = _.createImageData(cols, rows);
      var data = imgD.data;
      for (var i = 0; i < data.length; i += 4) {
        var idx = i >> 2;
        if (idx >= field.length) break;
        var c = getPotentialColor(field[idx].feeld.p / p_max, 210);
        data[i] = c.r;
        data[i + 1] = c.g;
        data[i + 2] = c.b;
        data[i + 3] = c.a;
      }
      _.putImageData(imgD, 0, 0);
      _.drawImage(canvas, 0, 0, cols, rows, 0, 0, canvas.width, canvas.height);
    } else {
      _.fillStyle = '#e8e3db';
      _.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (canvas_events.layers.equipotential_lines) {
      function edgePoint(edgeId, a, b, c, d, level) {
        if (edgeId === 0) return interpolateIso(level, a, b); // top
        if (edgeId === 1) return interpolateIso(level, b, c); // right
        if (edgeId === 2) return interpolateIso(level, d, c); // bottom
        return interpolateIso(level, a, d); // left
      }
      var caseSegments = {
        0: [],
        1: [[3, 2]],
        2: [[2, 1]],
        3: [[3, 1]],
        4: [[0, 1]],
        5: [[0, 3], [1, 2]],
        6: [[0, 2]],
        7: [[0, 3]],
        8: [[0, 3]],
        9: [[0, 2]],
        10: [[0, 1], [2, 3]],
        11: [[0, 1]],
        12: [[3, 1]],
        13: [[2, 1]],
        14: [[3, 2]],
        15: []
      };
      var levels = [];
      for (var li = -7; li <= 7; li++) {
        if (li !== 0) levels.push(p_max * li / 7);
      }
      levels.forEach(level => {
        _.strokeStyle = getPotentialColorCss(level / p_max, 180);
        _.lineWidth = 1.1;
        for (var y = 0; y < rows - 1; y++) {
          for (var x = 0; x < cols - 1; x++) {
            var i00 = y * cols + x;
            var i10 = i00 + 1;
            var i01 = i00 + cols;
            var i11 = i01 + 1;
            var a = { x: field[i00].x, y: field[i00].y, p: field[i00].feeld.p };
            var b = { x: field[i10].x, y: field[i10].y, p: field[i10].feeld.p };
            var c = { x: field[i11].x, y: field[i11].y, p: field[i11].feeld.p };
            var d = { x: field[i01].x, y: field[i01].y, p: field[i01].feeld.p };
            var idx = (a.p >= level ? 8 : 0) | (b.p >= level ? 4 : 0) | (c.p >= level ? 2 : 0) | (d.p >= level ? 1 : 0);
            var segments = caseSegments[idx];
            if (!segments || !segments.length) continue;
            for (var k = 0; k < segments.length; k++) {
              var p0 = edgePoint(segments[k][0], a, b, c, d, level);
              var p1 = edgePoint(segments[k][1], a, b, c, d, level);
              _.beginPath();
              _.moveTo(p0.x, p0.y);
              _.lineTo(p1.x, p1.y);
              _.stroke();
            }
          }
        }
      });
    }

    if (canvas_events.layers.field_arrows) {
      var aw = canvas.width / N * 0.36;
      var ah = canvas.height / N * 0.36;
      var arrow_len = Math.min(aw, ah);
      var e_mags = field.map(f => Math.hypot(f.feeld.ex, f.feeld.ey));
      var e_max = Math.max(...e_mags) || 1;

      field.forEach((f, idx) => {
        var emag = e_mags[idx];
        if (emag < 1e-30) return;
        var t = Math.log10(1 + emag / e_max * 9);
        var alpha = Math.round(40 + t * 215);
        _.strokeStyle = `rgba(255,255,255,${(alpha / 255).toFixed(2)})`;
        _.lineWidth = 1;

        var enx = f.feeld.ex / emag;
        var eny = f.feeld.ey / emag;
        var xl = enx * t * arrow_len;
        var yl = eny * t * arrow_len;
        var x0 = f.x - xl * 0.5;
        var y0 = f.y - yl * 0.5;
        var x1 = f.x + xl * 0.5;
        var y1 = f.y + yl * 0.5;
        var hd = Math.max(2.5, t * arrow_len * 0.22);

        _.beginPath();
        _.moveTo(x0, y0);
        _.lineTo(x1, y1);
        _.lineTo(x1 - enx * hd * 0.8 + eny * hd * 0.3, y1 - eny * hd * 0.8 - enx * hd * 0.3);
        _.moveTo(x1, y1);
        _.lineTo(x1 - enx * hd * 0.8 - eny * hd * 0.3, y1 - eny * hd * 0.8 + enx * hd * 0.3);
        _.stroke();
      });
    }
  });

  canvas_events.on_draw.push((_, canvas, state) => {
    var px = 1 / state.size;
    var many = engine_info.get_entities().length > 1200;
    var bounds = getWorldBounds(state);

    if (canvas_events.layers.force_lines) {
      _.save();
      _.strokeStyle = 'rgba(255,255,255,0.32)';
      _.lineWidth = Math.max(px * 1.5, 1.1 * px);
      var seeds = getForceLineSeeds(px);
      var stride = Math.max(1, Math.ceil(seeds.length / 90));
      for (var si = 0; si < seeds.length; si += stride) {
        var pts = traceForceLine(seeds[si], bounds, px);
        drawPolyline(_, pts);
      }
      _.restore();
    }

    if (canvas_events.layers.sigma) {
      var bem = engine_info.get_bem_charges();
      Object.values(bem).forEach(segs => {
        if (!segs.length) return;
        var s_max = Math.max(...segs.map(s => Math.abs(s.sigma))) || 1;
        segs.forEach(s => {
          var t = s.sigma / s_max;
          var r = t > 0 ? 220 : Math.round(60 - t * 80);
          var g = Math.round(70 - Math.abs(t) * 50);
          var b = t < 0 ? 220 : Math.round(60 + t * 80);
          _.strokeStyle = `rgb(${r},${g},${b})`;
          _.lineWidth = Math.max(1.5 * px, Math.abs(t) * 10 * px);
          _.beginPath();
          var visual_len = 6 * px * Math.abs(t) + 2 * px;
          _.moveTo(s.x, s.y);
          _.lineTo(s.x + s.nx * visual_len, s.y + s.ny * visual_len);
          _.stroke();
        });
      });
    }

    if (canvas_events.layers.conductors) {
      engine_info.get_entities()
        .map((e, i) => [e, i]).filter(d => d[0].type === 'p')
        .forEach(([e, ind]) => {
        var sel = ind === canvas_events.selected_entity;
        _.lineWidth = 2 * px;
        _.strokeStyle = sel ? '#e8e0d0' : '#8a8078';
        _.fillStyle = sel ? 'rgba(220,200,170,0.18)' : 'rgba(160,150,130,0.12)';

        if (e.shape === 'rectangle') {
          _.fillRect(e.data[0], e.data[1], e.data[2], e.data[3]);
          _.strokeRect(e.data[0], e.data[1], e.data[2], e.data[3]);
        } else if (e.shape === 'ring') {
          var mid = (e.data[2] + e.data[3]) / 2;
          _.lineWidth = e.data[3] - e.data[2];
          _.strokeStyle = sel ? 'rgba(220,200,170,0.25)' : 'rgba(160,150,130,0.15)';
          _.beginPath(); _.arc(e.data[0], e.data[1], mid, 0, 2 * Math.PI); _.stroke();
          _.lineWidth = 2 * px;
          _.strokeStyle = sel ? '#e8e0d0' : '#8a8078';
          _.beginPath(); _.arc(e.data[0], e.data[1], e.data[2], 0, 2 * Math.PI); _.stroke();
          _.beginPath(); _.arc(e.data[0], e.data[1], e.data[3], 0, 2 * Math.PI); _.stroke();
        } else if (e.shape === 'circle') {
          _.beginPath(); _.arc(e.data[0], e.data[1], e.data[2], 0, 2 * Math.PI);
          _.fill(); _.stroke();
        }
      });
    }

    if (canvas_events.layers.charges) {
      engine_info.get_entities()
        .map((e, i) => [e, i]).filter(d => d[0].type === 'q')
        .forEach(([e, ind]) => {
        var sel = ind === canvas_events.selected_entity;
        _.lineWidth = 2 * px;
        _.strokeStyle = sel ? '#ffffff' : 'rgba(0,0,0,0.5)';

        if (!many) {
          _.shadowColor = e.q >= 0 ? 'rgba(220,80,80,0.7)' : 'rgba(80,120,220,0.7)';
          _.shadowBlur = 8 * px;
        }
        _.fillStyle = e.q >= 0 ? '#e84040' : '#4070e0';

        if (many) {
          _.fillRect(e.x - 10 * px, e.y - 10 * px, 20 * px, 20 * px);
        } else {
          _.beginPath(); _.arc(e.x, e.y, 11 * px, 0, 2 * Math.PI);
          _.fill(); _.stroke();
        }
        _.shadowBlur = 0;

        _.fillStyle = '#ffffff';
        if (e.q >= 0) _.fillRect(e.x - 1 * px, e.y - 5.5 * px, 2 * px, 11 * px);
        _.fillRect(e.x - 5.5 * px, e.y - 1 * px, 11 * px, 2 * px);
      });
    }
  });

  function update_tooltip(worldX, worldY) {
    if (!tooltip_el) return;
    var f = engine_info.electric_field(worldX, worldY);
    var emag = Math.hypot(f.ex, f.ey);
    tooltip_el.innerHTML =
      `<span class="tt-row"><span class="tt-label">φ</span><span class="tt-val">${formatMetric(f.p)} В</span></span>` +
      `<span class="tt-row"><span class="tt-label">|E|</span><span class="tt-val">${formatMetric(emag)} В/м</span></span>` +
      `<span class="tt-row"><span class="tt-label">Eₓ</span><span class="tt-val">${formatMetric(f.ex)}</span></span>` +
      `<span class="tt-row"><span class="tt-label">Eᵧ</span><span class="tt-val">${formatMetric(f.ey)}</span></span>`;
  }

  var isDragging = false;
  var dragStart = { x: 0, y: 0 };
  var dragHistorySnapshot = null;
  var lastWheelHistoryAt = 0;
  var startClick = { x: 0, y: 0, is_click: true };
  var cursorWorld = { x: 0, y: 0 };
  var mousePos = document.getElementById('mouse-pos');
  var transformedMouse = document.getElementById('transformed-mouse-pos');

  function onMouseDown(ev) {
    isDragging = true;
    startClick = { x: ev.offsetX, y: ev.offsetY, is_click: true };
    dragStart = getTransformed(ev.offsetX, ev.offsetY);
    dragHistorySnapshot = canvas_events.history.serializeState();
  }

  function onMouseMove(ev) {
    cursorWorld = getTransformed(ev.offsetX, ev.offsetY);
    if (mousePos) mousePos.innerText = `X: ${ev.offsetX}  Y: ${ev.offsetY}`;
    if (transformedMouse) transformedMouse.innerText = `Мир: ${cursorWorld.x.toFixed(3)}  ${cursorWorld.y.toFixed(3)}`;

    update_tooltip(cursorWorld.x, cursorWorld.y);

    if (isDragging) {
      ctx.translate(cursorWorld.x - dragStart.x, cursorWorld.y - dragStart.y);
      if ((ev.offsetX - startClick.x) ** 2 + (ev.offsetY - startClick.y) ** 2 > 25)
        startClick.is_click = false;
      if (!runner.running) engine_info.change();
      canvas_events.need_repaint();
    }
  }

  function onMouseUp(ev) {
    if (isDragging && startClick.is_click) {
      var t = getTransformed(startClick.x, startClick.y);
      canvas_events.on_click.forEach(fn => fn(startClick.x, startClick.y, t.x, t.y));
    } else if (isDragging && dragHistorySnapshot) {
      canvas_events.history.push(dragHistorySnapshot);
    }
    isDragging = false;
    dragHistorySnapshot = null;
    if (!runner.running) engine_info.change();
    canvas_events.need_repaint();
  }

  function onWheel(ev) {
    var now = Date.now();
    if (now - lastWheelHistoryAt > 350) {
      canvas_events.history.push();
      lastWheelHistoryAt = now;
    }
    var zoom = Math.pow(Math.E, -ev.deltaY * Math.log(1.1) / 100);
    ctx.translate(cursorWorld.x, cursorWorld.y);
    ctx.scale(zoom, zoom);
    ctx.translate(-cursorWorld.x, -cursorWorld.y);
    if (!runner.running) engine_info.change();
    canvas_events.need_repaint();
  }

  function onKeyDown(ev) {
    var target = ev.target;
    var inEditor = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if (inEditor) return;
    if (!ev.ctrlKey) return;
    var key = ev.key.toLowerCase();
    if (key === 'z' && !ev.shiftKey) {
      ev.preventDefault();
      canvas_events.history.undo();
    } else if (key === 'y' || (key === 'z' && ev.shiftKey)) {
      ev.preventDefault();
      canvas_events.history.redo();
    }
  }

  canvas.addEventListener('mousedown', onMouseDown, { passive: true });
  canvas.addEventListener('mousemove', onMouseMove, { passive: true });
  canvas.addEventListener('mouseup', onMouseUp, { passive: true });
  canvas.addEventListener('mouseleave', onMouseUp, { passive: true });
  canvas.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('keydown', onKeyDown);

  function t2o(e, touch) {
    var r = e.target.getBoundingClientRect();
    return {
      offsetX: (touch.clientX - r.x) / r.width * e.target.offsetWidth,
      offsetY: (touch.clientY - r.y) / r.height * e.target.offsetHeight
    };
  }
  canvas.addEventListener('touchstart', e => { Object.assign(e, t2o(e, e.touches[0])); onMouseDown(e); }, { passive: false });
  canvas.addEventListener('touchmove', e => { Object.assign(e, t2o(e, e.touches[0])); onMouseMove(e); }, { passive: false });
  canvas.addEventListener('touchend', e => { Object.assign(e, t2o(e, e.changedTouches[0])); onMouseUp(e); }, { passive: false });
  canvas.addEventListener('touchcancel', e => { Object.assign(e, t2o(e, e.changedTouches[0])); onMouseUp(e); }, { passive: false });

  canvas_events.sync_layer_ui();
  canvas_events.history.reset();
  canvas_events.need_repaint();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  setTimeout(() => {
    canvas_events.set_canvas_state({
      x: center_menu.clientWidth / 2,
      y: center_menu.clientHeight / 2,
      size: 14
    });
    engine_info.change();
    canvas_events.history.reset();
  }, 200);
});
