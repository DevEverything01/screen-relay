import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {writeFile} from "node:fs/promises";

function rates(a,b) {
  const seconds=(b.time-a.time)/1000;
  if (!(seconds>0) || b.cpu<a.cpu || b.tx<a.tx || b.drawn<a.drawn || b.received<a.received) throw Error("Counters reset or invalid sampling interval");
  return {seconds,cpuPercent:(b.cpu-a.cpu)/1e6/seconds*100,memoryMiB:b.memory/1048576,mbps:(b.tx-a.tx)*8/seconds/1e6,drawnPerSecond:(b.drawn-a.drawn)/seconds,receivedPerSecond:(b.received-a.received)/seconds,decodeErrors:b.decodeerrors,outstanding:b.outstanding};
}
if(process.argv.includes("--self-check")) {
  const a={time:1000,cpu:100,tx:100,drawn:5,received:5}, b={time:2000,cpu:1000100,tx:125100,drawn:35,received:36,memory:1048576,decodeerrors:0,outstanding:1};
  assert.deepEqual(rates(a,b),{seconds:1,cpuPercent:100,memoryMiB:1,mbps:1,drawnPerSecond:30,receivedPerSecond:31,decodeErrors:0,outstanding:1});
  assert.throws(()=>rates(b,a));
  console.log("live metrics offline checks passed");process.exit(0);
}
const container=process.env.CONTAINER, cdp=process.env.CDP_URL, viewer=process.env.VIEWER_URL;
if(!container || !cdp || !viewer) throw Error("Set CONTAINER, CDP_URL and VIEWER_URL for the existing visible viewer");
const duration=Number(process.env.SECONDS || 60);
if(!Number.isInteger(duration)||duration<1||duration>3600) throw Error("SECONDS must be an integer from 1 to 3600");
const {chromium}=await import("playwright");
const browser=await chromium.connectOverCDP(cdp);
const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url()===viewer);
if(pages.length!==1) throw Error(`Expected exactly one existing viewer at ${viewer}; found ${pages.length}`);
const page=pages[0], exec=promisify(execFile);
const script=`import json,pathlib,time
p=pathlib.Path("/sys/fs/cgroup")
def pairs(n): return {a:int(b) for a,b in (s.split() for s in (p/n).read_text().splitlines())}
c=pairs("cpu.stat"); m=pairs("memory.stat"); n=pathlib.Path("/proc/net/dev").read_text().split("eth0:")[1].split()
print(json.dumps(dict(cpu=c["usage_usec"],memory=int((p/"memory.current").read_text())-m.get("inactive_file",0),tx=int(n[8]))))`;
const result={container,viewer,started:new Date().toISOString(),inputLatency:"unmeasured",notes:"drawn FPS counts WebCodecs decoded frames drawn to canvas, not physical display presentations; container CPU/memory/tx include desktop and game, exclude host browser and VM",samples:[],errors:[]};
const output=process.env.OUTPUT || `live-metrics-${Date.now()}.json`;
async function snapshot(){
  const start=Date.now();
  const [resource,stats]=await Promise.all([exec("docker",["exec",container,"python3","-c",script]),page.evaluate(()=>window.nativeStats ? {...window.nativeStats} : null)]);
  const time=(start+Date.now())/2;
  if(!stats || !["drawn","received","decodeerrors","outstanding"].every(k=>Number.isFinite(stats[k]))) throw Error("Existing viewer has no valid nativeStats");
  return {time,...JSON.parse(resource.stdout),...stats};
}
try {
  let previous=await snapshot();
  for(let i=0;i<duration;i++){
    await new Promise(r=>setTimeout(r,1000));
    const next=await snapshot(), sample=rates(previous,next);
    result.samples.push({time:new Date(next.time).toISOString(),...sample});
    console.log(JSON.stringify(result.samples.at(-1)));previous=next;
    await writeFile(output,JSON.stringify(result,null,2));
  }
  result.completed=new Date().toISOString();
} catch(e) {result.errors.push(e.stack || String(e));process.exitCode=1;}
finally {await writeFile(output,JSON.stringify(result,null,2));}
// Leave the user-owned browser and viewer open. End only this CDP client process.
process.exit(process.exitCode || 0);
