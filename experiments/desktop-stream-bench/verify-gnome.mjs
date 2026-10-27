import {chromium} from 'playwright';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
const exec=promisify(execFile);
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 for(const [engine,port] of [['selkies',8031],['kasm',8032]]) {
  const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
  for(let i=0;i<20;i++) {
   const response=await page.goto(`http://localhost:${port}`);
   if(response.ok())break;
   if(i===19)throw Error(`${engine} server unavailable`);
   await page.waitForTimeout(1000);
  }
  await page.waitForFunction(()=>[...document.querySelectorAll('video,canvas')].some(e=>e.getBoundingClientRect().width===1280&&e.getBoundingClientRect().height===720));
  await page.waitForTimeout(5000);
  const shell=await exec('docker',['exec',`desktop-bench-${engine}`,'pgrep','-a','gnome-shell']);assert(shell.stdout.includes('/usr/bin/gnome-shell'));
  await page.keyboard.press('Escape');await page.waitForTimeout(500);
  await page.mouse.click(120,150);await page.waitForTimeout(300);
  await page.mouse.click(300,440);await page.keyboard.press('Control+a');await page.keyboard.type(`GNOME ${engine}: keyboard works`,{delay:30});await page.waitForTimeout(500);
  await page.screenshot({path:`results/gnome-${engine}-input.png`});
  await page.mouse.click(25,15);await page.waitForTimeout(1000);await page.keyboard.type('Terminal',{delay:90});await page.waitForTimeout(2000);
  await page.screenshot({path:`results/gnome-${engine}-search.png`});
  // shortcut: fixed fresh-session search layout; inspect screenshots if applications reorder.
  await page.mouse.click(730,160);
  await page.waitForTimeout(5000);
  const terminal=await exec('docker',['exec',`desktop-bench-${engine}`,'pgrep','-af','/usr/libexec/gnome-terminal-server']);assert(terminal.stdout.includes('/usr/libexec/gnome-terminal-server'));
  await page.keyboard.type('echo GNOME desktop input works');await page.keyboard.press('Enter');await page.waitForTimeout(500);
  await page.screenshot({path:`results/gnome-${engine}-terminal.png`});
  console.log(engine,'GNOME shell and browser-launched Terminal verified');await page.close();
 }
 const page=await browser.newPage({viewport:{width:1600,height:1100},deviceScaleFactor:1});
 await page.goto('http://localhost:8030');await page.waitForTimeout(6000);await page.screenshot({path:'results/gnome-comparison.png'});
 assert((await page.locator('body').innerText()).includes('GNOME 48'));
} finally {await browser.close();}
