import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {createHash} from "node:crypto";
import {chromium} from "../../desktop-stream-bench/node_modules/playwright/index.mjs";
const exec=promisify(execFile), sleep=ms=>new Promise(r=>setTimeout(r,ms));
function calculate(a,b) {
 const seconds=b.t-a.t;if(seconds<=0||b.cpu<a.cpu||b.tx<a.tx)throw Error("Invalid resource counters");
 const processes={};for(const [key,p] of Object.entries(b.processes)){const before=a.processes[key];if(before)processes[key]={name:p.name,cpuPercent:(p.ticks-before.ticks)/b.hz/seconds*100,threads:p.threads};}
 return {seconds,cpuPercent:(b.cpu-a.cpu)/1e6/seconds*100,memoryMiB:b.memory/1048576,mbps:(b.tx-a.tx)*8/seconds/1e6,processes};
}
if(process.argv.includes("--self-check")){
 const a={t:1,cpu:0,tx:0,processes:{"1:7":{ticks:10}}},b={t:2,cpu:1000000,tx:125000,memory:1048576,hz:100,processes:{"1:7":{ticks:60,name:"doom",threads:{}}}};
 const v=calculate(a,b);assert.equal(v.cpuPercent,100);assert.equal(v.mbps,1);assert.equal(v.processes["1:7"].cpuPercent,50);assert.throws(()=>calculate(b,a));console.log("offline checks passed");process.exit(0);
}
const engine=process.argv[2];
assert(["native","selkies","kasm"].includes(engine),"Usage: node qualification/game.mjs native|selkies|kasm");
const here=path.dirname(fileURLToPath(import.meta.url)),dir=path.join(here,"results",`game-${engine}-${Date.now()}`);
await mkdir(dir,{recursive:true});
const container=`qualification-game-${engine}-${process.pid}`,port=18099,url=`http://127.0.0.1:${port}`;
const data={engine,container,url,started:new Date().toISOString(),producerRate:"unknown (configured cap 60 is not measured production)",inputLatency:"unmeasured",notes:"Useful visual changes are downscaled canvas hashes sampled at browser rAF; not decoded FPS, physical presentation, or gaming latency. Resources include desktop and game.",errors:[],browserErrors:[],phases:{}};
const save=()=>writeFile(path.join(dir,"result.json"),JSON.stringify(data,null,2));
const sampler=`import json,os,pathlib,time
p=pathlib.Path("/sys/fs/cgroup")
def pairs(n): return {a:int(b) for a,b in (s.split() for s in (p/n).read_text().splitlines())}
def stat(p):
 s=p.read_text(); end=s.rfind(")"); rest=s[end+2:].split(); return s[s.find("(")+1:end],int(rest[11])+int(rest[12]),rest[19]
c=pairs("cpu.stat"); m=pairs("memory.stat"); n=pathlib.Path("/proc/net/dev").read_text().split("eth0:")[1].split(); processes={}
for d in pathlib.Path("/proc").iterdir():
 if not d.name.isdigit(): continue
 try:
  name,ticks,start=stat(d/"stat"); threads={}
  for task in (d/"task").iterdir():
   try:
    tn,tt,_=stat(task/"stat")
    if "llvmpipe" in tn.lower(): threads[task.name]={"name":tn,"ticks":tt}
   except (FileNotFoundError,ProcessLookupError,PermissionError): pass
  processes[d.name+":"+start]={"name":name,"ticks":ticks,"threads":threads}
 except (FileNotFoundError,ProcessLookupError,PermissionError): pass
print(json.dumps(dict(t=time.monotonic(),cpu=c["usage_usec"],memory=int((p/"memory.current").read_text())-m.get("inactive_file",0),tx=int(n[8]),hz=os.sysconf("SC_CLK_TCK"),processes=processes)))`;
const docker=async(...args)=>(await exec("docker",args,{maxBuffer:20*1024*1024})).stdout;
const snapshot=async()=>JSON.parse(await docker("exec",container,"python3","-c",sampler));
const keyOracle=`import ctypes as C,json
x=C.CDLL('libX11.so.6')
x.XOpenDisplay.restype=C.c_void_p
x.XKeysymToKeycode.argtypes=[C.c_void_p,C.c_ulong]
x.XKeysymToKeycode.restype=C.c_ubyte
x.XQueryKeymap.argtypes=[C.c_void_p,C.c_void_p]
x.XGetInputFocus.argtypes=[C.c_void_p,C.c_void_p,C.c_void_p]
d=x.XOpenDisplay(None)
assert d,'X display unavailable'
b=C.create_string_buffer(32)
x.XQueryKeymap(d,b)
held={}
for name,sym in [('right',0xff53),('control',0xffe3)]:
 code=x.XKeysymToKeycode(d,sym)
 held[name]=bool(b.raw[code//8] & (1 << (code%8)))
f,r=C.c_ulong(),C.c_int()
x.XGetInputFocus(d,C.byref(f),C.byref(r))
print(json.dumps(dict(held=held,xFocus=f.value)))`;
const keyState=async()=>JSON.parse(await docker("exec",container,"python3","-c",keyOracle));

let browser,page,created=false;
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
try {
 data.sourceSha256={};for(const name of ["game.mjs","game-launch.sh","Dockerfile.games"])data.sourceSha256[name]=hash(await readFile(path.join(here,name)));
 const envFile=path.resolve(here,"../../desktop-stream-bench/.env");
 const envText=await readFile(envFile,"utf8"),password=envText.match(/^BENCH_PASSWORD=(.*)$/m)?.[1]?.replace(/^['"]|['"]$/g,"");
 assert(password,"BENCH_PASSWORD missing from desktop-stream-bench/.env");
 await docker("create","--name",container,"--cpus","2","--memory","1536m","--memory-swap","1536m","--shm-size","512m","--env-file",envFile,"--env","SELKIES_ALLOWED_ORIGINS=http://127.0.0.1:18099","-p",`127.0.0.1:${port}:8080`,"native-stream-lab:games",engine);created=true;
 await docker("start",container);
 data.imageId=(await docker("inspect","--format","{{.Image}}",container)).trim();
 data.containerArtifactSha256=(await docker("exec",container,"sha256sum","/usr/games/crispy-doom","/usr/share/games/doom/freedoom1.wad","/opt/native/native-stream","/opt/native/session.sh","/opt/bench/session.sh","/opt/native/game-launch.sh")).trim().split("\n");
 for(let i=0;i<40;i++){const s=await snapshot();if(Object.values(s.processes).some(p=>p.name.includes("crispy-doom")))break;if(i===39)throw Error("Game failed to start");await sleep(500);}
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
 page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1,httpCredentials:{username:"bench",password}});
 page.on("pageerror",e=>data.browserErrors.push(`pageerror: ${e.message}`));
 for(let i=0;i<30;i++){try{await page.goto(url,{waitUntil:"domcontentloaded"});break;}catch(e){if(i===29)throw e;await sleep(500);}}
 await page.waitForFunction(()=>[...document.querySelectorAll("canvas,video")].some(e=>e.getBoundingClientRect().width===1280&&e.getBoundingClientRect().height===720),null,{timeout:30000});
 await sleep(5000);
 if(engine==="kasm"){
  data.clientSettings=await page.evaluate(()=>{
   const ids=["video_quality","framerate_image_mode","framerate_streaming_mode","stream_mode","dynamic_quality_min","dynamic_quality_max","treat_lossless","jpeg_video_quality","webp_video_quality"];
   const snapshot=()=>Object.fromEntries(ids.map(id=>[id,document.getElementById(`noVNC_setting_${id}`).value]));const before=snapshot();
   for(const [id,value] of [["video_quality","10"],["framerate_image_mode","60"]]){const f=document.getElementById(`noVNC_setting_${id}`);f.value=value;f.dispatchEvent(new Event("change",{bubbles:true}));}return {before,after:snapshot()};
  });
  assert.equal(data.clientSettings.after.framerate_image_mode,"60");assert.equal(data.clientSettings.after.framerate_streaming_mode,"60");
  for(const id of ["stream_mode","dynamic_quality_min","dynamic_quality_max","treat_lossless","jpeg_video_quality","webp_video_quality"])assert.equal(data.clientSettings.before[id],data.clientSettings.after[id]);
 }
 await docker("exec",container,"xdotool","search","--onlyvisible","--class","crispy-doom","windowactivate","--sync");
 await page.evaluate(()=>{
  window.gameSurface=[...document.querySelectorAll("canvas,video")].find(e=>e.getBoundingClientRect().width===1280&&e.getBoundingClientRect().height===720);
  gameSurface.setAttribute("tabindex","0");gameSurface.focus();
  const c=document.createElement("canvas");c.width=160;c.height=90;window.gameProbe=c.getContext("2d",{willReadFrequently:true});
  window.gamePixel=()=>{gameProbe.drawImage(gameSurface,0,0,160,90);const d=gameProbe.getImageData(0,0,160,90).data;let h=2166136261,lit=0;for(let i=0;i<d.length;i+=4){if(d[i]>10||d[i+1]>10||d[i+2]>10)lit++;for(let j=0;j<3;j++)h=Math.imul(h^d[i+j],16777619);}return {hash:h>>>0,nonblack:lit/14400};};
 });
 await sleep(2000);
 async function screenshot(name){const bytes=await page.screenshot({path:path.join(dir,`${name}.png`)});data[`${name}ScreenshotSha256`]=hash(bytes);return page.evaluate(()=>gamePixel());}
 data.before=await screenshot("before");assert(data.before.nonblack>.01,"Initial game surface is black");
 async function phase(name,input){
  await page.evaluate(()=>{window.gameObservation={start:performance.now(),frames:[]};window.gameSampling=true;function step(){try{gameObservation.frames.push({t:performance.now(),...gamePixel()});}catch(e){gameObservation.error=e.message;window.gameSampling=false;}if(gameSampling)requestAnimationFrame(step);}requestAnimationFrame(step);});
  const start=await snapshot();let heldBefore=null,heldAfter=null;
  if(input){await page.keyboard.down("ArrowRight");await page.keyboard.down("Control");await sleep(200);heldBefore=await keyState();data.inputHeldBefore=heldBefore;await save();assert(heldBefore.held.right&&heldBefore.held.control,"X11 did not receive right/control key presses");}
  await sleep(20000);
  if(input){heldAfter=await keyState();data.inputHeldAfter=heldAfter;await save();assert(heldAfter.held.right&&heldAfter.held.control,"X11 lost held right/control keys during live input");}
  const end=await snapshot();await page.evaluate(()=>{window.gameSampling=false;gameObservation.end=performance.now();});
  const observed=await page.evaluate(()=>gameObservation);assert(!observed.error,observed.error);assert(observed.frames.length>0,"No browser pixel samples");assert(observed.frames.every(f=>f.nonblack>.01),"Black game surface sample");
  let changes=0;for(let i=1;i<observed.frames.length;i++)if(observed.frames[i].hash!==observed.frames[i-1].hash)changes++;
  data.phases[name]={...calculate(start,end),start,end,heldBefore,heldAfter,observed,usefulVisualChanges:changes,usefulVisualChangesPerSecond:changes/((observed.end-observed.start)/1000)};
  if(input)assert(changes>0,"No useful visual changes under real keyboard input");await save();
 }
 await phase("stationary",false);await phase("liveInput",true);
 await page.keyboard.up("Control");await page.keyboard.up("ArrowRight");data.inputReleased=await keyState();assert(!data.inputReleased.held.right&&!data.inputReleased.held.control,"X11 keys remain held after release");data.after=await screenshot("after");
 assert.notEqual(data.before.hash,data.after.hash,"Game pixels did not change after turn/fire");
 data.decoderErrors=await page.evaluate(()=>({native:window.nativeStats?.decodeerrors??null,video:[...document.querySelectorAll("video")].map(v=>v.error?{code:v.error.code,message:v.error.message}:null)}));
 assert(!data.decoderErrors.native,"Native decoder errors");assert(data.decoderErrors.video.every(e=>e===null),"Video decoder errors");data.valid=true;data.completed=new Date().toISOString();
} catch(e){data.valid=false;data.errors.push(e.stack||String(e));process.exitCode=1;}
finally {
 if(page)for(const key of ["Control","ArrowRight"])try{await page.keyboard.up(key);}catch(e){data.errors.push(`release ${key}: ${e.message}`);data.valid=false;process.exitCode=1;}
 if(browser)try{await browser.close();}catch(e){data.errors.push(`browser close: ${e.message}`);data.valid=false;process.exitCode=1;}
 if(created){try{await writeFile(path.join(dir,"container.log"),await docker("logs",container));await docker("stop","-t","3",container);}catch(e){data.errors.push(`container cleanup: ${e.message}`);data.valid=false;process.exitCode=1;}}
 await save();
}
console.log(JSON.stringify({valid:data.valid,result:path.join(dir,"result.json"),errors:data.errors}));
