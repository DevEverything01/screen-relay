import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdir,readFile,writeFile,readdir,lstat,readlink,realpath} from "node:fs/promises";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {chromium} from "playwright";
import {PNG} from "pngjs";
const exec=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hash=b=>createHash("sha256").update(b).digest("hex");
function quality(a,b){assert.equal(a.width,b.width);assert.equal(a.height,b.height);assert.equal(a.data.length,b.data.length);let absolute=0,squared=0,n=0;for(let i=0;i<a.data.length;i+=4)for(let c=0;c<3;c++){const d=a.data[i+c]-b.data[i+c];absolute+=Math.abs(d);squared+=d*d;n++;}return {meanAbsoluteError:absolute/n,psnrDb:squared?10*Math.log10(255**2/(squared/n)):null,identical:squared===0};}
const fileListROI={x:250,y:180,width:900,height:400};
const correspondenceLimits={maximumCurrentMAE:25,minimumNativeChangeMAE:.1,minimumRelativeImprovement:.05};
function fileList(image){assert.equal(image.width,1280);assert.equal(image.height,720);const {x,y,width,height}=fileListROI,data=Buffer.alloc(width*height*4);for(let row=0;row<height;row++)image.data.copy(data,row*width*4,((y+row)*1280+x)*4,((y+row)*1280+x+width)*4);return {width,height,data};}
function correspondence(current,decoded,previous){const result={currentMAE:quality(current,decoded).meanAbsoluteError};if(previous){result.nativeChangeMAE=quality(current,previous).meanAbsoluteError;result.previousMAE=quality(previous,decoded).meanAbsoluteError;}return result;}
function validateCorrespondence(result){assert(result.currentMAE<=correspondenceLimits.maximumCurrentMAE,"Decoded file list does not recognizably match native content");if(result.nativeChangeMAE>=correspondenceLimits.minimumNativeChangeMAE)assert(result.currentMAE<=result.previousMAE*(1-correspondenceLimits.minimumRelativeImprovement)&&result.currentMAE<result.previousMAE,"Decoded file list did not follow changed native content");}
function resources(a,b){const seconds=b.t-a.t;assert(seconds>0&&b.cpu>=a.cpu&&b.tx>=a.tx);return {seconds,cpuPercent:(b.cpu-a.cpu)/1e6/seconds*100,memoryMiB:b.memory/1048576,mbps:(b.tx-a.tx)*8/seconds/1e6};}
if(process.argv.includes("--self-check")){const a={width:1,height:1,data:Buffer.from([0,0,0,255])},b={width:1,height:1,data:Buffer.from([10,10,10,255])};assert.equal(quality(a,b).meanAbsoluteError,10);assert.equal(quality(a,a).identical,true);assert(Math.abs(quality(a,b).psnrDb-28.1308)<.001);assert.equal(resources({t:1,cpu:0,tx:0},{t:2,cpu:1e6,tx:125000,memory:1048576}).mbps,1);assert.throws(()=>resources({t:2},{t:1}));const old={width:1,height:1,data:Buffer.from([100,100,100,255])};validateCorrespondence(correspondence(b,b,a));assert.throws(()=>validateCorrespondence(correspondence(b,a,a)),/follow/);assert.throws(()=>validateCorrespondence(correspondence(a,old)),/recognizably/);validateCorrespondence(correspondence(a,a,a));console.log("application scoring checks passed");process.exit(0);}
const engine=process.argv[2];assert(["native","selkies","kasm"].includes(engine),"Pass native|selkies|kasm");
const here=path.dirname(fileURLToPath(import.meta.url)),dir=path.join(here,"results",`applications-${engine}-${Date.now()}`);await mkdir(dir,{recursive:true});
const image=engine==="native"?"native-stream-lab:general3":"sha256:aa2b9fe4228860fcae86829b1c609139f956f934236bbebdd50bcf143d356712";
const documents=process.env.APP_DOCUMENTS;assert(documents&&path.isAbsolute(documents),"APP_DOCUMENTS must be an absolute frozen directory with doc/icons/fonts children");
for(const child of ["doc","icons","fonts"])assert((await lstat(path.join(documents,child))).isDirectory(),`Missing APP_DOCUMENTS/${child}`);
async function manifest(root,relative="") {const entries=[];for(const name of (await readdir(path.join(root,relative))).sort()){const file=path.join(relative,name),stat=await lstat(path.join(root,file));if(stat.isDirectory()){entries.push({path:file,type:"directory"});entries.push(...await manifest(root,file));}else if(stat.isSymbolicLink()){const target=await readlink(path.join(root,file)),resolved=await realpath(path.join(root,file)),inside=path.relative(await realpath(root),resolved);assert(!path.isAbsolute(target)&&inside!==".."&&!inside.startsWith(`..${path.sep}`)&&!path.isAbsolute(inside),`External dataset symlink: ${file}`);entries.push({path:file,type:"symlink",target});}else if(stat.isFile())entries.push({path:file,type:"file",bytes:stat.size,sha256:hash(await readFile(path.join(root,file)))});else throw Error(`Unsupported dataset entry: ${file}`);}return entries;}
const documentManifest=await manifest(documents);
const container=`qualification-app-${engine}-${process.pid}`,url="http://127.0.0.1:18100";
const data={engine,image,container,url,started:new Date().toISOString(),inputLatency:"unmeasured",producerRate:"unmeasured",errors:[],browserErrors:[],navigation:[],evidence:[],fileListROI,correspondenceLimits,notes:"Real Thunar file navigation and scroll. Sampled visual change frequency is not FPS; settled fidelity compares each engine against its own actual X11 desktop."};
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

let browser,page,created=false;
try{
 data.documents={source:documents,destination:"/opt/qualification-documents",manifest:documentManifest,manifestSha256:hash(JSON.stringify(documentManifest))};
 data.runnerSha256=hash(await readFile(fileURLToPath(import.meta.url)));
 const envFile=path.resolve(here,"../../desktop-stream-bench/.env"),envText=await readFile(envFile,"utf8"),password=envText.match(/^BENCH_PASSWORD=(.*)$/m)?.[1]?.replace(/^['"]|['"]$/g,"");assert(password,"Missing BENCH_PASSWORD");
 await docker("create","--name",container,"--cpus","2","--memory","1536m","--memory-swap","1536m","--shm-size","512m","--env-file",envFile,"--env",`SELKIES_ALLOWED_ORIGINS=${url}`,"-p","127.0.0.1:18100:8080",image,engine);created=true;await docker("cp",documents,`${container}:/opt/qualification-documents`);await docker("start",container);
 data.copiedManifest=JSON.parse(await docker("exec",container,"python3","-c",`import json,pathlib,hashlib
root=pathlib.Path('/opt/qualification-documents')
entries=[]
for p in sorted(root.rglob('*'),key=lambda p:str(p.relative_to(root))):
 rel=str(p.relative_to(root))
 if p.is_symlink(): entries.append(dict(path=rel,type='symlink',target=str(p.readlink())))
 elif p.is_dir(): entries.append(dict(path=rel,type='directory'))
 elif p.is_file(): entries.append(dict(path=rel,type='file',bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
print(json.dumps(entries))`));
 assert.deepEqual([...data.copiedManifest].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),[...documentManifest].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),"Copied application dataset differs from source manifest");
 data.imageId=(await docker("inspect","--format","{{.Image}}",container)).trim();
 for(let i=0;i<40;i++){try{await docker("exec",container,"xdpyinfo");break;}catch(e){if(i===39)throw e;await sleep(500);}}
 await sleep(5000);
 data.provenance=JSON.parse(await docker("exec",container,"python3","-c",`import json,pathlib,subprocess
roots=['/opt/qualification-documents/doc','/opt/qualification-documents/icons','/opt/qualification-documents/fonts']
print(json.dumps(dict(directories={p:sorted(x.name for x in pathlib.Path(p).iterdir()) for p in roots},packages=subprocess.check_output(['dpkg-query','-W','thunar','fonts-dejavu-core','adwaita-icon-theme']).decode())))`));
 await docker("exec","-d",container,"thunar","/opt/qualification-documents/doc");
 for(let attempt=0;attempt<40;attempt++){try{const windows=(await docker("exec",container,"xdotool","search","--onlyvisible","--class","Thunar")).trim().split("\n");data.windowId=windows.at(-1);if(/^\d+$/.test(data.windowId))break;}catch{}await sleep(250);}assert(/^\d+$/.test(data.windowId||""),"Thunar did not expose a visible window within readiness deadline");
 await docker("exec",container,"xdotool","windowactivate","--sync",data.windowId,"windowmove",data.windowId,"20","40","windowsize",data.windowId,"1200","640");
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
 page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1,httpCredentials:{username:"bench",password}});page.on("pageerror",e=>data.browserErrors.push(e.message));
 for(let i=0;i<30;i++){try{await page.goto(url,{waitUntil:"domcontentloaded"});break;}catch(e){if(i===29)throw e;await sleep(500);}}
 await page.waitForFunction(()=>[...document.querySelectorAll("canvas,video")].some(e=>e.getBoundingClientRect().width===1280&&e.getBoundingClientRect().height===720),null,{timeout:30000});await sleep(5000);
 if(engine==="kasm"){
  data.clientSettings=await page.evaluate(()=>{
   const ids=["video_quality","framerate_image_mode","framerate_streaming_mode","stream_mode","dynamic_quality_min","dynamic_quality_max","treat_lossless","jpeg_video_quality","webp_video_quality"];
   const snapshot=()=>Object.fromEntries(ids.map(id=>[id,document.getElementById(`noVNC_setting_${id}`).value]));const before=snapshot();
   for(const [id,value] of [["video_quality","10"],["framerate_image_mode","60"]]){const f=document.getElementById(`noVNC_setting_${id}`);f.value=value;f.dispatchEvent(new Event("change",{bubbles:true}));}return {before,after:snapshot()};
  });
  assert.equal(data.clientSettings.after.framerate_image_mode,"60");assert.equal(data.clientSettings.after.framerate_streaming_mode,"60");
  for(const id of ["stream_mode","dynamic_quality_min","dynamic_quality_max","treat_lossless","jpeg_video_quality","webp_video_quality"])assert.equal(data.clientSettings.before[id],data.clientSettings.after[id]);
 }

 await page.evaluate(()=>{window.appSurface=[...document.querySelectorAll("canvas,video")].find(e=>e.getBoundingClientRect().width===1280&&e.getBoundingClientRect().height===720);appSurface.setAttribute("tabindex","0");appSurface.focus();const c=document.createElement("canvas");c.width=160;c.height=90;window.appProbe=c.getContext("2d",{willReadFrequently:true});window.appPixel=()=>{appProbe.drawImage(appSurface,0,0,160,90);const d=appProbe.getImageData(0,0,160,90).data;let h=2166136261,lit=0;for(let i=0;i<d.length;i+=4){if(d[i]>10||d[i+1]>10||d[i+2]>10)lit++;for(let j=0;j<3;j++)h=Math.imul(h^d[i+j],16777619);}return {hash:h>>>0,nonblack:lit/14400};};});
 await page.mouse.move(600,400);
 let previousNativeROI;
 async function evidence(label){
  await sleep(1500);const title=(await docker("exec",container,"xdotool","getwindowname",data.windowId)).trim(),focus=(await docker("exec",container,"xdotool","getactivewindow")).trim();assert.equal(focus,data.windowId,"Thunar lost native focus");
  await docker("exec",container,"scrot","-o","/tmp/application-source.png");await docker("cp",`${container}:/tmp/application-source.png`,path.join(dir,`${label}-source.png`));
  const decoded=Buffer.from(await page.evaluate(()=>{const c=document.createElement("canvas");c.width=1280;c.height=720;c.getContext("2d").drawImage(appSurface,0,0,1280,720);return c.toDataURL().split(",")[1];}),"base64");await writeFile(path.join(dir,`${label}-decoded.png`),decoded);await page.screenshot({path:path.join(dir,`${label}-viewer.png`)});
  const source=await readFile(path.join(dir,`${label}-source.png`)),nativeImage=PNG.sync.read(source),decodedImage=PNG.sync.read(decoded),nativeROI=fileList(nativeImage);
  const item={label,title,focus,sourceSha256:hash(source),decodedSha256:hash(decoded),quality:quality(nativeImage,decodedImage),correspondence:correspondence(nativeROI,fileList(decodedImage),previousNativeROI),pixels:await page.evaluate(()=>appPixel())};
  data.evidence.push(item);validateCorrespondence(item.correspondence);previousNativeROI=nativeROI;return item;
 }
 data.initial=await evidence("initial");assert(data.initial.title.includes("doc"),"Thunar did not open doc directory");assert(data.initial.pixels.nonblack>.01,"Black desktop");
 for(const [index,folder] of ["/opt/qualification-documents/icons","/opt/qualification-documents/fonts","/opt/qualification-documents/doc"].entries()){
  await page.keyboard.press("Control+l");await page.keyboard.type(folder,{delay:15});await page.keyboard.press("Enter");await sleep(1500);
  const item={folder,...await evidence(`navigate-${index}`)};assert(item.title.includes(path.basename(folder)),`Native title did not confirm ${folder}`);data.navigation.push(item);await save();
 }
 await page.keyboard.press("Control+2");await page.keyboard.press("Home");await sleep(1000);data.scrollBefore=await evidence("scroll-before");
 await page.evaluate(()=>{window.appObservation={start:performance.now(),samples:[]};window.appSampling=true;function step(){try{appObservation.samples.push({t:performance.now(),...appPixel()});}catch(e){appObservation.error=e.message;appSampling=false;}if(appSampling)requestAnimationFrame(step);}requestAnimationFrame(step);});
 const start=await snapshot();
 data.workload={phase:"scroll",steps:90,stepIntervalMs:250,wheelPixels:240,direction:"down/up alternating each 10 steps; final block down",instrumentation:"rAF sampling and cgroup endpoints only; navigation and screenshot/scrot/copy outside measured interval"};
 for(let i=0;i<90;i++){await page.mouse.wheel(0,Math.floor(i/10)%2===0?240:-240);await sleep(250);}
 const end=await snapshot();await page.evaluate(()=>{appSampling=false;appObservation.end=performance.now();});data.observed=await page.evaluate(()=>appObservation);assert(!data.observed.error,data.observed.error);assert(data.observed.samples.length>0&&data.observed.samples.every(s=>s.nonblack>.01),"Missing or black pixel samples");
 data.scrollAfter=await evidence("scroll-after");assert(data.scrollAfter.correspondence.nativeChangeMAE>=correspondenceLimits.minimumNativeChangeMAE,"Actual native Thunar file list did not meaningfully scroll");
 let changes=0;for(let i=1;i<data.observed.samples.length;i++)if(data.observed.samples[i].hash!==data.observed.samples[i-1].hash)changes++;assert(changes>0);data.resources={...resources(start,end),start,end};data.visibleChanges={count:changes,perSecond:changes/((data.observed.end-data.observed.start)/1000)};
 data.phases={desktop:{...data.resources,usefulVisualChangesPerSecond:data.visibleChanges.perSecond,frozenQuality:data.scrollAfter.quality,qualitySamples:{initial:data.initial.quality,scrollBefore:data.scrollBefore.quality,navigation:data.navigation.map(n=>({folder:n.folder,...n.quality}))}}};
 data.decoderErrors=await page.evaluate(()=>({native:window.nativeStats?.decodeerrors??null,video:[...document.querySelectorAll("video")].map(v=>v.error?.code??null)}));assert(!data.decoderErrors.native&&data.decoderErrors.video.every(e=>e===null),"Decoder failure");data.valid=true;data.completed=new Date().toISOString();
}catch(e){data.valid=false;data.errors.push(e.stack||String(e));process.exitCode=1;}
finally{if(page)for(const k of ["Control","Shift","Alt"])try{await page.keyboard.up(k);}catch(e){data.errors.push(e.message);}if(browser)try{await browser.close();}catch(e){data.valid=false;data.errors.push(`browser close: ${e.message}`);process.exitCode=1;}if(created)try{await writeFile(path.join(dir,"container.log"),await docker("logs",container));await docker("stop","-t","3",container);}catch(e){data.valid=false;data.errors.push(e.message);process.exitCode=1;}await save();}
console.log(JSON.stringify({valid:data.valid,result:path.join(dir,"result.json"),errors:data.errors}));
