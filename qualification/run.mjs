import {chromium} from "../../desktop-stream-bench/node_modules/playwright/index.mjs";
import {PNG} from "../../desktop-stream-bench/node_modules/pngjs/lib/png.js";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {createHash, randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const exec = promisify(execFile);
const docker = (...args) => exec("docker", args, {maxBuffer: 20 * 1024 * 1024});
const p95 = values => [...values].sort((a,b) => a-b)[Math.ceil(values.length*.95)-1];
function validate(observed, inputs) {
  const frames = observed.frames;
  const steps = frames.slice(1).map((f,i) => (f.id-frames[i].id+4096)%4096);
  return frames.length > 0 && steps.every(d => d > 0 && d < 2048) &&
    observed.raf > 0 && observed.invalid === 0 &&
    inputs.length === 20 && inputs.every(v => Number.isFinite(v) && v > 0);
}
function windowBounds(png) {
  if(png.width!==1280 || png.height!==720) throw Error("Window evidence requires 1280x720 source");
  let count=0,minX=1280,maxX=-1,minY=720,maxY=-1;
  for(let y=340;y<532;y++)for(let x=0;x<1280;x++) {
    const i=(y*1280+x)*4;
    if(png.data[i]===25 && png.data[i+1]===51 && png.data[i+2]===77) {
      count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    }
  }
  return {count,minX,maxX,minY,maxY};
}
function movedWindow(a,b) {
  return a.count>10000 && b.count>10000 && (a.minX!==b.minX || a.minY!==b.minY || a.maxX!==b.maxX || a.maxY!==b.maxY);
}
if (process.argv.includes("--self-check")) {
  const valid = {frames:Array.from({length:30},(_,id)=>({id})), raf:30, invalid:0};
  const inputs = Array(20).fill(20);
  assert(validate(valid, inputs));
  assert(!validate({...valid, frames:Array(30).fill({id:1})}, inputs));
  assert(validate({...valid,frames:[{id:7}]}, inputs));
  assert(validate({...valid,frames:[{id:4095},{id:0}]}, inputs));
  assert(!validate({...valid,frames:[{id:4},{id:3}]}, inputs));
  assert(!validate({...valid,frames:[]}, inputs));
  assert(!validate(valid, [...inputs.slice(0,19), null]));
  const image=new PNG({width:1280,height:720});
  assert.equal(windowBounds(image).count,0);
  const paint=(x0)=>{image.data.fill(0);for(let y=350;y<510;y++)for(let x=x0;x<x0+420;x++){const i=(y*1280+x)*4;image.data[i]=25;image.data[i+1]=51;image.data[i+2]=77;}return windowBounds(image);};
  const a=paint(40),b=paint(100);
  assert(movedWindow(a,b));assert(!movedWindow(a,a));assert(!movedWindow(a,{...b,count:100}));
  console.log("offline scoring checks passed");
  process.exit(0);
}
const config = JSON.parse(await readFile(path.join(here, "../candidate.json"), "utf8"));
const engine = process.env.ENGINE || config.engine;
if (!["selkies", "kasm", "native"].includes(engine)) throw Error("Set ENGINE=selkies|kasm|native");
const image = engine === "native" ? "native-stream-lab:final2" : "sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712";
const command = engine;
const cases = (process.env.CASES || "idle,scroll,window,video,mixed").split(",");
if (!cases.length || new Set(cases).size !== cases.length || cases.some(c => !["idle","scroll","window","video","mixed"].includes(c))) throw Error("Invalid CASES");
const motionQuality = process.env.MOTION_QUALITY === "1";
const profile = process.env.NET_PROFILE || "local";
if (!["local","delay","bandwidth"].includes(profile)) throw Error("Invalid NET_PROFILE");
const id = `${new Date().toISOString().replace(/[:.]/g,"-")}-${engine}-${randomUUID().slice(0,8)}`;
const directory = path.join(here,"results",id);
await mkdir(directory,{recursive:true});
const fixture = path.join(here,"fixture.py");
const result = {id,engine,image,command,started:new Date().toISOString(),fixtureSha256:createHash("sha256").update(await readFile(fixture)).digest("hex"),runnerSha256:createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex"),profile,cases,motionQuality,inputLatencyStartEvent:"pointerdown",runs:{},latency:{},errors:[],limits:"Browser animation-frame sampling; frozen-frame quality only, not motion fidelity. Idle includes marker overhead. Synthetic video is not recorded natural video."};
if(motionQuality) result.motionQualitySha256=createHash("sha256").update(await readFile(path.join(here,"motion-quality.mjs"))).digest("hex");
const progress = phase => console.error(`${engine}: ${phase}`);
const save = () => writeFile(path.join(directory,"raw.json"),JSON.stringify(result,null,2));
const name = `native-stream-bench-${id.toLowerCase()}`;
let browser, proxy, created = false;
const sampler = `import json,time,pathlib
p=pathlib.Path("/sys/fs/cgroup")
def pairs(name): return {a:int(b) for a,b in (s.split() for s in (p/name).read_text().splitlines())}
for i in range(21):
 c=pairs("cpu.stat"); m=pairs("memory.stat"); n=pathlib.Path("/proc/net/dev").read_text().split("eth0:")[1].split()
 try: fixture=json.loads(pathlib.Path("/tmp/bench-status.json").read_text())
 except (FileNotFoundError,json.JSONDecodeError): fixture=None
 print(json.dumps(dict(t=time.monotonic(),cpu=c["usage_usec"],throttle=c.get("throttled_usec",0),memory=int((p/"memory.current").read_text())-m.get("inactive_file",0),tx=int(n[8]),fixture=fixture)),flush=True)
 if i<20: time.sleep(1)`;
try {
  progress("creating container");
  await docker("create","--name",name,"--cpus","2","--memory","1536m","--memory-swap","1536m","--shm-size","512m","--env-file",path.join(root,"desktop-stream-bench/.env"),"--env","SELKIES_ALLOWED_ORIGINS=http://127.0.0.1:18093","-p",`127.0.0.1:${profile === "local" ? 18093 : 18098}:8080`,image,command);
  created = true; result.container = name;
  await docker("cp",fixture,`${name}:/opt/bench/fixture.py`);
  await docker("start",name);
  if (profile !== "local") {
    const {startProxy} = await import("./network.mjs");
    proxy = await startProxy({profile,listenPort:18093,targetPort:18098});
  }
  result.imageId = (await docker("inspect","--format","{{.Image}}",name)).stdout.trim();
  const env = await readFile(path.join(root,"desktop-stream-bench/.env"),"utf8");
  const password = env.split(/\r?\n/).find(line=>line.startsWith("BENCH_PASSWORD="))?.slice("BENCH_PASSWORD=".length);
  browser = await chromium.launch({executablePath:process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
  const context = await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1,...(engine === "kasm" ? {httpCredentials:{username:"bench",password}} : {})});
  const page = await context.newPage();
  result.browserUserAgent = await page.evaluate(()=>navigator.userAgent);
  if (!/Chrome\/156\./.test(result.browserUserAgent)) throw Error("Qualification requires Chrome 156");
  let ready = false;
  for(let i=0;i<30;i++) { try { const response=await page.goto("http://127.0.0.1:18093/",{waitUntil:"domcontentloaded",timeout:3000}); if(response?.ok()){ready=true;break;} } catch {} await sleep(1000); }
  if(!ready) throw Error("Viewer unavailable");
  await page.waitForFunction(()=>[...document.querySelectorAll("video,canvas")].some(e=>e.getBoundingClientRect().width===1280&&e.getBoundingClientRect().height===720),null,{timeout:30000});
  await sleep(8000);
  if(engine === "kasm") result.clientSettings = await page.evaluate(()=>{
    const ids=["video_quality","framerate_image_mode","framerate_streaming_mode","stream_mode","dynamic_quality_min","dynamic_quality_max","treat_lossless","jpeg_video_quality","webp_video_quality"];
    const snapshot=()=>Object.fromEntries(ids.map(id=>[id,document.getElementById(`noVNC_setting_${id}`).value]));
    const before=snapshot();
    for(const [id,value] of [["video_quality","10"],["framerate_image_mode","60"]]) {const field=document.getElementById(`noVNC_setting_${id}`);field.value=value;field.dispatchEvent(new Event("change",{bubbles:true}));}
    const after=snapshot(); if(after.framerate_image_mode!=="60"||after.framerate_streaming_mode!=="60") throw Error("Kasm 60 FPS setting failed");
    return {before,after};
  });
  await docker("exec","-u","bench",name,"xdotool","key","Escape");
  const status = async()=>JSON.parse((await docker("exec",name,"cat","/tmp/bench-status.json")).stdout);
  const mode = async(value,flag="fps")=>{await docker("exec","-u","bench",name,"python3","-c",`from pathlib import Path;Path("/tmp/bench-mode").write_text("${value} ${flag} ${Date.now()}")`);await sleep(2000);};
  await mode("idle"); const position=await status(); result.geometry={x:position.x,y:position.y};
  await page.evaluate(({x,y})=>{
    window.surface=[...document.querySelectorAll("video,canvas")].find(e=>e.getBoundingClientRect().width===1280&&e.getBoundingClientRect().height===720);
    const canvas=document.createElement("canvas");canvas.width=112;canvas.height=12;window.probe=canvas.getContext("2d",{willReadFrequently:true});
    window.pixel=()=>{probe.drawImage(surface,x+1050,y+565,1,1,0,0,1,1);return [...probe.getImageData(0,0,1,1).data];};
    window.latencies=[];window.addEventListener("pointerdown",()=>{if(!window.measureLatency)return;const before=pixel(),start=performance.now();function check(){const after=pixel();if((before[0]>before[1])!==(after[0]>after[1]))latencies.push(performance.now()-start);else if(performance.now()-start<3000)requestAnimationFrame(check);else latencies.push(null);}requestAnimationFrame(check);},true);
    window.readFrame=()=>{probe.drawImage(surface,x+24,y+540,112,12,0,0,112,12);const d=probe.getImageData(0,6,112,1).data;if(d[16]>80||d[48]<175)return null;let v=0;for(let b=0;b<12;b++)v|=(d[((b+2)*8+4)*4]>128?1:0)<<b;return v;};
  },result.geometry);
  const flashPixel = await page.evaluate(()=>pixel());
  if(Math.abs(flashPixel[0]-flashPixel[1]) <= 100) throw Error("Flash pixel is not visible or lacks red/green contrast");
  const captureWindow=async(label)=>{
    const file=`window-${label}.png`;
    await docker("exec","-u","bench",name,"scrot","-o","/tmp/window-evidence.png");
    await docker("cp",`${name}:/tmp/window-evidence.png`,path.join(directory,file));
    return {file,...windowBounds(PNG.sync.read(await readFile(path.join(directory,file))))};
  };
  for(const workload of cases) {
    const run = result.runs[workload] = {errors:[]};
    try {
      progress(`${workload} input trials`);
      await mode(workload);
      const before=await status();
      await page.evaluate(()=>{window.latencies=[];window.measureLatency=true;});
      for(let i=0;i<20;i++) {
        try {await page.mouse.click(position.x+1050,position.y+565);await page.waitForFunction(n=>latencies.length>n,i,{timeout:4000});}
        catch(e){run.errors.push(`click ${i}: ${e.message}`);break;}
        await sleep(170);
      }
      result.latency[workload]=await page.evaluate(()=>{window.measureLatency=false;return latencies;});
      const after=await status();
      run.inputToggleDelta=after.toggles-before.toggles;
      if(run.inputToggleDelta!==20) run.errors.push(`native toggle count ${run.inputToggleDelta}/20`);
      progress(`${workload} 20-second resource and frame observation`);
      if(workload === "window") run.windowEvidence={before:await captureWindow("before")};
      await page.evaluate(()=>{window.obs={start:performance.now(),end:null,frames:[],invalid:0,raf:0};window.measuring=true;function sample(){const t=performance.now(),id=readFrame();obs.raf++;if(id===null)obs.invalid++;else if(obs.frames.at(-1)?.id!==id)obs.frames.push({t,id});if(measuring)requestAnimationFrame(sample);else obs.end=t;}requestAnimationFrame(sample);});
      run.samples=(await docker("exec",name,"python3","-u","-c",sampler)).stdout.trim().split("\n").map(JSON.parse);
      await page.evaluate(()=>{window.measuring=false;});
      await page.waitForFunction(()=>obs.end!==null);
      run.observed=await page.evaluate(()=>obs);
      if(workload === "window") {
        run.windowEvidence.after=await captureWindow("after");
        run.windowEvidence.valid=movedWindow(run.windowEvidence.before,run.windowEvidence.after);
        if(!run.windowEvidence.valid) run.errors.push("Real X11 window not visibly present and moved in source snapshots");
      }
      const a=run.samples[0],b=run.samples.at(-1),seconds=b.t-a.t;
      if(run.samples.length!==21 || seconds<20) throw Error("Incomplete resource samples");
      Object.assign(run,{seconds,cpuPercent:(b.cpu-a.cpu)/1e6/seconds*100,memoryMiB:run.samples.reduce((s,r)=>s+r.memory,0)/run.samples.length/1048576,mbps:(b.tx-a.tx)*8/seconds/1e6,throttledMs:(b.throttle-a.throttle)/1000,visibleUpdatesPerSecond:Math.max(0,run.observed.frames.length-1)/((run.observed.end-run.observed.start)/1000)});
      const first=a.fixture,last=b.fixture;
      if(!first?.fps_marker || !last?.fps_marker || last.frame<first.frame || last.time_ns<=first.time_ns) throw Error("Invalid producer observations");
      run.producerUpdatesPerSecond=(last.frame-first.frame)/((last.time_ns-first.time_ns)/1e9);
      if(!validate(run.observed,result.latency[workload])) run.errors.push("Invalid marker or input observations");
      if(motionQuality && workload === "video") {
        progress("video sparse matched-frame motion quality");
        try {
          const {measureMotionQuality}=await import("./motion-quality.mjs");
          run.motionQuality=await measureMotionQuality({page,container:name,directory,docker,seconds:15});
          if(!run.motionQuality.valid) run.errors.push(...run.motionQuality.errors.map(e=>`motion quality: ${e}`));
        } catch(e) {run.motionQuality={valid:false,errors:[e.stack || String(e)]};run.errors.push(`motion quality: ${e.message}`);}
        await save();
      }
      progress(`${workload} frozen-frame quality`);
      await mode(workload,"freeze fps"); await page.mouse.move(10,700); await sleep(1500);
      const frozen=await status();
      if(!frozen.frozen || !frozen.fps_marker) throw Error("Fixture did not freeze with marker");
      await page.waitForFunction(id=>readFrame()===id,frozen.frame%4096,{timeout:30000});
      await docker("exec","-u","bench",name,"scrot","-o","/tmp/source.png");
      await docker("cp",`${name}:/tmp/source.png`,path.join(directory,`${workload}-source.png`));
      const decoded=Buffer.from(await page.evaluate(()=>{const c=document.createElement("canvas");c.width=1280;c.height=720;c.getContext("2d").drawImage(surface,0,0);return c.toDataURL().split(",")[1];}),"base64");
      await writeFile(path.join(directory,`${workload}-decoded.png`),decoded);
      const source=PNG.sync.read(await readFile(path.join(directory,`${workload}-source.png`))),target=PNG.sync.read(decoded);
      const current=await status();
      if(current.frame!==frozen.frame || current.toggles!==frozen.toggles || source.width!==1280 || source.height!==720 || target.width!==1280 || target.height!==720) throw Error("Invalid frozen quality pair");
      let squared=0,absolute=0,n=0;
      for(let i=0;i<source.data.length;i+=4)for(let c=0;c<3;c++){const d=Math.abs(source.data[i+c]-target.data[i+c]);squared+=d*d;absolute+=d;n++;}
      run.frozenQuality={psnrDb:squared?10*Math.log10(255**2/(squared/n)):null,meanAbsoluteError:absolute/n,scope:"full frozen frame; no motion-fidelity claim"};
    } catch(e) {run.errors.push(e.stack || String(e));}
    finally {await page.evaluate(()=>{window.measureLatency=false;window.measuring=false;}).catch(()=>{});}
    run.valid=run.errors.length===0 && run.samples?.length===21 && validate(run.observed,result.latency[workload]);
    result.errors.push(...run.errors.map(e=>`${workload}: ${e}`));
    await save();
  }
  result.valid=result.errors.length===0 && cases.every(w=>result.runs[w]?.samples?.length===21 && validate(result.runs[w].observed,result.latency[w]));
  result.completed=new Date().toISOString();
} catch(e) { result.valid=false;result.errors.push(e.stack || String(e)); }
finally {
  if(proxy)try{result.network=proxy.stats();await proxy.close();}catch(e){result.errors.push(`proxy close: ${e.message}`);result.valid=false;}
  if(browser)try{await browser.close();}catch(e){result.errors.push(`browser close: ${e.message}`);result.valid=false;}
  if(created)try{const logs=await docker("logs",name);await writeFile(path.join(directory,"container.log"),logs.stdout+logs.stderr);}catch(e){result.errors.push(`container logs: ${e.message}`);result.valid=false;}
  if(created)try{await docker("stop","-t","3",name);}catch(e){result.errors.push(`container stop: ${e.message}`);result.valid=false;}
  await save();
}
const flat={id,engine,valid:result.valid,errors:result.errors.length};
for(const [mode,run] of Object.entries(result.runs))for(const key of ["cpuPercent","memoryMiB","mbps","throttledMs","visibleUpdatesPerSecond","producerUpdatesPerSecond"])if(run[key]!==undefined)flat[`${mode}_${key}`]=run[key];
for(const [mode,values] of Object.entries(result.latency))if(values.length && values.every(v=>Number.isFinite(v)&&v>0)){flat[`${mode}_latencyMedianMs`]=[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];flat[`${mode}_latencyP95Ms`]=p95(values);}
if(result.text)Object.assign(flat,result.text);
console.log(JSON.stringify(flat));
if(!result.valid)process.exitCode=1;
