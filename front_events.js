function front_resize() {
	var v = canvas_events.get_canvas_state();
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
	setTimeout(()=>{
		canvas_events.need_repaint();
		canvas_events.set_canvas_state(v);
	});
}


_onload.push(() => {
	addEventListener("resize", front_resize);
	front_resize();
});