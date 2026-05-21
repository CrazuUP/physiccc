/* runner.js — игровой цикл */
var runner = {
  fpss: [], last_fps: -1, running: false, speed: 1, last_eval_time: 0,

  _run: () => {
    if (!runner.running) return;
    if (canvas_events.history) canvas_events.history.maybe_autosnapshot();
    var dt = runner.last_eval_time
      ? Math.min(+new Date() - runner.last_eval_time, 100) / 1000 * runner.speed
      : 1/75 * runner.speed;
    engine_info.run(dt);

    var now = +new Date();
    var new_fps = 1000 / (now - runner.last_eval_time);
    if (new_fps > 3) runner.fpss.push(new_fps);
    if (runner.fpss.length > 100) runner.fpss.shift();
    new_fps = Math.round(runner.fpss.reduce((a,b)=>a+b,0)/runner.fpss.length);
    if (Math.abs(runner.last_fps - new_fps) > 1) {
      runner.last_fps = new_fps;
      var el = document.getElementById('fps');
      if (el) el.innerHTML = 'FPS: ' + new_fps;
    }
    runner.last_eval_time = now;
    window.requestAnimationFrame(runner._run);
  },

  start: () => { if (!runner.running) { runner.running = true; runner._run(); } },
  stop:  () => {
    if (runner.running) { runner.running = false; runner.last_eval_time = 0; }
    if (typeof right_menu_h !== 'undefined') right_menu_h.change_info();
  },
};
