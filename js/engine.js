/* ============================================================
   engine.js  —  физический движок электростатики
   ============================================================ */

var engine_info = (()=>{

  var constants = {
    e:   1e-9,
    eps: 8.9875517873681764e9,
    t:   1,
    m:   1e-3,
    scale: 1,
  };

  var in_shape = {
    rectangle: ([x1,y1,w,h], x, y) => x>=x1 && x<=x1+w && y>=y1 && y<=y1+h,
    circle:    ([cx,cy,r],   x, y) => (x-cx)**2+(y-cy)**2 <= r*r,
    ring:      ([cx,cy,r1,r2],x,y) => { var d2=(x-cx)**2+(y-cy)**2; return d2<=r2*r2&&d2>=r1*r1; }
  };

  // ── BEM: граничные точки ─────────────────────────────────────────────────
  function conductor_boundary_points(entity, N) {
    var pts=[], d=entity.data, sh=entity.shape;
    if (sh==='circle') {
      var [cx,cy,r]=d;
      for (var i=0;i<N;i++){
        var phi=(2*Math.PI*i)/N;
        pts.push({x:cx+r*Math.cos(phi),y:cy+r*Math.sin(phi),nx:Math.cos(phi),ny:Math.sin(phi),ds:2*Math.PI*r/N});
      }
    } else if (sh==='ring') {
      var [cx,cy,r1,r2]=d;
      var No=Math.round(N*r2/(r1+r2)), Ni=N-No;
      for (var i=0;i<No;i++){var phi=(2*Math.PI*i)/No; pts.push({x:cx+r2*Math.cos(phi),y:cy+r2*Math.sin(phi),nx:Math.cos(phi),ny:Math.sin(phi),ds:2*Math.PI*r2/No});}
      for (var i=0;i<Ni;i++){var phi=(2*Math.PI*i)/Ni; pts.push({x:cx+r1*Math.cos(phi),y:cy+r1*Math.sin(phi),nx:-Math.cos(phi),ny:-Math.sin(phi),ds:2*Math.PI*r1/Ni});}
    } else if (sh==='rectangle') {
      var [x0,y0,w,h]=d, perim=2*(w+h), ds=perim/N;
      var sides=[
        {dx:1,dy:0,len:w,ox:x0,  oy:y0,  nx:0, ny:-1},
        {dx:0,dy:1,len:h,ox:x0+w,oy:y0,  nx:1, ny:0},
        {dx:-1,dy:0,len:w,ox:x0+w,oy:y0+h,nx:0,ny:1},
        {dx:0,dy:-1,len:h,ox:x0, oy:y0+h,nx:-1,ny:0},
      ];
      var si=0,spos=0;
      for (var i=0;i<N;i++){
        var t=i*perim/N;
        while(si<4&&t>=spos+sides[si].len){spos+=sides[si].len;si++;}
        if(si>=4)si=3;
        var s=sides[si],frac=(t-spos)/s.len;
        pts.push({x:s.ox+s.dx*s.len*frac,y:s.oy+s.dy*s.len*frac,nx:s.nx,ny:s.ny,ds:ds});
      }
    }
    return pts;
  }

  // ── BEM: решение (Гаусс-Зейдель) ────────────────────────────────────────
  function solve_bem(conductor_entity, ext_charges, N_pts) {
    var pts=conductor_boundary_points(conductor_entity, N_pts);
    var n=pts.length;
    if(!n) return [];

    var phi_ext=new Float64Array(n);
    for(var i=0;i<n;i++){
      var px=pts[i].x,py=pts[i].y;
      for(var c of ext_charges){
        var dx=(c.x-px)*constants.scale, dy=(c.y-py)*constants.scale;
        var d2=dx*dx+dy*dy;
        if(d2<1e-6) continue;
        phi_ext[i]+=constants.eps*c.q*constants.e/Math.sqrt(d2);
      }
    }

    var A=[];
    for(var i=0;i<n;i++){
      A.push(new Float64Array(n));
      for(var j=0;j<n;j++){
        if(i===j){
          var sr=Math.max(pts[j].ds*constants.scale*0.25,1e-9);
          A[i][j]=constants.eps*constants.e/sr;
        } else {
          var dx=(pts[i].x-pts[j].x)*constants.scale, dy=(pts[i].y-pts[j].y)*constants.scale;
          var d=Math.sqrt(dx*dx+dy*dy);
          A[i][j]=d>1e-10?constants.eps*constants.e/d:0;
        }
      }
    }

    function gs(b){
      var q=new Float64Array(n);
      for(var iter=0;iter<40;iter++)
        for(var i=0;i<n;i++){
          var s=b[i];
          for(var j=0;j<n;j++) if(j!==i) s-=A[i][j]*q[j];
          q[i]=s/A[i][i];
        }
      return q;
    }

    var b0=new Float64Array(n), b1=new Float64Array(n);
    for(var i=0;i<n;i++){b0[i]=-phi_ext[i]; b1[i]=1;}
    var q0=gs(b0), q1=gs(b1);
    var Qt=Number.isFinite(conductor_entity.Q_total)?conductor_entity.Q_total:0;
    var s0=0,s1=0;
    for(var i=0;i<n;i++){s0+=q0[i];s1+=q1[i];}
    var Vt=Number.isFinite(conductor_entity.V_conductor)
      ?conductor_entity.V_conductor
      :(Math.abs(s1)>1e-18?(Qt-s0)/s1:0);
    var q=new Float64Array(n);
    for(var i=0;i<n;i++) q[i]=q0[i]+Vt*q1[i];
    if(Number.isFinite(conductor_entity.V_conductor)){
      var qs=0; for(var i=0;i<n;i++) qs+=q[i];
      var corr=(qs-Qt)/n; for(var i=0;i<n;i++) q[i]-=corr;
    }
    var result=[];
    for(var i=0;i<n;i++) result.push({x:pts[i].x,y:pts[i].y,nx:pts[i].nx,ny:pts[i].ny,ds:pts[i].ds,q:q[i],sigma:q[i]/pts[i].ds});
    return result;
  }

  // ── Начальные сущности ───────────────────────────────────────────────────
  var entities=[
    {type:'q',is_const:false,q:1000, x:0.01,y:1, vx:0,vy:0,m:10,in_conductor:false},
    {type:'q',is_const:false,q:-1000,x:-0.01,y:-1,vx:0,vy:0,m:10,in_conductor:false},
  ];
  var bem_charges={};
  var BEM_N=64, BEM_PASSES=3;

  function update_bem(){
    var pq=entities.filter(e=>e.type==='q');
    var conds=entities.map((e,i)=>({entity:e,index:i})).filter(d=>d.entity.type==='p');
    var nbem={};
    for(var pass=0;pass<BEM_PASSES;pass++){
      var prev=nbem; nbem={};
      conds.forEach(item=>{
        var ext=pq.slice();
        Object.keys(prev).forEach(k=>{ if(+k!==item.index) ext=ext.concat(prev[k]); });
        nbem[item.index]=solve_bem(item.entity,ext,BEM_N);
      });
    }
    bem_charges=nbem;
  }

  function add_field(acc, src, x, y, min_d2){
    var dx=(x-src.x)*constants.scale, dy=(y-src.y)*constants.scale;
    var d2=dx*dx+dy*dy;
    if(d2<min_d2) return;
    var d=Math.sqrt(d2), em=constants.eps*src.q*constants.e/d2;
    acc.ex+=em*dx/d; acc.ey+=em*dy/d; acc.p+=constants.eps*src.q*constants.e/d;
  }

  function get_electric_field(x, y){
    var acc={ex:0,ey:0,p:0};
    entities.forEach(e=>{ if(e.type==='q') add_field(acc,e,x,y,0.001); });
    Object.values(bem_charges).forEach(segs=>segs.forEach(s=>add_field(acc,s,x,y,1e-6)));
    return acc;
  }

  var feelds_in_line=10, canvas_electric_field=[];
  var bem_dirty = true;   // флаг: нужно пересчитать BEM
  var bem_skip  = 0;      // счётчик пропусков

  function change(){
    var [canvas,ctx]=canvas_events.get_canvas();
    var state=canvas_events.get_canvas_state();
    if(!canvas||!ctx||!state) return;
    update_bem();
    bem_dirty = false;

    var xx=1000;
    if(entities.length>50)   xx=500;
    if(entities.length>500)  xx=300;
    if(entities.length>1000) xx=200;
    feelds_in_line=Math.max(Math.floor(Math.sqrt(xx)),4);

    var sx=canvas.width/feelds_in_line/state.size;
    var sy=canvas.height/feelds_in_line/state.size;
    var ox=-state.x/state.size, oy=-state.y/state.size;
    canvas_electric_field=[];
    for(var yi=0;yi<=feelds_in_line;yi++)
      for(var xi=0;xi<=feelds_in_line;xi++){
        var wx=ox+xi*sx, wy=oy+yi*sy;
        canvas_electric_field.push({
          x:canvas.width/feelds_in_line*xi,
          y:canvas.height/feelds_in_line*yi,
          feeld:get_electric_field(wx,wy)
        });
      }
    var pv=canvas_electric_field.map(e=>Math.abs(e.feeld.p));
    canvas_electric_field._p_max=Math.max(...pv)||1;
    if(runner.running) right_menu_h.change_info(true);
  }

  // ── Симулятор (симплектический Эйлер) ───────────────────────────────────
  function engine_iteration(dt_real){
    var dt=dt_real*constants.t;
    var conds=entities.filter(e=>e.type==='p');

    // BEM пересчитываем не каждый кадр — дорогая операция O(N²)
    // При наличии проводников: каждые 4 шага (незаметно при 60fps)
    bem_skip++;
    if(bem_dirty || bem_skip >= 4){
      update_bem();
      bem_dirty = false;
      bem_skip  = 0;
    }

    entities.forEach((e,i)=>{
      if(e.type!=='q'||e.is_const) return;
      var fx=0,fy=0;
      entities.forEach((e2,j)=>{
        if(j===i||e2.type!=='q') return;
        var dx=(e2.x-e.x)*constants.scale, dy=(e2.y-e.y)*constants.scale;
        var d2=dx*dx+dy*dy; if(d2<0.01) return;
        var d=Math.sqrt(d2), f=constants.eps*e.q*e2.q*constants.e**2/d2;
        fx-=f*dx/d; fy-=f*dy/d;
      });
      Object.values(bem_charges).forEach(segs=>segs.forEach(s=>{
        var dx=(s.x-e.x)*constants.scale, dy=(s.y-e.y)*constants.scale;
        var d2=dx*dx+dy*dy; if(d2<0.001) return;
        var d=Math.sqrt(d2), f=constants.eps*e.q*s.q*constants.e**2/d2;
        fx-=f*dx/d; fy-=f*dy/d;
      }));
      var mass=e.m*constants.m;
      e._ax=fx/mass; e._ay=fy/mass;
    });

    entities.forEach(e=>{
      if(e.type!=='q'||e.is_const) return;

      var nvx=e.vx+(e._ax||0)*dt, nvy=e.vy+(e._ay||0)*dt;
      var v2=nvx*nvx+nvy*nvy;
      if(v2>1e12){var k=1e6/Math.sqrt(v2);
        nvx*=k;nvy*=k;}



      var nx=e.x+nvx*dt/constants.scale, ny=e.y+nvy*dt/constants.scale;
      var was_inside=conds.some(c=>in_shape[c.shape](c.data,e.x,e.y));
      if(was_inside){
        var lo=0,hi=1;
        for(var k=0;k<8;k++){
          var mid=(lo+hi)/2;
          var mx=e.x+nvx*dt*mid/constants.scale, my=e.y+nvy*dt*mid/constants.scale;
          if(conds.some(c=>in_shape[c.shape](c.data,mx,my))) hi=mid; else lo=mid;
        }
        nx=e.x+nvx*dt*lo/constants.scale; ny=e.y+nvy*dt*lo/constants.scale;
        nvx*=0.05; nvy*=0.05;
      }
      e.x=nx; e.y=ny; e.vx=nvx; e.vy=nvy;
    });

    change();
    canvas_events.need_repaint();
  }

  return {
    constants,
    run:                engine_iteration,
    get_entities:       ()=>entities,
    set_entities:       e=>{entities=e;bem_charges={};bem_dirty=true;bem_skip=0;},
    electric_field:     get_electric_field,
    change,
    mark_bem_dirty:     ()=>{bem_dirty=true;bem_skip=0;},
    get_electric_field: ()=>canvas_electric_field,
    get_feelds_in_line: ()=>feelds_in_line,
    get_bem_charges:    ()=>bem_charges,
    in_shape,
  };
})();
