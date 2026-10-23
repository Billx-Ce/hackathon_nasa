// Local browser verification. Install tooling with:
// npm.cmd install --prefix .browser-test playwright@1.58.2
const {chromium}=require('../.browser-test/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const out=path.resolve('artifacts/browser');fs.mkdirSync(out,{recursive:true});
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8000';
async function scientificMeshExtent(){
  const THREE=await import('/static/vendor/three.module.js');let maximum=0;
  for(const [name,id] of [['mars','jezero'],['earth',document.querySelector('#candidate').value]]){
    const host=document.querySelector('#'+name+'-view'),state=JSON.parse(host.dataset.camera);
    const camera=new THREE.PerspectiveCamera(40,host.clientWidth/host.clientHeight,.1,400);camera.position.fromArray(state.position);camera.lookAt(new THREE.Vector3(...state.target));camera.updateMatrixWorld();
    const data=await (await fetch('/api/terrains/'+id)).json(),factor=Number(document.querySelector('#exaggeration').value);
    for(let r=0;r<20;r++)for(let c=0;c<20;c++){const p=new THREE.Vector3((c-9.5)*.5,data.relative_elevation_m[r][c]*factor/1000,(r-9.5)*.5).project(camera);maximum=Math.max(maximum,Math.abs(p.x),Math.abs(p.y));}
  }
  return maximum;
}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const failed=[];page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('favicon.ico'))failed.push(`${r.status()} ${r.url()}`);});
  try{
    for(let attempt=0;attempt<40;attempt++){
      try{if((await page.request.get(base+'/api/health',{timeout:1000})).ok())break;}catch{}
      if(attempt===39)throw Error('Local server did not become ready for browser verification.');
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    await page.goto(base);await page.waitForSelector('.rank-item.selected');await page.waitForSelector('.leaflet-interactive');
    assert.equal(await page.locator('.three-ready').count(),2,'Both terrains must actually use WebGL');
    assert.equal(await page.locator('#candidate option').count(),3);
    // Check actual scientific mesh vertices remain in the camera frustum,
    // including the steepest candidate at maximum visual exaggeration.
    for(const candidate of ['atacama-central','atacama-noreste','la-joya-este'])for(const exaggeration of [1,10,30]){
      await page.locator('#candidate').selectOption(candidate);
      await page.locator('#exaggeration').evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},exaggeration);
      const extent=await page.evaluate(scientificMeshExtent);
      assert(extent<1,`Scientific mesh must remain visible: ${candidate}, x${exaggeration}, extent ${extent}`);
    }
    await page.locator('#candidate').selectOption('atacama-central');await page.locator('#exaggeration').evaluate(el=>{el.value='10';el.dispatchEvent(new Event('input',{bubbles:true}));});
    const snap=id=>page.locator('#'+id+'-view').screenshot();
    const initialMars=await snap('mars'),initialEarth=await snap('earth');
    await page.getByRole('button',{name:'Girar Marte a la izquierda',exact:true}).click();
    assert(!(await snap('mars')).equals(initialMars),'Rotate must change Mars pixels');
    assert(!(await snap('earth')).equals(initialEarth),'Synchronized Earth camera must follow');
    await page.getByRole('button',{name:'Restablecer Marte',exact:true}).click();
    await page.locator('#sync').uncheck();const independentEarth=await page.locator('#earth-view').getAttribute('data-camera');
    await page.getByRole('button',{name:'Girar Marte a la derecha',exact:true}).click();
    assert.equal(await page.locator('#earth-view').getAttribute('data-camera'),independentEarth,'Unsynchronized Earth camera must stay still');
    await page.locator('#sync').check();await page.getByRole('button',{name:'Restablecer Marte',exact:true}).click();
    await page.locator('#height-reset').click();
    assert.equal(await page.locator('#exaggeration').inputValue(),'1');
    assert.equal(await page.locator('#exaggeration-value').textContent(),'×1');
    const beforeZoom=await snap('mars');await page.getByRole('button',{name:'Acercar Marte',exact:true}).click();
    assert(!(await snap('mars')).equals(beforeZoom),'Zoom must change the view');
    const metric=await page.locator('#distance-value').textContent();
    await page.locator('#exaggeration').evaluate(el=>{el.value='20';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('#exaggeration-value').textContent(),'×20');
    assert.equal(await page.locator('#distance-value').textContent(),metric,'Visual exaggeration must not alter scientific metrics');
    await page.locator('#color-mode').selectOption('slope');assert.match(await page.locator('#legend-title').textContent(),/Pendiente/);
    await page.locator('#candidate').selectOption('la-joya-este');
    assert.match(await page.locator('#earth-name').textContent(),/La Joya/);assert.notEqual(await page.locator('#distance-value').textContent(),metric);
    await page.locator('.rank-item[data-id="atacama-central"]').click();
    await page.locator('#map-fit').click();
    await page.getByRole('button',{name:'Ver terreno La Joya · sector este',exact:true}).click();
    assert.equal(await page.locator('#candidate').inputValue(),'la-joya-este','Map marker must select its actual terrain');
    await page.locator('.rank-item[data-id="atacama-central"]').click();
    await page.locator('#exaggeration').evaluate(el=>{el.value='10';el.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.locator('#color-mode').selectOption('elevation');
    assert.match(await page.locator('#best-match').textContent(),/Atacama.*central.*tres|Atacama.*central.*mayor parecido/);
    assert.match(await page.locator('#selected-explanation').textContent(),/76[.,]5/);
    // Invalid dates must never trigger the upstream request, and must stay unmodified.
    let climateRequests=0;
    const fixture={site:{name:'Atacama · sector central',latitude:-24.1451,longitude:-69.7524},source:'NASA POWER',source_url:'https://power.larc.nasa.gov/api/temporal/daily/point',retrieved_at:'2026-10-23T00:00:00Z',notice:'Fixture exclusiva de pruebas: promedios terrestres, no clima de Marte.',readings:[{date:'2024-01-01',temperature_c:10,humidity_pct:40},{date:'2024-01-02',temperature_c:null,humidity_pct:50},{date:'2024-01-03',temperature_c:20,humidity_pct:null}]};
    await page.route('**/api/climate/**',route=>{climateRequests++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)});});
    await page.locator('#start').fill('0025-01-01');await page.locator('#load').click();
    assert.equal(await page.locator('#start').inputValue(),'0025-01-01');assert.equal(climateRequests,0);assert(await page.locator('#date-error').isVisible());
    await page.locator('#start').fill('2024-01-04');await page.locator('#end').fill('2024-01-03');await page.locator('#load').click();assert.equal(climateRequests,0);
    await page.locator('#start').fill('2024-01-01');await page.locator('#end').fill('2025-01-01');await page.locator('#load').click();assert.equal(climateRequests,0);
    await page.locator('#end').fill('2024-01-03');await page.locator('#load').click();
    await page.waitForSelector('#climate-charts svg');assert.equal(await page.locator('#climate-charts svg').count(),2);
    assert.match(await page.locator('#climate-summary').textContent(),/15[.,]0/);assert.match(await page.locator('#climate-summary').textContent(),/45[.,]0/);assert.match(await page.locator('#climate-summary').textContent(),/2\/3/);
    const temperaturePath=await page.locator('#climate-charts figure').first().locator('path').getAttribute('d');assert.equal((temperaturePath.match(/M/g)||[]).length,2,'Missing day must break the line');
    assert.equal(await page.locator('#date-error').isHidden(),true);
    await page.unroute('**/api/climate/**');
    // Four storage states are UI-only fixtures; no database writes are performed.
    for(const state of ['unconfigured','connected-empty','connected-with-readings','failed']){
      await page.route('**/api/telemetry?*',route=>route.fulfill({status:state==='failed'?502:200,contentType:'application/json',body:JSON.stringify(state==='failed'?{detail:'No se pudo consultar Supabase (prueba).'}:{storage:state==='unconfigured'?'temporary-memory':'supabase',connection_state:state,readings:state==='connected-with-readings'?[{station_id:'ui-fixture-only',received_at:'2026-10-23T00:00:00Z',temperature_c:24,humidity_pct:45}]:[]})}));
      await page.locator('#refresh').click();await page.waitForFunction(expected=>document.querySelector('#storage').dataset.state===expected,state);
      await page.unroute('**/api/telemetry?*');
    }
    await page.locator('#refresh').click();
    await page.locator('#refresh').waitFor({state:'visible'});
    // Screenshot uses the actual NASA response if available; fixtures are never presented as real data.
    await page.locator('#end').fill('2024-01-07');await page.locator('#load').click();
    await page.waitForFunction(()=>!document.querySelector('#load').disabled,{},{timeout:65000});
    await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:path.join(out,'desktop-top.png')});
    await page.setViewportSize({width:390,height:844});
    await page.locator('#mars-view').screenshot();
    assert(await page.evaluate(scientificMeshExtent)<1,'Mobile camera must keep the scientific terrain visible after resize');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'Mobile charts must not cause overflow');
    await page.screenshot({path:path.join(out,'mobile-charts.png'),fullPage:true});
    await page.locator('.climate-panel').screenshot({path:path.join(out,'mobile-environment.png')});
    await page.locator('.viewer-grid').screenshot({path:path.join(out,'mobile-viewers.png')});
    await page.setViewportSize({width:1440,height:1100});
    // Test error and absent data paths without sending synthetic readings to production.
    await page.route('**/api/climate/**',route=>route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({detail:'NASA POWER no disponible (prueba de error).'})}));
    await page.locator('#load').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('prueba de error'));
    await page.unroute('**/api/climate/**');
    assert(await page.locator('#storage').textContent());
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>document.querySelector('#earth-view').getBoundingClientRect().top>document.querySelector('#mars-view').getBoundingClientRect().bottom);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'Mobile must not overflow horizontally');
    await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
    // Simulate an unavailable WebGL implementation, rather than only a forced UI flag.
    const fallback=await browser.newPage({viewport:{width:1100,height:950}});
    await fallback.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:original.call(this,type,...args);};});
    await fallback.goto(base);await fallback.waitForSelector('.rank-item.selected');
    assert(await fallback.locator('#webgl-notice').isVisible());assert.equal(await fallback.locator('.three-ready').count(),0);
    assert(await fallback.locator('#exaggeration').isDisabled());
    const fallbackBefore=await fallback.locator('#mars-view').screenshot();await fallback.getByRole('button',{name:'Acercar Marte',exact:true}).click();
    assert(!(await fallback.locator('#mars-view').screenshot()).equals(fallbackBefore),'2D zoom must work');
    await fallback.waitForSelector('[aria-label="Ver terreno La Joya · sector este"]');
    await fallback.waitForFunction(()=>!document.querySelector('#refresh').disabled);
    await fallback.screenshot({path:path.join(out,'fallback-2d.png'),fullPage:true});await fallback.close();
    const readable=await browser.newPage();await readable.goto(base+'/catalogue');await readable.waitForSelector('.catalogue-card');assert.equal(await readable.locator('.catalogue-card').count(),3);assert.match(await readable.locator('#catalogue-best').textContent(),/Atacama/);await readable.getByText('Evaluación interna y límites del método',{exact:true}).click();await readable.screenshot({path:path.join(out,'catalogue.png'),fullPage:true});await readable.close();
    // Missing dataset must show error, retry and no invented metrics.
    const missing=await browser.newPage();await missing.route('**/api/terrains',route=>route.fulfill({status:503,contentType:'application/json',body:'{"detail":"Datos no disponibles"}'}));
    await missing.goto(base);await missing.getByRole('button',{name:'Reintentar',exact:true}).waitFor();assert.equal(await missing.locator('#distance-value').textContent(),'—');await missing.close();
    assert.deepEqual(errors,[],'No uncaught browser errors');
    assert.deepEqual(failed.filter(x=>!x.includes('/api/climate/')&&!x.includes('/api/telemetry?')),[],'No unexpected failed asset/API requests');
    console.log('PASS: WebGL pair, 3 candidates, cameras, zoom, reset, scale x1, color, metrics invariance, map selection, date 0025 rejected unchanged, reversed/oversized periods, charts with missing values and calculated means, four storage states, readable catalogue, mobile, no-WebGL alternative and API errors. No uncaught page errors.');
  }catch(error){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});console.error({errors,failed,status:await page.locator('#app-status').count()?await page.locator('#app-status').textContent():'Page unavailable'});throw error;}
  finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
