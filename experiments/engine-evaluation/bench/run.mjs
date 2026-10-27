import {chromium} from "playwright";
import {PNG} from "pngjs";
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
  return frames.length > 20 && steps.every(d => d > 0 && d < 2048) &&
    observed.raf > 0 && observed.invalid / observed.raf < .02 &&
    inputs.length === 40 && inputs.every(v => Number.isFinite(v) && v > 0);
}
if (process.argv.includes("--self-check")) {
  const valid = {frames:Array.from({length:30},(_,id)=>({id})), raf:30, invalid:0};
  const inputs = Array(40).fill(20);
  assert(validate(valid, inputs));
  assert(!validate({...valid, frames:Array(30).fill({id:1})}, inputs));
  assert(!validate(valid, [...inputs.slice(0,39), null]));
  console.log("offline scoring checks passed");
  process.exit(0);
}
const config = JSON.parse(await readFile(path.join(here, "../candidate.json"), "utf8"));
const engine = process.env.ENGINE || config.engine;
if (!["selkies", "kasm", "native"].includes(engine)) throw Error("Set ENGINE=selkies|kasm|native");
const image = process.env.BENCH_IMAGE || (process.env.ENGINE ? (engine === "native" ? "" : "sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712") : config.image);
if (!image) throw Error("Set BENCH_IMAGE for native");
const command = process.env.BENCH_COMMAND || (process.env.ENGINE ? engine : config.command);
const id = `${new Date().toISOString().replace(/[:.]/g,"-")}-${engine}-${randomUUID().slice(0,8)}`;
const directory = path.join(here,"results",id);
await mkdir(directory,{recursive:true});
const fixture = path.join(here,"fixture.py");
const result = {id,engine,image,command,started:new Date().toISOString(),fixtureSha256:createHash("sha256").update(await readFile(fixture)).digest("hex"),runnerSha256:createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex"),inputLatencyStartEvent:"pointerdown",runs:{},latency:{},errors:[],limits:"Browser animation-frame sampling, fixture producer rate, static text quality only; not maximum FPS or matched motion quality."};
const progress = phase => console.error(`${engine}: ${phase}`);
const save = () => writeFile(path.join(directory,"raw.json"),JSON.stringify(result,null,2));
const name = `native-stream-bench-${id.toLowerCase()}`;
let browser, created = false;
const sampler = `import json,time,pathlib
p=pathlib.Path("/sys/fs/cgroup")
def pairs(name): return {a:int(b) for a,b in (s.split() for s in (p/name).read_text().splitlines())}
for i in range(31):
 c=pairs("cpu.stat"); m=pairs("memory.stat"); n=pathlib.Path("/proc/net/dev").read_text().split("eth0:")[1].split()
 try: fixture=json.loads(pathlib.Path("/tmp/bench-status.json").read_text())
 except (FileNotFoundError,json.JSONDecodeError): fixture=None
 print(json.dumps(dict(t=time.monotonic(),cpu=c["usage_usec"],throttle=c.get("throttled_usec",0),memory=int((p/"memory.current").read_text())-m.get("inactive_file",0),tx=int(n[8]),fixture=fixture)),flush=True)
 if i<30: time.sleep(1)`;
try {
  progress("creating container");
  await docker("create","--name",name,"--cpus","2","--memory","1536m","--memory-swap","1536m","--shm-size","512m","--env-file",path.join(root,"desktop-stream-bench/.env"),"--env","SELKIES_ALLOWED_ORIGINS=http://127.0.0.1:18093","-p","127.0.0.1:18093:8080",image,command);
  created = true; result.container = name;
  await docker("cp",fixture,`${name}:/opt/bench/fixture.py`);
  await docker("start",name);
  result.imageId = (await docker("inspect","--format","{{.Image}}",name)).stdout.trim();
  const env = await readFile(path.join(root,"desktop-stream-bench/.env"),"utf8");
  const password = env.split(/\r?\n/).find(line=>line.startsWith("BENCH_PASSWORD="))?.slice("BENCH_PASSWORD=".length);
  browser = await chromium.launch({executablePath:process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
  const context = await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1,...(engine === "kasm" ? {httpCredentials:{username:"bench",password}} : {})});
  const page = await context.newPage();
  result.browserUserAgent = await page.evaluate(()=>navigator.userAgent);
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
  await docker("exec","-u","bench",name,"xdotool","search","--onlyvisible","--name","^Desktop streaming lab","windowactivate","--sync");
  const status = async()=>JSON.parse((await docker("exec",name,"cat","/tmp/bench-status.json")).stdout);
  const mode = async(value,fps=false)=>{await docker("exec","-u","bench",name,"python3","-c",`from pathlib import Path;Path("/tmp/bench-mode").write_text("${value} ${fps?"fps":""} ${Date.now()}")`);await sleep(2000);};
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
  for(const workload of ["idle","motion"]) {
    progress(`${workload} input trials`);
    await mode(workload); const before=await status();await page.evaluate(()=>{window.latencies=[];window.measureLatency=true;});
    for(let i=0;i<40;i++){try {await page.mouse.click(position.x+1050,position.y+565);await page.waitForFunction(n=>latencies.length>n,i,{timeout:4000});} catch(e){result.errors.push(`${workload} click ${i}: ${e.message}`);break;}await sleep(170);}
    result.latency[workload]=await page.evaluate(()=>{window.measureLatency=false;return latencies;});const after=await status();
    if(after.toggles-before.toggles!==40) result.errors.push(`${workload}: native toggle count ${after.toggles-before.toggles}/40`);
    await save();
  }
  progress("static quality");
  await mode("idle");await page.mouse.move(10,700);await sleep(1500);
  await docker("exec","-u","bench",name,"scrot","-o","/tmp/source.png");await docker("cp",`${name}:/tmp/source.png`,path.join(directory,"source.png"));
  const decoded=Buffer.from(await page.evaluate(()=>{const c=document.createElement("canvas");c.width=1280;c.height=720;c.getContext("2d").drawImage(surface,0,0);return c.toDataURL().split(",")[1];}),"base64");await writeFile(path.join(directory,"decoded.png"),decoded);
  const a=PNG.sync.read(await readFile(path.join(directory,"source.png"))), b=PNG.sync.read(decoded);
  if(a.width!==1280 || a.height!==720 || b.width!==1280 || b.height!==720 || position.x+24<0 || position.y+105<0 || position.x+1096>1280 || position.y+330>720) throw Error("Invalid image dimensions or text ROI");
  let squared=0,ink=0,inkError=0,n=0;
  for(let y=position.y+105;y<position.y+330;y++)for(let x=position.x+24;x<position.x+1096;x++){const i=(y*1280+x)*4;const isInk=Math.min(a.data[i],a.data[i+1],a.data[i+2])<180;for(let c=0;c<3;c++){const d=Math.abs(a.data[i+c]-b.data[i+c]);squared+=d*d;n++;if(isInk){ink++;inkError+=d;}}}
  if(ink<1000) throw Error("Invalid text ROI");result.text={psnrDb:squared?10*Math.log10(255**2/(squared/n)):null,textInkMeanAbsoluteError:inkError/ink};
  for(const workload of ["idle","scroll","motion"]) {
    progress(`${workload} resource and frame observation`);
    await mode(workload,workload!=="idle");
    if(workload!=="idle") await page.evaluate(()=>{window.obs={start:performance.now(),end:null,frames:[],invalid:0,raf:0};window.measuring=true;function sample(){const t=performance.now(),id=readFrame();obs.raf++;if(id===null)obs.invalid++;else if(obs.frames.at(-1)?.id!==id)obs.frames.push({t,id});if(measuring)requestAnimationFrame(sample);else obs.end=t;}requestAnimationFrame(sample);});
    const samples=(await docker("exec",name,"python3","-u","-c",sampler)).stdout.trim().split("\n").map(JSON.parse);
    let observed=null;if(workload!=="idle"){await page.evaluate(()=>{window.measuring=false;});await page.waitForFunction(()=>obs.end!==null);observed=await page.evaluate(()=>obs);}
    const a=samples[0],b=samples.at(-1),seconds=b.t-a.t;
    if(samples.length!==31 || seconds<30) throw Error(`${workload}: insufficient resource samples`);
    const run={samples,observed,seconds,cpuPercent:(b.cpu-a.cpu)/1e6/seconds*100,memoryMiB:samples.reduce((s,r)=>s+r.memory,0)/samples.length/1048576,mbps:(b.tx-a.tx)*8/seconds/1e6,throttledMs:(b.throttle-a.throttle)/1000};
    if(observed){run.visibleUpdatesPerSecond=(observed.frames.length-1)/((observed.end-observed.start)/1000);const first=a.fixture,last=b.fixture;if(!first?.fps_marker||!last?.fps_marker||last.frame<=first.frame)throw Error(`${workload}: invalid producer observations`);run.producerUpdatesPerSecond=(last.frame-first.frame)/((last.time_ns-first.time_ns)/1e9);if(!validate(observed,result.latency.motion))result.errors.push(`${workload}: invalid frame or input observations`);}
    result.runs[workload]=run;await save();
  }
  result.valid=result.errors.length===0 && ["idle","motion"].every(w=>result.latency[w].length===40&&result.latency[w].every(v=>Number.isFinite(v)&&v>0));
  result.completed=new Date().toISOString();
} catch(e) { result.valid=false;result.errors.push(e.stack || String(e)); }
finally {
  if(browser)try{await browser.close();}catch(e){result.errors.push(`browser close: ${e.message}`);result.valid=false;}
  if(created)try{await docker("stop","-t","3",name);}catch(e){result.errors.push(`container stop: ${e.message}`);result.valid=false;}
  await save();
}
const flat={id,engine,valid:result.valid,errors:result.errors.length};
for(const [mode,run] of Object.entries(result.runs))for(const key of ["cpuPercent","memoryMiB","mbps","throttledMs","visibleUpdatesPerSecond","producerUpdatesPerSecond"])if(run[key]!==undefined)flat[`${mode}_${key}`]=run[key];
for(const [mode,values] of Object.entries(result.latency))if(values.length && values.every(v=>Number.isFinite(v)&&v>0)){flat[`${mode}_latencyMedianMs`]=[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];flat[`${mode}_latencyP95Ms`]=p95(values);}
if(result.text)Object.assign(flat,result.text);
console.log(JSON.stringify(flat));
if(!result.valid)process.exitCode=1;
