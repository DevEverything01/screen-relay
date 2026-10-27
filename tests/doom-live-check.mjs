import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdir,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {chromium} from "../../desktop-stream-bench/node_modules/playwright/index.mjs";
import {PNG} from "../../desktop-stream-bench/node_modules/pngjs/lib/png.js";
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
const container=process.env.TEST_CONTAINER,url=process.env.TEST_URL,label=process.env.TEST_LABEL;
if(!container||!url||!label||!/^[a-zA-Z0-9_-]+$/.test(label))throw Error("Set TEST_CONTAINER, TEST_URL and TEST_LABEL (letters, digits, underscore, hyphen)");
const here=path.dirname(fileURLToPath(import.meta.url)),dir=path.join(here,"results",`doom-${label}`);await mkdir(dir,{recursive:true});
const data={container,url,label,started:new Date().toISOString(),inputLatency:"unmeasured",notes:"drawn FPS counts decoded frames drawn to canvas, not physical presentation; container resources include game and desktop",errors:[],phases:{}};
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
let browser,page;
try {
 data.imageId=(await docker("inspect","--format","{{.Image}}",container)).trim();
 console.error("Waiting for game to settle");const ready=await snapshot();assert(Object.values(ready.processes).some(p=>p.name.includes("crispy-doom")),"crispy-doom process missing");await sleep(5000);
 console.error("Sampling no-viewer baseline");let a=await snapshot();await sleep(10000);let b=await snapshot();data.phases.noViewer={...calculate(a,b),start:a,end:b};await save();
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
 page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});await page.goto(url,{waitUntil:"domcontentloaded"});await page.waitForFunction(()=>window.nativeStats?.drawn>0,null,{timeout:30000});await sleep(5000);
 const canvas=page.locator("#screen");await canvas.focus();
 const initial=await canvas.screenshot({path:path.join(dir,"initial.png")});const image=PNG.sync.read(initial);let nonblack=0;for(let i=0;i<image.data.length;i+=4)if(image.data[i]>10||image.data[i+1]>10||image.data[i+2]>10)nonblack++;assert(nonblack>image.width*image.height*.01,"Canvas is black");
 const viewerStats=()=>page.evaluate(()=>({...window.nativeStats}));
 async function phase(name,ms,action){console.error(`Sampling ${name}`);const startStats=await viewerStats(),start=await snapshot();if(action)await action();await sleep(ms);const end=await snapshot(),endStats=await viewerStats();const seconds=end.t-start.t;const drawn=endStats.drawn-startStats.drawn;data.phases[name]={...calculate(start,end),start,end,startStats,endStats,drawn,drawnPerSecond:drawn/seconds,received:endStats.received-startStats.received};assert(drawn>0,`${name}: no frames drawn`);assert.equal(endStats.decodeerrors,0,`${name}: decode errors`);await save();}
 await phase("stationary",10000);
 await phase("liveInput",15000,async()=>{await page.keyboard.down("ArrowRight");await page.keyboard.down("Control");});
 await page.keyboard.up("Control");await page.keyboard.up("ArrowRight");
 const final=await canvas.screenshot({path:path.join(dir,"end.png")});const endImage=PNG.sync.read(final);assert.equal(endImage.width,image.width);assert.equal(endImage.height,image.height);assert(!image.data.equals(endImage.data),"Canvas did not change after live input");
 data.completed=new Date().toISOString();data.valid=true;
} catch(e){data.valid=false;data.errors.push(e.stack||String(e));process.exitCode=1;}
finally {if(page){try{await page.keyboard.up("Control");await page.keyboard.up("ArrowRight");}catch(e){data.errors.push(`release: ${e.message}`);data.valid=false;process.exitCode=1;}}if(browser)try{await browser.close();}catch(e){data.errors.push(`browser close: ${e.message}`);data.valid=false;process.exitCode=1;}await save();}
console.log(JSON.stringify({valid:data.valid,result:path.join(dir,"result.json"),errors:data.errors}));
