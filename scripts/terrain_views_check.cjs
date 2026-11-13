const {chromium}=require('../.browser-test/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8000';
  await page.goto(base+'/?lang=es');await page.waitForSelector('.rank-item.selected');
  assert.equal(await page.locator('#terrain-profile circle').count(),40);
  const original=await page.locator('#terrain-profile path').first().getAttribute('d');
  await page.locator('#profile-row').fill('0');
  assert.notEqual(await page.locator('#terrain-profile path').first().getAttribute('d'),original);
  const profile=await page.locator('#terrain-profile').innerHTML();
  for(const preset of ['top','front','east','perspective']){
   await page.locator('#view-preset').selectOption(preset);
   for(const exaggeration of ['1','30']){
    await page.locator('#exaggeration').fill(exaggeration);
    const extent=await page.evaluate(async()=>{
     const THREE=await import('/static/vendor/three.module.js');let maximum=0;
     for(const [name,id] of [['mars','jezero'],['earth',document.querySelector('#candidate').value]]){
      const host=document.querySelector('#'+name+'-view'),state=JSON.parse(host.dataset.camera);
      const camera=new THREE.PerspectiveCamera(40,host.clientWidth/host.clientHeight,.1,400);
      camera.position.fromArray(state.position);camera.lookAt(new THREE.Vector3(...state.target));camera.updateMatrixWorld();
      const data=await(await fetch('/api/terrains/'+id)).json(),factor=Number(document.querySelector('#exaggeration').value);
      for(let r=0;r<20;r++)for(let c=0;c<20;c++){
       const p=new THREE.Vector3((c-9.5)*.5,data.relative_elevation_m[r][c]*factor/1000,(r-9.5)*.5).project(camera);
       maximum=Math.max(maximum,Math.abs(p.x),Math.abs(p.y));
      }
     }return maximum;
    });
    assert(extent<1,`${preset} x${exaggeration} must frame terrain: ${extent}`);
   }
  }
  assert.equal(await page.locator('#terrain-profile').innerHTML(),profile,'Camera and exaggeration must not change scientific profile');
  await page.locator('#show-wireframe').check();await page.locator('#show-grid').uncheck();
  await page.locator('#candidate').selectOption('la-joya-este');
  assert.equal(await page.locator('#terrain-profile circle').count(),40);
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
  fs.mkdirSync('artifacts/browser',{recursive:true});
  await page.locator('.terrain-profile').screenshot({path:'artifacts/browser/terrain-profile-mobile.png'});
  await page.goto(base+'/?lang=en&view=2d');await page.waitForSelector('.rank-item.selected');
  assert(await page.locator('#view-preset').isDisabled());assert(await page.locator('#show-wireframe').isDisabled());
  assert.equal(await page.locator('#terrain-profile circle').count(),40);
  assert.match(await page.locator('#profile-title').textContent(),/Terrain in profile/);
  await page.locator('#show-grid').uncheck();assert.deepEqual(errors,[]);
  console.log('PASS: four oriented views at x1/x30, terrain framing, original row samples, profile invariance, candidate changes, mobile and bilingual 2D fallback.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
