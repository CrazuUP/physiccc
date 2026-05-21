/* ============================================================
   canvas.js  —  отрисовка, события, тултип, история
   ============================================================ */

var canvas_events = {
  selected_entity: -1,

  layers: {
    potential_map:       true,
    field_arrows:        true,
    equipotential_lines: false,
    force_lines:         false,
    conductors:          true,
    charges:             true,
    sigma:               true,
  },

  on_draw_background: [],
  on_draw: [],
  on_move: [],
  on_click: [],

  autopaint: false,
  need_repaint() {
    if (!canvas_events.autopaint) requestAnimationFrame(canvas_events.repaint);
    canvas_events.autopaint = true;
  },
  get_canvas:       () => [null, null],
  repaint:          () => {},
  get_canvas_state: () => ({ x:0, y:0, size:1 }),
  set_canvas_state: () => {},
  sync_layer_ui:    () => {},
  after_scene_change: () => {},

  // ── История ──────────────────────────────────────────────────────────────
  history: {
    past: [], future: [],
    maxSteps: 200,
    autosnapshotEveryMs: 120,
    lastAutoAt: 0,
    suspended: false,

    serialize() {
      return {
        entities:  JSON.parse(JSON.stringify(engine_info.get_entities())),
        constants: JSON.parse(JSON.stringify(engine_info.constants)),
        canvas:    JSON.parse(JSON.stringify(canvas_events.get_canvas_state())),
        sel:       canvas_events.selected_entity,
      };
    },
    equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); },

    push(snapshot) {
      if (canvas_events.history.suspended) return;
      var s = snapshot || canvas_events.history.serialize();
      var last = canvas_events.history.past[canvas_events.history.past.length-1];
      if (last && canvas_events.history.equal(last, s)) return;
      canvas_events.history.past.push(s);
      if (canvas_events.history.past.length > canvas_events.history.maxSteps)
        canvas_events.history.past.shift();
      canvas_events.history.future = [];
      canvas_events.history.lastAutoAt = Date.now();
      canvas_events.history.updateControls();
    },

    reset() {
      canvas_events.history.past = [];
      canvas_events.history.future = [];
      canvas_events.history.lastAutoAt = Date.now();
      canvas_events.history.updateControls();
    },

    maybe_autosnapshot() {
      if (canvas_events.history.suspended) return;
      if (Date.now() - canvas_events.history.lastAutoAt < canvas_events.history.autosnapshotEveryMs) return;
      canvas_events.history.push();
    },

    apply(snapshot) {
      if (!snapshot) return;
      canvas_events.history.suspended = true;
      if (typeof runner !== 'undefined' && runner.running) {
        runner.running = false; runner.last_eval_time = 0;
      }
      engine_info.set_entities(JSON.parse(JSON.stringify(snapshot.entities)));
      Object.assign(engine_info.constants, JSON.parse(JSON.stringify(snapshot.constants)));
      canvas_events.selected_entity = snapshot.sel;
      canvas_events.set_canvas_state(snapshot.canvas);
      engine_info.change();
      canvas_events.after_scene_change();
      canvas_events.need_repaint();
      canvas_events.history.suspended = false;
      canvas_events.history.updateControls();
    },

    undo() {
      if (!canvas_events.history.past.length) { canvas_events.history.updateControls(); return; }
      var cur = canvas_events.history.serialize();
      var tgt = canvas_events.history.past.pop();
      canvas_events.history.future.push(cur);
      canvas_events.history.apply(tgt);
    },

    redo() {
      if (!canvas_events.history.future.length) { canvas_events.history.updateControls(); return; }
      var cur = canvas_events.history.serialize();
      var tgt = canvas_events.history.future.pop();
      canvas_events.history.past.push(cur);
      canvas_events.history.apply(tgt);
    },

    updateControls() {
      var u = document.getElementById('history_undo_btn');
      var r = document.getElementById('history_redo_btn');
      if (u) u.disabled = canvas_events.history.past.length === 0;
      if (r) r.disabled = canvas_events.history.future.length === 0;
    },

    // Alias for backwards compat
    serializeState() { return canvas_events.history.serialize(); },
    statesEqual(a,b)  { return canvas_events.history.equal(a,b); },
  }
};

// ─────────────────────────────────────────────────────────────────────────────

_onload.push(() => {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // ── Вспомогательные утилиты ───────────────────────────────────────────────
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  function fmtMetric(v) {
    var a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1e9)  return (v/1e9).toFixed(2) + 'G';
    if (a >= 1e6)  return (v/1e6).toFixed(2) + 'M';
    if (a >= 1e3)  return (v/1e3).toFixed(2) + 'k';
    if (a >= 1)    return v.toFixed(3);
    if (a >= 1e-3) return (v*1e3).toFixed(2) + 'm';
    return v.toExponential(2);
  }

  function trimZ(s) {
    return s.replace(/\.0+($|[a-zA-Z])/g,'$1').replace(/(\.\d*?)0+($|[a-zA-Z])/g,'$1$2');
  }
  function fmtCompact(v) {
    var a=Math.abs(v);
    if(a===0) return '0';
    if(a>=1e9) return trimZ((v/1e9).toFixed(a>=1e11?0:1)+'G');
    if(a>=1e6) return trimZ((v/1e6).toFixed(a>=1e8?0:1)+'M');
    if(a>=1e3) return trimZ((v/1e3).toFixed(a>=1e5?0:1)+'k');
    if(a>=100) return v.toFixed(0);
    if(a>=10)  return trimZ(v.toFixed(1));
    if(a>=1)   return trimZ(v.toFixed(2));
    if(a>=1e-3)return trimZ((v*1e3).toFixed(a>=0.1?0:1)+'m');
    return v.toExponential(1);
  }
  function fmtTick(v, eps) {
    if(Math.abs(v)<=(eps||0)) v=0;
    return (v>0?'+':'')+fmtCompact(v)+'\u00a0V';
  }

  // ── Цвет потенциала ───────────────────────────────────────────────────────
  function potColor(pn, alpha) {
    pn = clamp(pn, -1, 1);
    return {
      r: Math.round(pn>0 ? 60+pn*170 : 60+pn*40),
      g: Math.round(55-Math.abs(pn)*40),
      b: Math.round(pn<0 ? 60-pn*170 : 60-pn*40),
      a: alpha===undefined ? 255 : alpha,
    };
  }
  function potColorCss(pn, alpha) {
    var c=potColor(pn, alpha);
    return `rgba(${c.r},${c.g},${c.b},${(c.a/255).toFixed(3)})`;
  }

  // ── Масштаб потенциала ────────────────────────────────────────────────────
  function getPotentialScale(field) {
    var pmin=Infinity, pmax=-Infinity;
    field.forEach(item=>{
      var p=item&&item.feeld?item.feeld.p:NaN;
      if(!Number.isFinite(p)) return;
      pmin=Math.min(pmin,p); pmax=Math.max(pmax,p);
    });
    if(!Number.isFinite(pmin)){pmin=-1;pmax=1;}
    var abs=Math.max(Math.abs(pmin),Math.abs(pmax),field._p_max||0,1e-12);
    if(Math.abs(pmax-pmin)<1e-12){pmin-=abs*0.5;pmax+=abs*0.5;}
    return {min:pmin,max:pmax,absMax:abs};
  }

  // ── Colorbar ─────────────────────────────────────────────────────────────
  var cbEl   = document.getElementById('potential_colorbar');
  var cbMin  = document.getElementById('potential_colorbar_min');
  var cbNMid = document.getElementById('potential_colorbar_neg_mid');
  var cbMid  = document.getElementById('potential_colorbar_mid');
  var cbPMid = document.getElementById('potential_colorbar_pos_mid');
  var cbMax  = document.getElementById('potential_colorbar_max');
  var cbRange= document.getElementById('potential_colorbar_range');
  var cbTicks= [cbMin,cbNMid,cbMid,cbPMid,cbMax];

  function setCbVisible(v) {
    if(cbEl) cbEl.classList.toggle('visible', v);
    if(document.body) document.body.classList.toggle('potential-colorbar-visible', v);
  }

  function buildGrad(scale) {
    var stops=[], span=scale.max-scale.min;
    for(var i=0;i<=12;i++){
      var pos=i/12, p=scale.min+span*pos;
      stops.push(`${potColorCss(p/scale.absMax,220)} ${(pos*100).toFixed(1)}%`);
    }
    return `linear-gradient(90deg,${stops.join(',')})`;
  }

  function updateColorbar(scale) {
    if(!cbEl) return;
    var vis=canvas_events.layers.potential_map;
    setCbVisible(vis);
    if(!vis) return;
    var span=scale.max-scale.min, eps=scale.absMax*1e-9;
    cbEl.style.setProperty('--potential-scale', buildGrad(scale));
    cbEl.style.setProperty('--potential-zero-pos', `${clamp((0-scale.min)/span,0,1)*100}%`);
    cbEl.style.setProperty('--potential-zero-opacity', (scale.min<=0&&scale.max>=0)?'1':'0');
    cbTicks.forEach((el,i)=>{ if(el) el.textContent=fmtTick(scale.min+span*i/4, eps); });
    if(cbRange) cbRange.textContent=fmtTick(scale.min,eps)+' … '+fmtTick(scale.max,eps);
  }

  // ── Трансформ канваса ─────────────────────────────────────────────────────
  canvas_events.get_canvas        = ()=>[canvas,ctx];
  canvas_events.get_canvas_state  = ()=>{ var p=ctx.getTransform(); return {x:p.e,y:p.f,size:p.a}; };
  canvas_events.set_canvas_state  = obj=>{ ctx.setTransform(obj.size,0,0,obj.size,obj.x,obj.y); canvas_events.need_repaint(); };

  function getTransformed(ox, oy) {
    return ctx.getTransform().invertSelf().transformPoint(new DOMPoint(ox,oy));
  }
  function worldBounds(state) {
    return {
      x0:-state.x/state.size, y0:-state.y/state.size,
      x1:-state.x/state.size+canvas.width/state.size,
      y1:-state.y/state.size+canvas.height/state.size,
      w:canvas.width/state.size, h:canvas.height/state.size,
    };
  }

  // ── sync_layer_ui ─────────────────────────────────────────────────────────
  canvas_events.sync_layer_ui = () => {
    var sl=document.getElementById('sigma_legend');
    if(sl) sl.classList.toggle('visible', !!canvas_events.layers.sigma);
    setCbVisible(!!canvas_events.layers.potential_map);
  };

  canvas_events.after_scene_change = () => {
    canvas_events.sync_layer_ui();
    if(typeof right_menu_h!=='undefined'){right_menu_h.id=-2; right_menu_h.update_entity();}
  };

  // ── Рендер ───────────────────────────────────────────────────────────────
  canvas_events.repaint = () => {
    canvas_events.autopaint = false;
    var state = canvas_events.get_canvas_state();
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(canvas.width<10||canvas.height<10){ctx.restore();return;}
    canvas_events.on_draw_background.forEach(fn=>fn(ctx,canvas,state));
    ctx.restore();
    canvas_events.on_draw.forEach(fn=>fn(ctx,canvas,state));
  };

  // ── Слой 1: фон (карта потенциала, эквипотенциали, стрелки E) ─────────────
  canvas_events.on_draw_background.push((_, canvas, state) => {
    var field=engine_info.get_electric_field();
    var N=engine_info.get_feelds_in_line();
    if(!field.length) return;
    var cols=N+1, rows=N+1;
    var scale=getPotentialScale(field);
    updateColorbar(scale);

    // ─ Карта потенциала ─
    if(canvas_events.layers.potential_map) {
      var imgD=_.createImageData(cols,rows);
      var data=imgD.data;
      for(var i=0;i<data.length;i+=4){
        var idx=i>>2; if(idx>=field.length) break;
        var c=potColor(field[idx].feeld.p/scale.absMax,210);
        data[i]=c.r; data[i+1]=c.g; data[i+2]=c.b; data[i+3]=c.a;
      }
      _.putImageData(imgD,0,0);
      _.drawImage(canvas,0,0,cols,rows,0,0,canvas.width,canvas.height);
    } else {
      _.fillStyle='#1a1f2e';
      _.fillRect(0,0,canvas.width,canvas.height);
    }

    // ─ Эквипотенциали (marching squares) ─
    if(canvas_events.layers.equipotential_lines) {
      var edges={
        0:[],1:[[3,2]],2:[[2,1]],3:[[3,1]],4:[[0,1]],
        5:[[0,3],[1,2]],6:[[0,2]],7:[[0,3]],8:[[0,3]],
        9:[[0,2]],10:[[0,1],[2,3]],11:[[0,1]],12:[[3,1]],
        13:[[2,1]],14:[[3,2]],15:[]
      };
      function interp(lv,a,b){ var den=b.p-a.p,t=Math.abs(den)<1e-12?.5:(lv-a.p)/den; return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}; }
      function edgePt(eid,a,b,c,d,lv){
        if(eid===0) return interp(lv,a,b);
        if(eid===1) return interp(lv,b,c);
        if(eid===2) return interp(lv,d,c);
        return interp(lv,a,d);
      }
      var levels=[];
      for(var li=-8;li<=8;li++) if(li!==0) levels.push(scale.absMax*li/8);
      levels.forEach(lv=>{
        _.strokeStyle=potColorCss(lv/scale.absMax,170);
        _.lineWidth=1.2;
        for(var y=0;y<rows-1;y++){
          for(var x=0;x<cols-1;x++){
            var i00=y*cols+x,i10=i00+1,i01=i00+cols,i11=i01+1;
            var a={x:field[i00].x,y:field[i00].y,p:field[i00].feeld.p};
            var b={x:field[i10].x,y:field[i10].y,p:field[i10].feeld.p};
            var c={x:field[i11].x,y:field[i11].y,p:field[i11].feeld.p};
            var d={x:field[i01].x,y:field[i01].y,p:field[i01].feeld.p};
            var idx=(a.p>=lv?8:0)|(b.p>=lv?4:0)|(c.p>=lv?2:0)|(d.p>=lv?1:0);
            var segs=edges[idx];
            if(!segs||!segs.length) continue;
            for(var k=0;k<segs.length;k++){
              var p0=edgePt(segs[k][0],a,b,c,d,lv),p1=edgePt(segs[k][1],a,b,c,d,lv);
              _.beginPath(); _.moveTo(p0.x,p0.y); _.lineTo(p1.x,p1.y); _.stroke();
            }
          }
        }
      });
    }

    // ─ Стрелки E ─
    if(canvas_events.layers.field_arrows) {
      var aw=canvas.width/N*0.36, ah=canvas.height/N*0.36;
      var alen=Math.min(aw,ah);
      var emags=field.map(f=>Math.hypot(f.feeld.ex,f.feeld.ey));
      var emax=Math.max(...emags)||1;
      field.forEach((f,idx)=>{
        var em=emags[idx]; if(em<1e-30) return;
        var t=Math.log10(1+em/emax*9);
        var alpha=Math.round(40+t*215);
        _.strokeStyle=`rgba(255,255,255,${(alpha/255).toFixed(2)})`;
        _.lineWidth=1;
        var enx=f.feeld.ex/em, eny=f.feeld.ey/em;
        var xl=enx*t*alen, yl=eny*t*alen;
        var x0=f.x-xl*.5,y0=f.y-yl*.5,x1=f.x+xl*.5,y1=f.y+yl*.5;
        var hd=Math.max(2.5,t*alen*.22);
        _.beginPath();
        _.moveTo(x0,y0); _.lineTo(x1,y1);
        _.lineTo(x1-enx*hd*.8+eny*hd*.3, y1-eny*hd*.8-enx*hd*.3);
        _.moveTo(x1,y1);
        _.lineTo(x1-enx*hd*.8-eny*hd*.3, y1-eny*hd*.8+enx*hd*.3);
        _.stroke();
      });
    }
  });

  // ── Слой 2: объекты мира (силовые, σ, проводники, заряды) ────────────────

  // Интегрирование силовых линий
  function isInBounds(pt,b,pad){ return pt.x>=b.x0-pad&&pt.x<=b.x1+pad&&pt.y>=b.y0-pad&&pt.y<=b.y1+pad; }
  function nearNegQ(x,y,px){ return engine_info.get_entities().some(e=>e.type==='q'&&e.q<0&&(e.x-x)**2+(e.y-y)**2<(px*18)**2); }

  function traceFL(seed, bounds, px) {
    var pts=[{x:seed.x,y:seed.y}], x=seed.x, y=seed.y;
    var base=Math.max(px*3.5,Math.min(bounds.w,bounds.h)/180);
    var prev=null;
    for(var i=0;i<450;i++){
      var f=engine_info.electric_field(x,y);
      var em=Math.hypot(f.ex,f.ey); if(em<1e-8) break;
      var dx=f.ex/em, dy=f.ey/em;
      if(prev){ var sm=.7; dx=prev.x*sm+dx*(1-sm); dy=prev.y*sm+dy*(1-sm); var dn=Math.hypot(dx,dy)||1; dx/=dn; dy/=dn; }
      prev={x:dx,y:dy};
      var step=clamp(base*(1/(1+Math.log10(1+em))),base*.45,base*1.8);
      x+=dx*step; y+=dy*step;
      if(!isInBounds({x,y},bounds,step*2.5)) break;
      var lp=pts[pts.length-1];
      if((lp.x-x)**2+(lp.y-y)**2<(px*.85)**2) break;
      pts.push({x,y});
      if(nearNegQ(x,y,px)) break;
    }
    return pts;
  }

  function getFLseeds(px) {
    var seeds=[], ents=engine_info.get_entities();
    ents.forEach(e=>{
      if(e.type!=='q'||e.q<=0) return;
      var n=Math.max(14,Math.min(34,Math.round(Math.sqrt(Math.abs(e.q))*.8)));
      for(var i=0;i<n;i++){var phi=2*Math.PI*i/n; seeds.push({x:e.x+Math.cos(phi)*px*14,y:e.y+Math.sin(phi)*px*14});}
    });
    Object.values(engine_info.get_bem_charges()).forEach(segs=>{
      var pos=segs.filter(s=>s.sigma>0); if(!pos.length) return;
      var stride=Math.max(1,Math.ceil(pos.length/40));
      for(var i=0;i<pos.length;i+=stride){var s=pos[i]; seeds.push({x:s.x+s.nx*px*7,y:s.y+s.ny*px*7});}
    });
    return seeds;
  }

  function polyline(_, pts) {
    if(pts.length<2) return;
    _.beginPath(); _.moveTo(pts[0].x,pts[0].y);
    for(var i=1;i<pts.length;i++) _.lineTo(pts[i].x,pts[i].y);
    _.stroke();
  }

  canvas_events.on_draw.push((_, canvas, state) => {
    var px=1/state.size;
    var many=engine_info.get_entities().length>1200;
    var bounds=worldBounds(state);

    // ─ Силовые линии ─
    if(canvas_events.layers.force_lines) {
      _.save();
      _.strokeStyle='rgba(255,255,255,0.32)';
      _.lineWidth=Math.max(px*1.5,1.1*px);
      var seeds=getFLseeds(px);
      var stride=Math.max(1,Math.ceil(seeds.length/90));
      for(var si=0;si<seeds.length;si+=stride) polyline(_,traceFL(seeds[si],bounds,px));
      _.restore();
    }

    // ─ Плотность заряда σ ─
    if(canvas_events.layers.sigma) {
      var bem=engine_info.get_bem_charges();
      Object.values(bem).forEach(segs=>{
        if(!segs.length) return;
        var smax=Math.max(...segs.map(s=>Math.abs(s.sigma)))||1;
        segs.forEach(s=>{
          var t=s.sigma/smax;
          var r=t>0?220:Math.round(60-t*80);
          var g=Math.round(70-Math.abs(t)*50);
          var b=t<0?220:Math.round(60+t*80);
          _.strokeStyle=`rgb(${r},${g},${b})`;
          _.lineWidth=Math.max(1.5*px,Math.abs(t)*10*px);
          _.beginPath();
          var vl=6*px*Math.abs(t)+2*px;
          _.moveTo(s.x,s.y); _.lineTo(s.x+s.nx*vl,s.y+s.ny*vl);
          _.stroke();
        });
      });
    }

    // ─ Проводники ─
    if(canvas_events.layers.conductors) {
      engine_info.get_entities().map((e,i)=>[e,i]).filter(d=>d[0].type==='p').forEach(([e,ind])=>{
        var sel=ind===canvas_events.selected_entity;
        _.lineWidth=2*px;
        _.strokeStyle=sel?'#e8e0d0':'#8a8078';
        _.fillStyle=sel?'rgba(220,200,170,0.18)':'rgba(160,150,130,0.12)';
        if(e.shape==='rectangle'){
          _.fillRect(e.data[0],e.data[1],e.data[2],e.data[3]);
          _.strokeRect(e.data[0],e.data[1],e.data[2],e.data[3]);
        } else if(e.shape==='ring'){
          var mid=(e.data[2]+e.data[3])/2;
          _.lineWidth=e.data[3]-e.data[2];
          _.strokeStyle=sel?'rgba(220,200,170,0.25)':'rgba(160,150,130,0.15)';
          _.beginPath(); _.arc(e.data[0],e.data[1],mid,0,2*Math.PI); _.stroke();
          _.lineWidth=2*px; _.strokeStyle=sel?'#e8e0d0':'#8a8078';
          _.beginPath(); _.arc(e.data[0],e.data[1],e.data[2],0,2*Math.PI); _.stroke();
          _.beginPath(); _.arc(e.data[0],e.data[1],e.data[3],0,2*Math.PI); _.stroke();
        } else if(e.shape==='circle'){
          _.beginPath(); _.arc(e.data[0],e.data[1],e.data[2],0,2*Math.PI);
          _.fill(); _.stroke();
        }
      });
    }

    // ─ Заряды ─
    if(canvas_events.layers.charges) {
      engine_info.get_entities().map((e,i)=>[e,i]).filter(d=>d[0].type==='q').forEach(([e,ind])=>{
        var sel=ind===canvas_events.selected_entity;
        _.lineWidth=2*px;
        _.strokeStyle=sel?'#ffffff':'rgba(0,0,0,0.5)';
        if(!many){ _.shadowColor=e.q>=0?'rgba(220,80,80,0.7)':'rgba(80,120,220,0.7)'; _.shadowBlur=8*px; }
        _.fillStyle=e.q>=0?'#e84040':'#4070e0';
        if(many){ _.fillRect(e.x-10*px,e.y-10*px,20*px,20*px); }
        else { _.beginPath(); _.arc(e.x,e.y,11*px,0,2*Math.PI); _.fill(); _.stroke(); }
        _.shadowBlur=0;
        _.fillStyle='#ffffff';
        if(e.q>=0) _.fillRect(e.x-px,e.y-5.5*px,2*px,11*px);
        _.fillRect(e.x-5.5*px,e.y-px,11*px,2*px);
      });
    }
  });

  // ── Тултип ───────────────────────────────────────────────────────────────
  var ttEl=document.getElementById('field_tooltip');
  function updateTooltip(wx,wy){
    if(!ttEl) return;
    var f=engine_info.electric_field(wx,wy);
    var em=Math.hypot(f.ex,f.ey);
    ttEl.innerHTML=
      `<span class="tt-row"><span class="tt-label">φ</span><span class="tt-val">${fmtMetric(f.p)} В</span></span>`+
      `<span class="tt-row"><span class="tt-label">|E|</span><span class="tt-val">${fmtMetric(em)} В/м</span></span>`+
      `<span class="tt-row"><span class="tt-label">Eₓ</span><span class="tt-val">${fmtMetric(f.ex)}</span></span>`+
      `<span class="tt-row"><span class="tt-label">Eᵧ</span><span class="tt-val">${fmtMetric(f.ey)}</span></span>`;
  }

  // ── Мышь / тач ───────────────────────────────────────────────────────────
  var isDrag=false, dragStart={x:0,y:0}, clickStart={x:0,y:0,isClick:true};
  var dragSnap=null, lastWheelAt=0, worldCursor={x:0,y:0};
  var elMousePos=document.getElementById('mouse-pos');
  var elWorldPos=document.getElementById('transformed-mouse-pos');

  function onDown(ev){
    isDrag=true;
    clickStart={x:ev.offsetX,y:ev.offsetY,isClick:true};
    dragStart=getTransformed(ev.offsetX,ev.offsetY);
    dragSnap=canvas_events.history.serialize();
  }
  function onMove(ev){
    worldCursor=getTransformed(ev.offsetX,ev.offsetY);
    if(elMousePos) elMousePos.innerText=`X: ${ev.offsetX}  Y: ${ev.offsetY}`;
    if(elWorldPos) elWorldPos.innerText=`Мир: ${worldCursor.x.toFixed(3)}  ${worldCursor.y.toFixed(3)}`;
    updateTooltip(worldCursor.x,worldCursor.y);
    if(isDrag){
      ctx.translate(worldCursor.x-dragStart.x, worldCursor.y-dragStart.y);
      if((ev.offsetX-clickStart.x)**2+(ev.offsetY-clickStart.y)**2>25) clickStart.isClick=false;
      if(!runner.running) engine_info.change();
      canvas_events.need_repaint();
    }
  }
  function onUp(ev){
    if(isDrag&&clickStart.isClick){
      var t=getTransformed(clickStart.x,clickStart.y);
      canvas_events.on_click.forEach(fn=>fn(clickStart.x,clickStart.y,t.x,t.y));
    } else if(isDrag&&dragSnap){
      canvas_events.history.push(dragSnap);
    }
    isDrag=false; dragSnap=null;
    if(!runner.running) engine_info.change();
    canvas_events.need_repaint();
  }
  function onWheel(ev){
    var now=Date.now();
    if(now-lastWheelAt>350){ canvas_events.history.push(); lastWheelAt=now; }
    var z=Math.pow(Math.E,-ev.deltaY*Math.log(1.1)/100);
    ctx.translate(worldCursor.x,worldCursor.y);
    ctx.scale(z,z);
    ctx.translate(-worldCursor.x,-worldCursor.y);
    if(!runner.running) engine_info.change();
    canvas_events.need_repaint();
  }
  function onKey(ev){
    var tgt=ev.target;
    if(tgt&&(tgt.tagName==='INPUT'||tgt.tagName==='TEXTAREA'||tgt.tagName==='SELECT'||tgt.isContentEditable)) return;
    if(!ev.ctrlKey) return;
    var k=ev.key.toLowerCase();
    if(k==='z'&&!ev.shiftKey){ ev.preventDefault(); canvas_events.history.undo(); }
    else if(k==='y'||(k==='z'&&ev.shiftKey)){ ev.preventDefault(); canvas_events.history.redo(); }
  }

  canvas.addEventListener('mousedown', onDown, {passive:true});
  canvas.addEventListener('mousemove', onMove, {passive:true});
  canvas.addEventListener('mouseup',   onUp,   {passive:true});
  canvas.addEventListener('mouseleave',onUp,   {passive:true});
  canvas.addEventListener('wheel',     onWheel,{passive:true});
  window.addEventListener('keydown',   onKey);

  function t2o(e,touch){var r=e.target.getBoundingClientRect();return{offsetX:(touch.clientX-r.x)/r.width*e.target.offsetWidth,offsetY:(touch.clientY-r.y)/r.height*e.target.offsetHeight};}
  canvas.addEventListener('touchstart', e=>{Object.assign(e,t2o(e,e.touches[0]));onDown(e);},{passive:false});
  canvas.addEventListener('touchmove',  e=>{Object.assign(e,t2o(e,e.touches[0]));onMove(e);},{passive:false});
  canvas.addEventListener('touchend',   e=>{Object.assign(e,t2o(e,e.changedTouches[0]));onUp(e);},{passive:false});
  canvas.addEventListener('touchcancel',e=>{Object.assign(e,t2o(e,e.changedTouches[0]));onUp(e);},{passive:false});

  canvas_events.sync_layer_ui();
  canvas_events.history.reset();
  canvas_events.need_repaint();
  ctx.textBaseline='middle'; ctx.textAlign='center';

  setTimeout(()=>{
    canvas_events.set_canvas_state({x:center_menu.clientWidth/2,y:center_menu.clientHeight/2,size:14});
    engine_info.change();
    canvas_events.history.reset();
  },200);
});
