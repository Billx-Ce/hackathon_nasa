const {chromium}=require('../.browser-test/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8000';
  await page.goto(base+'/?lang=es');await page.waitForSelector('.rank-item.selected');
  await page.locator('#candidate').selectOption('la-joya-este');
  await page.locator('#language').selectOption('en');await page.waitForSelector('.rank-item.selected');
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  assert.match(await page.locator('h1').textContent(),/Two worlds/);
  assert.equal(await page.locator('#candidate').inputValue(),'la-joya-este');
  assert.match(await page.locator('#best-match').textContent(),/Among the/);
  await page.goto(base+'/');await page.waitForSelector('.rank-item.selected');
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  await page.goto(base+'/catalogue?lang=en');await page.waitForSelector('.catalogue-card');
  assert.match(await page.locator('h1').textContent(),/Three candidates/);
  await page.locator('#language').selectOption('es');await page.waitForSelector('.catalogue-card');
  assert.equal(await page.locator('html').getAttribute('lang'),'es');
  assert.deepEqual(errors,[]);console.log('PASS: language switch, persisted preference, candidate preservation and bilingual catalogue.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
