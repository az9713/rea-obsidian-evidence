import { chromium } from 'playwright';
import http from 'node:http';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=path.resolve('docs');
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png'};
const server=http.createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep))throw Error('outside');const data=await readFile(file);res.setHeader('Content-Type',types[path.extname(file)]??'application/octet-stream');res.end(data);}catch{res.statusCode=404;res.end('Not found');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await mkdir('.test-build/browser-profile',{recursive:true});
let context;const passed=[];const errors=[];
try{
  context=await chromium.launchPersistentContext(path.resolve('.test-build/browser-profile'),{headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,viewport:{width:1440,height:1050},reducedMotion:'reduce',args:['--no-first-run','--disable-background-networking',`--disk-cache-dir=${path.resolve('.test-build/browser-cache')}`]});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  async function status(value){await page.waitForFunction(v=>document.querySelector('#status')?.textContent===v,value);}
  await status('verified');passed.push('Browser core demo initializes with verified exact evidence');
  const id=await page.locator('#anchor-id').textContent();await page.locator('#rename').click();await status('verified');assert.equal(await page.locator('#anchor-id').textContent(),id);passed.push('Tracked rename preserves identity and verification');
  await page.locator('#append').click();await status('stale');assert.equal(await page.locator('#revalidate').isEnabled(),true);await page.screenshot({path:'docs/demo-desktop.png',fullPage:true});
  await page.locator('#revalidate').click();await status('verified');passed.push('Source drift requires explicit revalidation');
  await page.locator('#reset').click();await status('verified');await page.locator('#edit').click();await status('stale');assert.equal(await page.locator('#revalidate').isEnabled(),false);passed.push('Changed quote cannot be silently revalidated');
  await page.locator('#reset').click();await status('verified');await page.locator('#duplicates').click();await status('ambiguous');assert.equal(await page.locator('#revalidate').isEnabled(),false);passed.push('Duplicate missing-path source candidates are ambiguous');
  await page.locator('#remove').click();await status('missing');passed.push('No sources produces missing state');
  await page.setViewportSize({width:390,height:844});await page.locator('#reset').click();await status('verified');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'docs/demo-mobile.png',fullPage:true});passed.push('390px mobile layout has no horizontal page overflow');
  assert.deepEqual(errors,[]);passed.push('No browser JavaScript errors');
  await writeFile('docs/browser-verification.json',JSON.stringify({generatedAt:new Date().toISOString(),authority:'Real Chromium browser demo; not Obsidian host',browser:context.browser()?.version()??'persistent Chromium',passed,errors,desktopScreenshot:'demo-desktop.png',mobileScreenshot:'demo-mobile.png'},null,2));
  console.log(JSON.stringify({passed:passed.length,errors},null,2));
}finally{await context?.close();await new Promise(resolve=>server.close(resolve));}
