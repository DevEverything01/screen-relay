import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
const docker = (...args) => exec('docker', args, {maxBuffer: 20*1024*1024});
const pause = ms => new Promise(r=>setTimeout(r,ms));
const sampler = `import json,time,pathlib
p=pathlib.Path('/sys/fs/cgroup')
def pairs(name): return {a:int(b) for a,b in (s.split() for s in (p/name).read_text().splitlines())}
for i in range(13):
 c=pairs('cpu.stat'); m=pairs('memory.stat'); n=pathlib.Path('/proc/net/dev').read_text().split('eth0:')[1].split()
 print(json.dumps(dict(t=time.monotonic(),cpu=c['usage_usec'],throttle=c.get('throttled_usec',0),memory=int((p/'memory.current').read_text())-m.get('inactive_file',0),tx=int(n[8]))),flush=True)
 if i<12: time.sleep(1)
`;
function quality(source, decoded) {
 assert.equal(source.width,1280); assert.equal(decoded.width,1280);
 let n=0,squared=0,absolute=0,inkN=0,inkAbsolute=0;
 // Same screen coordinates in the source and decoded frame; excludes window chrome.
 for(let y=175;y<400;y++)for(let x=95;x<1160;x++) {
  const at=(y*1280+x)*4;
  const ink=Math.min(...source.data.subarray(at,at+3))<180;
  for(let c=0;c<3;c++){const d=Math.abs(source.data[at+c]-decoded.data[at+c]);n++;absolute+=d;squared+=d*d;if(ink){inkN++;inkAbsolute+=d;}}
 }
 assert(inkN>1000,'Text ROI must contain actual ink');
 return {psnrDb:squared?10*Math.log10(255**2/(squared/n)):null,meanAbsoluteError:absolute/n,textInkMeanAbsoluteError:inkAbsolute/inkN,roi:[95,175,1065,225]};
}
await mkdir('results',{recursive:true});
const output={state:'Controlled local measurements complete',date:new Date().toISOString(),runs:[],engines:{}};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 for(const [engine,other,port] of [['selkies','kasm',8031],['kasm','selkies',8032]]) {
  const name=`desktop-bench-${engine}`;
  await docker('stop','-t','2',`desktop-bench-${other}`); await docker('start',name); await pause(4000);
  const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
  await page.goto(`http://localhost:${port}`,{waitUntil:'domcontentloaded'});await pause(6000);
  await page.evaluate(()=>{
   window.benchSurface=[...document.querySelectorAll('video,canvas')].find(e=>e.getBoundingClientRect().width===1280&&e.getBoundingClientRect().height===720);
   if(!window.benchSurface)throw Error('No full-size stream');
   const probe=document.createElement('canvas');probe.width=1280;probe.height=720;
   window.benchContext=probe.getContext('2d',{willReadFrequently:true});
   window.benchPixel=()=>{benchContext.drawImage(benchSurface,0,0,1280,720);return Array.from(benchContext.getImageData(1120,640,1,1).data);};
   window.benchLatencies=[];
   window.addEventListener('mousedown',()=>{
    const before=benchPixel(),start=performance.now();
    function check(){const after=benchPixel();if((before[0]>before[1])!==(after[0]>after[1]))benchLatencies.push(performance.now()-start);else if(performance.now()-start<3000)requestAnimationFrame(check);else benchLatencies.push(null);}
    requestAnimationFrame(check);
   },true);
  });
  const pixel=await page.evaluate(()=>benchPixel());assert(Math.abs(pixel[0]-pixel[1])>100,`Flash probe invalid: ${pixel}`);
  for(let i=0;i<30;i++) {await page.mouse.click(1120,640);await page.waitForFunction(n=>benchLatencies.length>n,i,{timeout:4000});await pause(170);}
  const latency=await page.evaluate(()=>benchLatencies);assert(latency.every(v=>v!==null&&v>0),'Every input must change received pixels');
  const fixture=JSON.parse((await docker('exec',name,'cat','/tmp/bench-status.json')).stdout);assert.equal(fixture.flash,false,'30 clicks must return native fixture to red');
  await page.mouse.click(300,430);await page.keyboard.type(`${engine}: keyboard input verified`);await page.mouse.move(20,700);await pause(1500);
  await page.screenshot({path:`results/${engine}-interactive.png`});
  await docker('exec',name,'scrot','-o','/tmp/source.png');await docker('cp',`${name}:/tmp/source.png`,`results/${engine}-source.png`);
  const frame=await page.evaluate(()=>{benchContext.drawImage(benchSurface,0,0,1280,720);return benchContext.canvas.toDataURL('image/png').split(',')[1];});
  await writeFile(`results/${engine}-decoded.png`,Buffer.from(frame,'base64'));
  output.engines[engine]={latencyMs:latency,text:quality(PNG.sync.read(await readFile(`results/${engine}-source.png`)),PNG.sync.read(Buffer.from(frame,'base64')))};
  console.log(engine,'latency',JSON.stringify(latency),'quality',output.engines[engine].text);
  // Stop pixel probing before resource measurements; it otherwise changes browser load.
  for(let repeat=0;repeat<3;repeat++)for(const mode of ['idle','scroll','motion']) {
   await docker('exec',name,'python3','-c',`from pathlib import Path;Path('/tmp/bench-mode').write_text('${mode} ${repeat}')`);await pause(2000);
   const samples=(await docker('exec',name,'python3','-u','-c',sampler)).stdout.trim().split('\n').map(JSON.parse);
   const first=samples[0],last=samples.at(-1),seconds=last.t-first.t;
   const run={engine,mode,repeat,seconds,cpuPercent:(last.cpu-first.cpu)/1e6/seconds*100,memoryMiB:samples.reduce((s,r)=>s+r.memory,0)/samples.length/1048576,mbps:(last.tx-first.tx)*8/seconds/1e6,throttledMs:(last.throttle-first.throttle)/1000,samples};
   assert(seconds>=12&&run.cpuPercent>=0&&run.mbps>=0);output.runs.push(run);console.log(JSON.stringify({...run,samples:undefined}));
   await writeFile('results/raw.json',JSON.stringify(output,null,2));
  }
  await docker('exec',name,'python3','-c',"from pathlib import Path;Path('/tmp/bench-mode').write_text('idle finished')");
  await page.close();
 }
 await writeFile('results/raw.json',JSON.stringify(output,null,2));
} finally {await browser.close();await docker('start','desktop-bench-selkies','desktop-bench-kasm');}
