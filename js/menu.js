/* ============================================================
   menu.js  —  инструменты, верхняя/левая панели, импорт/экспорт
   ============================================================
   Картинки (папка images/):
     cursor.png                      — курсор/выбор
     charge.png                      — положительный заряд +
     charge_minus.png                — отрицательный заряд −  [НУЖНО ДОБАВИТЬ]
     electrical_conductor.png        — проводник прямоугольник
     electrical_conductor_circle.png — проводник круг
     electrical_conductor_ring.png   — проводник кольцо
     downloads.png                   — сохранить
     upload.png                      — открыть
   ============================================================ */

// ── Единая валидация числа (поддерживает 1e-9, -3.5 и т.д.) ───────────────
function is_valid_float(s) {
  return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(String(s).trim());
}

// ── Вспомогательная: поставить заряд на канвас ─────────────────────────────
function place_charge(x, y, sign, q_id, m_id, const_id, count_id) {
  var n = Math.max(1, Math.round(parseFloat(document.getElementById(count_id).value)));
  var q = sign * Math.abs(parseFloat(document.getElementById(q_id).value));
  for (var i = 0; i < n; i++) {
    engine_info.set_entities(engine_info.get_entities().concat([{
      type: 'q',
      is_const: document.getElementById(const_id).checked,
      q: q,
      x: x + (n > 1 ? (Math.random() - 0.5) * 0.2 : 0),
      y: y + (n > 1 ? (Math.random() - 0.5) * 0.2 : 0),
      vx: 0, vy: 0,
      m: parseFloat(document.getElementById(m_id).value),
      in_conductor: false
    }]));
  }
}

// ── Описания инструментов ───────────────────────────────────────────────────
var menu_info = [

  // 0: Курсор/выбор
  {
    src: 'images/cursor.png',
    title: 'Курсор (выбор объекта)',
    html: '',
    save_id: [],
    canvas_click: function(x, y) {
      var px = 1 / canvas_events.get_canvas_state().size;
      var sel = -1;
      var ents = engine_info.get_entities();
      ents.forEach(function(e, i) {
        if (e.type !== 'q') return;
        if ((x - e.x) * (x - e.x) + (y - e.y) * (y - e.y) < (px * 14) * (px * 14)) sel = i;
      });
      if (sel < 0) {
        ents.forEach(function(e, i) {
          if (e.type !== 'p') return;
          if (engine_info.in_shape[e.shape](e.data, x, y)) sel = i;
        });
      }
      canvas_events.selected_entity =
          (sel < 0 || sel === canvas_events.selected_entity) ? -1 : sel;
      canvas_events.need_repaint();
      right_menu_h.update_entity();
    }
  },

  // 1: Положительный заряд +
  {
    src: 'images/charge.png',
    title: 'Положительный заряд +',
    html: [
      '|q = <input type="text" id="menu_qp_q" value="1000"><i> e</i>',
      '|Масса: <input type="text" id="menu_qp_m" value="10">',
      '|<label><input type="checkbox" id="menu_qp_const"> фиксированный</label>',
      '|Кол-во: <input type="text" id="menu_qp_n" value="1">'
    ].join(''),
    save_id: ['menu_qp_q', 'menu_qp_m', 'menu_qp_n'],
    canvas_click_check_float_id: ['menu_qp_q', 'menu_qp_m', 'menu_qp_n'],
    canvas_click: function(x, y) {
      place_charge(x, y, +1, 'menu_qp_q', 'menu_qp_m', 'menu_qp_const', 'menu_qp_n');
    }
  },

  // 2: Отрицательный заряд −
  {
    src: 'images/charge_minus.png',
    title: 'Отрицательный заряд −',
    html: [
      '|q = &minus;<input type="text" id="menu_qn_q" value="1000"><i> e</i>',
      '|Масса: <input type="text" id="menu_qn_m" value="10">',
      '|<label><input type="checkbox" id="menu_qn_const"> фиксированный</label>',
      '|Кол-во: <input type="text" id="menu_qn_n" value="1">'
    ].join(''),
    save_id: ['menu_qn_q', 'menu_qn_m', 'menu_qn_n'],
    canvas_click_check_float_id: ['menu_qn_q', 'menu_qn_m', 'menu_qn_n'],
    canvas_click: function(x, y) {
      place_charge(x, y, -1, 'menu_qn_q', 'menu_qn_m', 'menu_qn_const', 'menu_qn_n');
    }
  },

  // 3: Проводник — прямоугольник
  {
    src: 'images/electrical_conductor.png',
    title: 'Проводник — прямоугольник',
    html: [
      '|Ширина: <input type="text" id="menu_pr_w" value="5">',
      '|Высота: <input type="text" id="menu_pr_h" value="3">'
    ].join(''),
    save_id: ['menu_pr_w', 'menu_pr_h'],
    canvas_click_check_float_id: ['menu_pr_w', 'menu_pr_h'],
    canvas_click: function(x, y) {
      var w = parseFloat(document.getElementById('menu_pr_w').value);
      var h = parseFloat(document.getElementById('menu_pr_h').value);
      engine_info.set_entities(engine_info.get_entities().concat([{
        type: 'p', shape: 'rectangle',
        data: [x - w / 2, y - h / 2, w, h]
      }]));
    }
  },

  // 4: Проводник — круг
  {
    src: 'images/electrical_conductor_circle.png',
    title: 'Проводник — круг',
    html: '|Радиус: <input type="text" id="menu_pc_r" value="3">',
    save_id: ['menu_pc_r'],
    canvas_click_check_float_id: ['menu_pc_r'],
    canvas_click: function(x, y) {
      engine_info.set_entities(engine_info.get_entities().concat([{
        type: 'p', shape: 'circle',
        data: [x, y, parseFloat(document.getElementById('menu_pc_r').value)]
      }]));
    }
  },

  // 5: Проводник — кольцо
  {
    src: 'images/electrical_conductor_ring.png',
    title: 'Проводник — кольцо',
    html: [
      '|R внутр: <input type="text" id="menu_pk_r1" value="2">',
      '|R внешн: <input type="text" id="menu_pk_r2" value="4">'
    ].join(''),
    save_id: ['menu_pk_r1', 'menu_pk_r2'],
    canvas_click_check_float_id: ['menu_pk_r1', 'menu_pk_r2'],
    canvas_click: function(x, y) {
      engine_info.set_entities(engine_info.get_entities().concat([{
        type: 'p', shape: 'ring',
        data: [x, y,
          parseFloat(document.getElementById('menu_pk_r1').value),
          parseFloat(document.getElementById('menu_pk_r2').value)]
      }]));
    }
  },

  // 6: Сохранить (нет html → не вызывает select_menu_item)
  {
    src: 'images/downloads.png',
    title: 'Сохранить сцену',
    onclick: 'export_scene()',
    save_id: []
  },

  // 7: Открыть / загрузить сцену
  {
    src: 'images/upload.png',
    title: 'Открыть / загрузить сцену',
    html: '',
    save_id: []
  }

];

// ── Состояние меню ──────────────────────────────────────────────────────────
var menu = { selected: -1, info: menu_info, on_change: [], value_of_save_id: {} };

// ── Инициализация левой панели ──────────────────────────────────────────────
_onload.push(function() {

  // Кнопки
  left_menu.innerHTML = menu_info.map(function(item, i) {
    var oc = '';
    if (item.html !== undefined) oc += 'select_menu_item(' + i + ');';
    if (item.onclick)            oc += item.onclick;
    return '<button title="' + item.title + '" onclick="' + oc + '" ' +
        'style="background-image:url(' + item.src + ')"></button>';
  }).join('\n');

  // Клики на канвас → вызов canvas_click текущего инструмента
  canvas_events.on_click.push(function(sx, sy, wx, wy) {
    var item = menu_info[menu.selected];
    if (!item || !item.canvas_click) return;
    var valid = true;
    (item.canvas_click_check_float_id || []).forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (!is_valid_float(el.value)) {
        valid = false;
        [0, 280, 560].forEach(function(t) {
          setTimeout(function() { el.style.borderColor = '#c0392b'; }, t);
          setTimeout(function() { el.style.borderColor = ''; }, t + 140);
        });
      }
    });
    if (valid) item.canvas_click(wx, wy);
  });

});

_onload.push(function() { select_menu_item(0); });

// ── Переключение инструмента ────────────────────────────────────────────────
function select_menu_item(i) {
  if (menu.selected === i) return;

  // Сохраняем поля предыдущего инструмента
  if (menu.selected >= 0) {
    (menu_info[menu.selected].save_id || []).forEach(function(id) {
      var el = document.getElementById(id);
      if (el) menu.value_of_save_id[id] = el.value;
    });
  }

  menu.selected = i;
  var item = menu_info[i];
  var L = canvas_events.layers;

  // Переключатели слоёв
  var layers_html =
      '<div class="dline"></div>' +
      '<label class="layer-toggle" title="Цветовая карта потенциала φ">' +
      '<input type="checkbox"' + (L.potential_map ? ' checked' : '') +
      ' onchange="canvas_events.layers.potential_map=this.checked;canvas_events.need_repaint()"> φ-карта' +
      '</label>' +
      '<label class="layer-toggle" title="Стрелки вектора напряжённости E">' +
      '<input type="checkbox"' + (L.field_arrows ? ' checked' : '') +
      ' onchange="canvas_events.layers.field_arrows=this.checked;canvas_events.need_repaint()"> Стрелки E' +
      '</label>' +
      '<label class="layer-toggle" title="Поверхностная плотность заряда σ на проводниках">' +
      '<input type="checkbox"' + (L.sigma ? ' checked' : '') +
      ' onchange="canvas_events.layers.sigma=this.checked;' +
      'document.getElementById(\'sigma_legend\').classList.toggle(\'visible\',this.checked);' +
      'canvas_events.need_repaint()"> σ' +
      '</label>';

  // Параметры инструмента
  var tool_html = item.html
      ? item.html.replace(/\|/g, '<div class="dline"></div>')
      : '';

  // Скорость симуляции
  var speed_opts = [0, 0.25, 0.5, 1, 2, 3, 4, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 10000, 100000]
      .map(function(v) {
        return v === 0
            ? '<option value="0">стоп</option>'
            : '<option value="' + v + '"' + (v === runner.speed && runner.running ? ' selected' : '') + '>&times;' + v + '</option>';
      }).join('');

  top_menu.innerHTML =
      '<img src="' + item.src + '" title="' + item.title + '" style="opacity:.85">' +
      tool_html +
      layers_html +
      '<select id="speed" onchange="speed_change()" title="Скорость симуляции">' + speed_opts + '</select>';

  setTimeout(function() {
    // Восстанавливаем сохранённые значения полей
    (item.save_id || []).forEach(function(id) {
      var el = document.getElementById(id);
      if (el && menu.value_of_save_id[id] !== undefined)
        el.value = menu.value_of_save_id[id];
    });
    // Подсвечиваем активную кнопку
    left_menu.querySelectorAll('button').forEach(function(btn, idx) {
      btn.classList.toggle('active', idx === i);
    });
    menu.on_change.forEach(function(fn) { fn(); });
  });
}

// ── Экспорт ─────────────────────────────────────────────────────────────────
function export_scene() {
  var obj = {
    e: engine_info.get_entities(),
    canvas: canvas_events.get_canvas_state()
  };
  var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ephysics_' + new Date().toJSON().slice(0, 19).replace(/[T:-]/g, '_') + '.ephy';
  a.click();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
}

// ── Импорт ───────────────────────────────────────────────────────────────────
function import_scene_text(text) {
  try {
    var obj = JSON.parse(text);
    engine_info.set_entities(obj.e);
    canvas_events.set_canvas_state(obj.canvas);
    engine_info.change();
  } catch (err) {
    alert('Ошибка загрузки файла:\n' + err.message);
  }
}

function upload_file(callback) {
  var f = document.createElement('input');
  f.type = 'file'; f.accept = '.ephy'; f.style.display = 'none';
  f.addEventListener('change', function() {
    if (!f.files.length) return;
    var fr = new FileReader();
    fr.onload = function(ev) { callback(ev.target.result); };
    fr.readAsText(f.files[0], 'UTF-8');
  });
  document.body.appendChild(f);
  f.click();
  setTimeout(function() { try { f.remove(); } catch(e) {} }, 30000);
}

var import_examples = [
  { file: 'adron.ephy', label: 'Адронный коллайдер' },
  { file: 'cond.ephy',  label: 'Конденсатор' },
  { file: 'kek.ephy',   label: 'Красота' },
  { file: 'ring1.ephy', label: 'Кольцо' },
  { file: 'ring2.ephy', label: 'Кольцо 2' },
  { file: null,         label: 'Загрузить файл...' }
];

_onload.push(function() {
  menu.on_change.push(function() {
    var is_open = menu_info[menu.selected].title.startsWith('Открыть');
    select_file.style.display = is_open ? '' : 'none';
    canvas.style.display      = is_open ? 'none' : '';
    if (!is_open) { setTimeout(front_resize); return; }

    select_file.innerHTML =
        '<p style="color:var(--text-2);font-size:12px;margin:0 0 8px">Выберите пример или загрузите файл:</p>' +
        import_examples.map(function(ex, i) {
          return '<input type="button" value="' + ex.label + '" onclick="import_template(' + i + ')">';
        }).join('');
  });
});

function import_template(i) {
  if (typeof runner !== 'undefined') runner.stop();
  var sp = document.getElementById('speed');
  if (sp) sp.value = 0;

  var ex = import_examples[i];
  if (!ex.file) {
    upload_file(function(text) { import_scene_text(text); select_menu_item(0); });
  } else {
    fetch('examples/' + ex.file)
        .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function(text) { import_scene_text(text); select_menu_item(0); })
        .catch(function(e) { alert('Не удалось загрузить «' + ex.label + '»:\n' + e.message); });
  }
  canvas_events.selected_entity = -1;
  if (typeof right_menu_h !== 'undefined') right_menu_h.update_entity();
}

// ── Скорость симуляции ───────────────────────────────────────────────────────
function speed_change() {
  var el = document.getElementById('speed');
  if (!el) return;
  var v = parseFloat(el.value);
  if (v === 0) runner.stop();
  else { runner.speed = v; runner.start(); }
}
