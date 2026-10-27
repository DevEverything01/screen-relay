import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const exec=promisify(execFile);
const docker=(...args)=>exec('docker',args,{maxBuffer:20*1024*1024});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const tuned=process.env.KASM_60==='1';
const dir=tuned?'results/kasm-60-check':'results/desktop-comparison';
await mkdir(dir,{recursive:true});
const out={started:new Date().toISOString(),fixtureSha256:createHash('sha256').update(await readFile('fixture.py')).digest('hex'),cases:[]};
const progress=async state=>{console.log(state);await writeFile('.benchmark-active',JSON.stringify({state}));};
const sampler=`import json,time,pathlib
p=pathlib.Path('/sys/fs/cgroup')
def pairs(name): return {a:int(b) for a,b in (s.split() for s in (p/name).read_text().splitlines())}
for i in range(13):
 c=pairs('cpu.stat'); m=pairs('memory.stat'); n=pathlib.Path('/proc/net/dev').read_text().split('eth0:')[1].split()
 try: fixture=json.loads(pathlib.Path('/tmp/bench-status.json').read_text())
 except (FileNotFoundError,json.JSONDecodeError): fixture=None
 print(json.dumps(dict(t=time.monotonic(),cpu=c['usage_usec'],throttle=c.get('throttled_usec',0),memory=int((p/'memory.current').read_text())-m.get('inactive_file',0),tx=int(n[8]),fixture=fixture)),flush=True)
 if i<12: time.sleep(1)
`;
function resources(samples){
 const a=samples[0],b=samples.at(-1),seconds=b.t-a.t;
 assert(seconds>=12&&samples.length===13);
 return {seconds,cpuPercent:(b.cpu-a.cpu)/1e6/seconds*100,memoryMiB:samples.reduce((s,r)=>s+r.memory,0)/samples.length/1048576,mbps:(b.tx-a.tx)*8/seconds/1e6,throttledMs:(b.throttle-a.throttle)/1000,samples};
}
function quality(source,decoded,x,y){
 assert.equal(source.width,1280);assert.equal(decoded.width,1280);
 let n=0,squared=0,absolute=0,inkN=0,inkAbsolute=0;
 for(let yy=y+105;yy<y+330;yy++)for(let xx=x+24;xx<x+1096;xx++){
  const at=(yy*1280+xx)*4,ink=Math.min(...source.data.subarray(at,at+3))<180;
  for(let c=0;c<3;c++){const d=Math.abs(source.data[at+c]-decoded.data[at+c]);n++;absolute+=d;squared+=d*d;if(ink){inkN++;inkAbsolute+=d;}}
 }
 assert(inkN>1000);
 return {psnrDb:squared?10*Math.log10(255**2/(squared/n)):null,meanAbsoluteError:absolute/n,textInkMeanAbsoluteError:inkAbsolute/inkN,roi:[x+24,y+105,1072,225]};
}
let browser,active;
await progress('Reserving streams for a controlled Xfce/GNOME comparison…');
try {
 await docker('stop','-t','3','desktop-bench-selkies','desktop-bench-kasm');
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const agentPage=await browser.newPage();out.browserUserAgent=await agentPage.evaluate(()=>navigator.userAgent);await agentPage.close();
 // Interleave desktop/engine choices instead of measuring all of one desktop first.
 for(const [desktop,engine] of (tuned?[['gnome','kasm'],['xfce','kasm']]:[['xfce','selkies'],['gnome','kasm'],['gnome','selkies'],['xfce','kasm']])){
  const key=`${desktop}-${engine}`,name=`desktop-measure-${engine}`,port=engine==='selkies'?8031:8032;
  const image=`desktop-stream-bench:${desktop==='xfce'?'local':'gnome'}`;
  await progress(`Benchmarking ${desktop} / ${engine}: starting a fresh session`);
  await docker('create','--name',name,'--cpus','2','--memory','1536m','--memory-swap','1536m','--shm-size','512m','--env-file','.env','-p',`127.0.0.1:${engine==='selkies'?18091:18092}:8080`,image,engine);
  active=name;await docker('cp','fixture.py',`${name}:/opt/bench/fixture.py`);await docker('start',name);
  const c={desktop,engine,imageId:(await docker('inspect','--format','{{.Image}}',name)).stdout.trim(),latency:{},runs:[],fps:[]};
  out.cases.push(c);
  const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1,userAgent:`${out.browserUserAgent} DesktopStreamBench/1.0`});
  for(let retry=0;retry<30;retry++){
   const response=await page.goto(`http://localhost:${port}`,{waitUntil:'domcontentloaded'});
   if(response.ok())break;
   if(retry===29)throw Error(`${key}: viewer unavailable`);
   await pause(1000);
  }
  await page.waitForFunction(()=>[...document.querySelectorAll('video,canvas')].some(e=>e.getBoundingClientRect().width===1280&&e.getBoundingClientRect().height===720));
  await pause(8000);
  if(tuned){
   c.clientSettings=await page.evaluate(()=>{
    const ids=['video_quality','framerate_image_mode','framerate_streaming_mode','stream_mode','dynamic_quality_min','dynamic_quality_max','treat_lossless','jpeg_video_quality','webp_video_quality'];
    const snapshot=()=>Object.fromEntries(ids.map(id=>[id,document.getElementById(`noVNC_setting_${id}`).value]));
    const before=snapshot();
    for(const [id,value] of [['video_quality','10'],['framerate_image_mode','60']]){const field=document.getElementById(`noVNC_setting_${id}`);field.value=value;field.dispatchEvent(new Event('change',{bubbles:true}));}
    return {before,after:snapshot(),streamModeLabel:document.getElementById('noVNC_setting_stream_mode').selectedOptions[0].textContent};
   });
   assert.equal(c.clientSettings.after.framerate_image_mode,'60');assert.equal(c.clientSettings.after.framerate_streaming_mode,'60');
   for(const id of ['stream_mode','dynamic_quality_min','dynamic_quality_max','treat_lossless','jpeg_video_quality','webp_video_quality'])assert.equal(c.clientSettings.before[id],c.clientSettings.after[id]);
   await pause(2000);
  }
  await docker('exec','-u','bench',name,'xdotool','key','Escape');
  await docker('exec','-u','bench',name,'xdotool','search','--onlyvisible','--name','^Desktop streaming lab','windowactivate','--sync');await pause(2000);
  const native=async()=>JSON.parse((await docker('exec',name,'cat','/tmp/bench-status.json')).stdout);
  const mode=async(value,fps=false)=>{await docker('exec','-u','bench',name,'python3','-c',`from pathlib import Path;Path('/tmp/bench-mode').write_text('${value} ${fps?'fps':''} ${Date.now()}')`);await pause(2000);};
  await mode('idle');const position=await native();c.geometry={x:position.x,y:position.y};
  await page.evaluate(({x,y})=>{
   window.surface=[...document.querySelectorAll('video,canvas')].find(e=>e.getBoundingClientRect().width===1280&&e.getBoundingClientRect().height===720);
   const canvas=document.createElement('canvas');canvas.width=112;canvas.height=12;
   window.probe=canvas.getContext('2d',{willReadFrequently:true});window.origin={x,y};window.latencies=[];
   window.pixel=()=>{probe.drawImage(surface,x+1050,y+565,1,1,0,0,1,1);return [...probe.getImageData(0,0,1,1).data];};
   window.addEventListener('mousedown',()=>{
    if(!window.measureLatency)return;
    const before=pixel(),start=performance.now();
    function check(){const after=pixel();if((before[0]>before[1])!==(after[0]>after[1]))latencies.push(performance.now()-start);else if(performance.now()-start<3000)requestAnimationFrame(check);else latencies.push(null);}
    requestAnimationFrame(check);
   },true);
   window.readFrame=()=>{
    probe.drawImage(surface,x+24,y+540,112,12,0,0,112,12);
    const data=probe.getImageData(0,6,112,1).data;
    if(data[4*4]>80||data[12*4]<175)return null;
    let value=0;for(let bit=0;bit<12;bit++)value|=(data[((bit+2)*8+4)*4]>128?1:0)<<bit;
    return value;
   };
  },c.geometry);
  const pixel=await page.evaluate(()=>pixel());assert(Math.abs(pixel[0]-pixel[1])>100,`${key}: flash pixel not visible`);
  for(const workload of ['idle','motion']){
   await progress(`Benchmarking ${key}: 30 ${workload} input trials`);await mode(workload);
   const before=await native();await page.evaluate(()=>{window.latencies=[];window.measureLatency=true;});
   for(let i=0;i<30;i++){await page.mouse.click(position.x+1050,position.y+565);await page.waitForFunction(n=>latencies.length>n,i,{timeout:4000});await pause(170);}
   c.latency[workload]=await page.evaluate(()=>{window.measureLatency=false;return latencies;});
   assert(c.latency[workload].every(v=>v!==null&&v>0));const after=await native();assert.equal(after.toggles-before.toggles,30);assert.equal(after.flash,before.flash);
  }
  await mode('idle');await page.mouse.move(10,700);await pause(1500);
  await docker('exec','-u','bench',name,'scrot','-o','/tmp/source.png');await docker('cp',`${name}:/tmp/source.png`,`${dir}/${key}-source.png`);
  const frame=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;canvas.getContext('2d').drawImage(surface,0,0,1280,720);return canvas.toDataURL().split(',')[1];});
  await writeFile(`${dir}/${key}-decoded.png`,Buffer.from(frame,'base64'));await page.screenshot({path:`${dir}/${key}-viewer.png`});
  c.text=quality(PNG.sync.read(await readFile(`${dir}/${key}-source.png`)),PNG.sync.read(Buffer.from(frame,'base64')),position.x,position.y);
  for(let repeat=0;repeat<(tuned?1:3);repeat++)for(const workload of (tuned?['idle','motion']:['idle','scroll','motion'])){
   await progress(`Benchmarking ${key}: ${workload}, repeat ${repeat+1}/${tuned?1:3}`);await mode(workload);
   const samples=(await docker('exec',name,'python3','-u','-c',sampler)).stdout.trim().split('\n').map(JSON.parse);
   const run={mode:workload,repeat,...resources(samples)};c.runs.push(run);console.log(JSON.stringify({...run,samples:undefined}));await writeFile(`${dir}/raw.json`,JSON.stringify(out,null,2));
  }
  for(const workload of (tuned?['motion']:['scroll','motion'])){
   await progress(`Benchmarking ${key}: received frame IDs during ${workload}`);await mode(workload,true);
   await page.evaluate(()=>{
    window.fpsObservation={start:performance.now(),end:null,frames:[],invalid:0,raf:0};window.measureFps=true;
    function sample(){const t=performance.now(),id=readFrame();fpsObservation.raf++;if(id===null)fpsObservation.invalid++;else if(fpsObservation.frames.at(-1)?.id!==id)fpsObservation.frames.push({t,id});if(measureFps)requestAnimationFrame(sample);else fpsObservation.end=t;}
    requestAnimationFrame(sample);
   });
   const samples=(await docker('exec',name,'python3','-u','-c',sampler)).stdout.trim().split('\n').map(JSON.parse);
   await page.evaluate(()=>{window.measureFps=false;});await page.waitForFunction(()=>fpsObservation.end!==null);
   const observed=await page.evaluate(()=>fpsObservation);assert(observed.frames.length>20,`${key}: frame IDs did not advance`);assert(observed.invalid/observed.raf<0.02,`${key}: frame marker decoding invalid`);
   const first=samples[0].fixture,last=samples.at(-1).fixture;
   assert(first.fps_marker&&last.fps_marker&&last.frame>first.frame);
   c.fps.push({mode:workload,visibleUpdatesPerSecond:(observed.frames.length-1)/((observed.end-observed.start)/1000),producerUpdatesPerSecond:(last.frame-first.frame)/((last.time_ns-first.time_ns)/1e9),...resources(samples),observed});
   console.log(key,workload,'visible FPS',c.fps.at(-1).visibleUpdatesPerSecond,'producer FPS',c.fps.at(-1).producerUpdatesPerSecond);
   await writeFile(`${dir}/raw.json`,JSON.stringify(out,null,2));
  }
  await docker('cp',`${name}:/tmp/display.log`,`${dir}/${key}-display.log`);
  await writeFile(`${dir}/${key}-container.log`,(await docker('logs',name)).stdout);
  await page.close();await docker('stop','-t','2',name);await docker('container','rm',name);active=null;
 }
 assert.equal(out.cases.length,tuned?2:4);for(const c of out.cases){assert.equal(c.runs.length,tuned?2:9);assert.equal(c.fps.length,tuned?1:2);}
 out.completed=new Date().toISOString();await writeFile(`${dir}/raw.json`,JSON.stringify(out,null,2));
 await progress('Measurements complete; restoring the interactive GNOME desktops…');
} finally {
 if(browser)await browser.close();
 if(active){await docker('stop','-t','2',active);await docker('container','rm',active);}
 await docker('start','desktop-bench-selkies','desktop-bench-kasm');await pause(12000);
 await rename('.benchmark-active',`${dir}/last-status.json`);
}
