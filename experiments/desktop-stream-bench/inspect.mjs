import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
await mkdir('results', {recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  for(const [name,port] of [['selkies',8031],['kasm',8032],['comparison',8030]]) {
    const page=await browser.newPage({viewport:{width:name==='comparison'?1600:1280,height:name==='comparison'?1000:720},deviceScaleFactor:1});
    page.on('pageerror',e=>console.log(name,'PAGE ERROR',e.message));
    page.on('console',m=>{if(m.type()==='error')console.log(name,'CONSOLE ERROR',m.text().slice(0,300));});
    for(let attempt=0;attempt<15;attempt++) {
      const response=await page.goto(`http://localhost:${port}`,{waitUntil:'domcontentloaded'});
      if(response.ok())break;
      if(attempt===14)throw Error(`${name} never became ready`);
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(8000);
    console.log(name,await page.locator('body').innerText());
    console.log(name,await page.locator('canvas,video').evaluateAll(es=>es.map(e=>({tag:e.tagName,id:e.id,w:e.width,h:e.height,rect:e.getBoundingClientRect().toJSON()}))));
    await page.screenshot({path:`results/${name}-initial.png`});
    await page.close();
  }
} finally { await browser.close(); }
