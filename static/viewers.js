// Geometry is a view of prepared scientific grids. No metrics are computed here.
const $ = id => document.getElementById(id);
const palettes = {elevation: ['#253e58', '#789b9d', '#e4b485'], slope: ['#14364a', '#71cfc5', '#ed9e67']};
function rgb(hex) { return hex.slice(1).match(/../g).map(x => parseInt(x, 16)); }
export function color(value, min, max, mode) {
  const t = Math.max(0, Math.min(1, (value-min)/(max-min || 1)));
  const p = palettes[mode].map(rgb), k = t < .5 ? 0 : 1, f = t < .5 ? t*2 : (t-.5)*2;
  return p[k].map((v,i) => (v+(p[k+1][i]-v)*f)/255);
}

export async function createViewers(onFallback) {
  let THREE, OrbitControls;
  let fallback = new URLSearchParams(location.search).get('view') === '2d';
  if (!fallback) {
    try { THREE = await import('three'); ({OrbitControls} = await import('/static/vendor/OrbitControls.js')); }
    catch { fallback = true; }
  }
  const views = {}, settings = {mode:'elevation', min:-100, max:100, exaggeration:10, sync:true};
  let changing = false;
  function fallbackAll(reason) {
    fallback = true;
    Object.values(views).forEach(view => {
      view.controls?.dispose(); view.renderer?.dispose();
      view.disposeScene?.();
      view.renderer = null; view.controls = null;
      const canvas = document.createElement('canvas');
      view.host.replaceChildren(canvas); view.canvas = canvas;
      view.host.classList.remove('three-ready'); view.zoom = 1;
      view.host.addEventListener('wheel', event => {
        if (!fallback) return;
        event.preventDefault(); action(view.id, event.deltaY < 0 ? 'zoom-in' : 'zoom-out');
      }, {passive:false});
      draw2d(view);
    });
    document.querySelectorAll('[data-action^="rotate"]').forEach(button => { button.disabled = true; button.title = 'El giro orbital requiere el visor 3D.'; });
    document.querySelectorAll('.viewer-controls>span').forEach(el => el.textContent = 'Vista 2D · rueda o botones para acercar');
    onFallback(reason);
  }
  function draw2d(view) {
    if (!view.canvas || !view.data) return;
    const canvas = view.canvas, w = view.host.clientWidth, h = view.host.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w*dpr; canvas.height = h*dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr,dpr); ctx.clearRect(0,0,w,h);
    const size = Math.min(w-90,h-50)*view.zoom, x = (w-size)/2, y = (h-size)/2;
    const grid = settings.mode === 'slope' ? view.data.slope_deg : view.data.relative_elevation_m;
    for (let r=0;r<20;r++) for (let c=0;c<20;c++) {
      const v = color(grid[r][c],settings.min,settings.max,settings.mode).map(k=>Math.round(k*255));
      ctx.fillStyle = `rgb(${v.join(',')})`; ctx.fillRect(x+c*size/20,y+r*size/20,size/20+.5,size/20+.5);
    }
    ctx.strokeStyle = '#b7c9d277'; ctx.lineWidth = .5;
    for (let i=0;i<=5;i++) {
      ctx.beginPath();ctx.moveTo(x+i*size/5,y);ctx.lineTo(x+i*size/5,y+size);ctx.stroke();
      ctx.beginPath();ctx.moveTo(x,y+i*size/5);ctx.lineTo(x+size,y+i*size/5);ctx.stroke();
    }
    ctx.fillStyle='#b6c9d7';ctx.font='10px Segoe UI';ctx.fillText('0',x,y+size+15);ctx.fillText('10 km → E',x+size-48,y+size+15);
    ctx.fillText('N ↑',x-30,y+12);
  }
  function label(text, x,y,z, group, tint='#adc0d0') {
    const canvas = document.createElement('canvas'); canvas.width=256;canvas.height=64;
    const ctx = canvas.getContext('2d');ctx.fillStyle=tint;ctx.font='26px Segoe UI';ctx.textAlign='center';ctx.fillText(text,128,42);
    const map = new THREE.CanvasTexture(canvas), material = new THREE.SpriteMaterial({map,transparent:true,depthTest:false});
    const sprite = new THREE.Sprite(material); sprite.position.set(x,y,z);sprite.scale.set(1.6,.4,1);group.add(sprite);
  }
  function dispose(object) {
    object.traverse(item => { item.geometry?.dispose(); const mats = item.material ? (Array.isArray(item.material) ? item.material : [item.material]) : []; mats.forEach(m=> {m.map?.dispose();m.dispose();}); });
  }
  function draw3d(view) {
    if (!view.data || !view.renderer) return;
    if (view.land) {dispose(view.land);view.scene.remove(view.land);}
    const group = new THREE.Group(), positions=[], colors=[], indices=[];
    const z = view.data.relative_elevation_m, slopes=view.data.slope_deg;
    for (let r=0;r<20;r++) for (let c=0;c<20;c++) {
      positions.push((c-9.5)*.5,z[r][c]*settings.exaggeration/1000,(r-9.5)*.5);
      const rgb=color(settings.mode==='slope'?slopes[r][c]:z[r][c],settings.min,settings.max,settings.mode);
      const linear=new THREE.Color(...rgb).convertSRGBToLinear();colors.push(linear.r,linear.g,linear.b);
      if(r<19 && c<19){const a=r*20+c,b=a+20;indices.push(a,b,a+1,a+1,b,b+1);}
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    group.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:1,metalness:0})));
    const floor = Math.min(...Object.values(views).flatMap(v=>v.data?.relative_elevation_m.flat() || [0]))*settings.exaggeration/1000-.25;
    const grid = new THREE.GridHelper(10,5,0x4b6379,0x2d455b);grid.position.y=floor;group.add(grid);
    // Metric axes and scale labels remain in world coordinates, not CSS pixels.
    for(let i=0;i<=5;i++) label(`${i*2}`, -5+i*2,floor,5.5,group);
    label('km · E',6,floor,5.5,group);label('N',-5.5,floor,-5.4,group);
    const low = Math.min(...z.flat()),high=Math.max(...z.flat());
    const points=[new THREE.Vector3(-5.3,low*settings.exaggeration/1000,5),new THREE.Vector3(-5.3,high*settings.exaggeration/1000,5)];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0xd7a57f})));
    label(`${Math.round(low)} m`,-6.2,points[0].y,5,group,'#d7a57f');label(`${Math.round(high)} m`,-6.2,points[1].y+.3,5,group,'#d7a57f');
    view.scene.add(group);view.land=group;render(view);
  }
  function render(view){if(view.renderer){
    view.renderer.render(view.scene,view.camera);
    view.host.dataset.camera=JSON.stringify({position:view.camera.position.toArray(),target:view.controls?.target.toArray()});
  }else draw2d(view);}
  function reset(view) {
    if(fallback){view.zoom=1;draw2d(view);return;}
    const heights=Object.values(views).flatMap(v=>v.data?.relative_elevation_m.flat()||[0]);
    const low=Math.min(...heights)*settings.exaggeration/1000,high=Math.max(...heights)*settings.exaggeration/1000;
    const target=new THREE.Vector3(0,(low+high)/2,0);
    const direction=new THREE.Vector3(1,.92,1.2).normalize();
    const right=new THREE.Vector3(direction.z,0,-direction.x).normalize(),up=new THREE.Vector3().crossVectors(direction,right);
    const aspect=Math.min(...Object.values(views).map(v=>v.host.clientWidth/v.host.clientHeight));
    const tanV=Math.tan(THREE.MathUtils.degToRad(view.camera.fov/2)),tanH=tanV*aspect;
    let distance=3;
    for(const x of [-5.7,5.7])for(const y of [low-.25,high])for(const z of [-5.6,5.6]){
      const point=new THREE.Vector3(x,y,z).sub(target);
      distance=Math.max(distance,Math.max(Math.abs(point.dot(right))/tanH,Math.abs(point.dot(up))/tanV)+point.dot(direction));
    }
    view.camera.position.copy(target).addScaledVector(direction,distance*.90);view.controls.target.copy(target);view.controls.update();render(view);
  }
  function synchronize(source) {
    if(!settings.sync || changing) return;
    changing=true;
    for(const other of Object.values(views))if(other!==source){
      if(fallback){other.zoom=source.zoom;draw2d(other);}else{other.camera.position.copy(source.camera.position);other.camera.quaternion.copy(source.camera.quaternion);other.controls.target.copy(source.controls.target);other.controls.update();render(other);}
    }
    changing=false;
  }
  function action(id, name){
    const view=views[id];if(!view?.data)return;
    if(name==='reset')reset(view);
    else if(fallback){view.zoom=Math.max(.65,Math.min(4,view.zoom*(name==='zoom-in'?1.2:1/1.2)));draw2d(view);}
    else {
      const offset=view.camera.position.clone().sub(view.controls.target);
      if(name.startsWith('rotate'))offset.applyAxisAngle(new THREE.Vector3(0,1,0),name==='rotate-left'?.25:-.25);
      else {const factor=name==='zoom-in'?.82:1.22;offset.multiplyScalar(factor);offset.clampLength(3,150);}
      view.camera.position.copy(view.controls.target).add(offset);view.controls.update();render(view);
    }
    synchronize(view);
  }
  for(const id of ['mars','earth']) {
    const view=views[id]={id,host:$(id+'-view'),zoom:1};
    if(!fallback)try{
      view.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});view.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
      view.host.replaceChildren(view.renderer.domElement);view.host.classList.add('three-ready');
      view.renderer.domElement.addEventListener('webglcontextlost', event=>{event.preventDefault();fallbackAll('Se perdió el contexto WebGL. Mostrando los mismos datos en 2D.');},{once:true});
      view.scene=new THREE.Scene();view.camera=new THREE.PerspectiveCamera(40,1,.1,400);
      view.scene.add(new THREE.HemisphereLight(0xe2efff,0x34485c,1.25));
      const light=new THREE.DirectionalLight(0xffe1c3,1.65);light.position.set(-10,8,-5);view.scene.add(light);
      view.controls=new OrbitControls(view.camera,view.renderer.domElement);view.controls.enablePan=false;view.controls.minDistance=3;view.controls.maxDistance=150;view.controls.maxPolarAngle=Math.PI*.49;
      view.controls.addEventListener('change',()=>{render(view);synchronize(view);});
      view.disposeScene=()=>{if(view.land)dispose(view.land);};
      reset(view);
    }catch{fallback=true;}
    new ResizeObserver(()=>{
      if(view.renderer){const w=view.host.clientWidth,h=view.host.clientHeight;view.renderer.setSize(w,h,false);view.camera.aspect=w/h;view.camera.updateProjectionMatrix();if(view.data){reset(view);synchronize(view);}else render(view);}else draw2d(view);
    }).observe(view.host);
    view.host.addEventListener('keydown',event=>{const key={ArrowLeft:'rotate-left',ArrowRight:'rotate-right','+':'zoom-in','-':'zoom-out',Home:'reset'}[event.key];if(key){event.preventDefault();action(id,key);}});
  }
  if(fallback)fallbackAll('WebGL 2 no está disponible o se solicitó vista 2D. Se muestran los mismos DEM como mapas de color. La exageración vertical solo se aplica al 3D.');
  return {
    setData(id,data){views[id].data=data;},
    update(options={}){Object.assign(settings,options);Object.values(views).forEach(v=>fallback?draw2d(v):draw3d(v));},
    reset(){reset(views.mars);if(settings.sync)synchronize(views.mars);else reset(views.earth);},
    sync(value){settings.sync=value;if(value)synchronize(views.mars);},
    action,
    isFallback:()=>fallback
  };
}
