const {chromium}=require('../.browser-test/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
 const page=await browser.newPage();let mode='normal';
 const a={id:1,station_id:'station-a',received_at:'2026-10-23T11:59:01Z',temperature_c:24,humidity_pct:45};
 const b={id:2,station_id:'station-b',received_at:'2026-10-23T11:58:00Z',temperature_c:22,humidity_pct:40};
 await page.route('**/api/telemetry?*',route=>route.fulfill({status:mode==='failed'?502:200,contentType:'application/json',body:JSON.stringify(mode==='failed'?{detail:'Supabase no disponible (prueba).'}:{storage:'supabase',server_time:'2026-10-23T12:00:00Z',readings:mode==='empty'?[]:mode==='resumed'?[a,b,{...a,id:3,received_at:'2026-10-23T12:00:00Z'},{...a,id:3,received_at:'2026-10-23T12:00:00Z'}]:[a,b],stations:mode==='empty'?[]:[{station_id:'station-a',last_received_at:mode==='resumed'?'2026-10-23T12:00:00Z':a.received_at,elapsed_seconds:mode==='resumed'?0:59},{station_id:'station-b',last_received_at:b.received_at,elapsed_seconds:120}]})}));
 for(let attempt=0;attempt<40;attempt++){try{if((await page.request.get('http://127.0.0.1:8000/api/health')).ok())break;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
 await page.clock.install();await page.goto('http://127.0.0.1:8000');await page.waitForSelector('.reception-card');
 await page.locator('#auto-refresh').uncheck();
 // Re-query after installing the clock so the monotonic baseline is consistent.
 await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
 assert.match(await page.locator('[data-station="station-a"]').textContent(),/Recibiendo datos/);
 assert.match(await page.locator('[data-station="station-b"]').textContent(),/Sin datos recientes/);
 await page.clock.runFor(2100);
 assert.match(await page.locator('[data-station="station-a"]').textContent(),/Sin datos recientes/);
 const before=await page.locator('#telemetry').textContent();mode='failed';await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#storage').dataset.state==='failed');
 assert.equal(await page.locator('#telemetry').textContent(),before);assert.match(await page.locator('#station-receptions').textContent(),/Último estado conocido/);
 mode='resumed';await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#storage').dataset.state==='connected-with-readings');
 assert.equal(await page.locator('#telemetry tr').count(),3);assert.match(await page.locator('[data-station="station-a"]').textContent(),/Recibiendo datos/);
 await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);assert.equal(await page.locator('#telemetry tr').count(),3);
 mode='empty';await page.locator('#candidate').selectOption('la-joya-este');await page.waitForFunction(()=>document.querySelector('#station-receptions').textContent==='Sin mediciones recibidas');
 assert.match(await page.locator('#earth-name').textContent(),/La Joya/);
 console.log('PASS: independent UTC reception ages, automatic stale transition, retained history on query failure, resumption without duplicate rows, empty station state, independent terrain selection.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
