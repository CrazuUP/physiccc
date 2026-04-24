var runner = {
	fpss: [],
	last_fps: -1,
	_run: ()=>{
		if (!runner.running) return;
		
		if (runner.last_eval_time) {
			engine_info.run(Math.min(+new Date()-runner.last_eval_time,100)/1000*runner.speed);
		} else
			engine_info.run(1/75*runner.speed);
		
		{ // FPS update
			var new_fps=1000/(+new Date()-runner.last_eval_time);
			if (new_fps>3) runner.fpss.push(new_fps);
			if (runner.fpss.length>100) runner.fpss.shift();
			new_fps = Math.round(runner.fpss.reduce((a,b)=>a+b,0)/runner.fpss.length);
			if (Math.abs(runner.last_fps-new_fps)>1) {
				runner.last_fps = new_fps;
				fps.innerHTML = 'FPS: '+new_fps;
			}
		}
		
		runner.last_eval_time = +new Date();
		window.requestAnimationFrame(runner._run);
	},
	
	start: ()=>{
		if (!runner.running){
			runner.running = true;
			runner._run();
		}
	},
	
	stop: ()=>{
		if (runner.running){
			runner.running = false;
			runner.last_eval_time = 0;
		}
		right_menu_h.change_info();
	},
	speed: 1,
	running: false,
	last_eval_time: 0
};
