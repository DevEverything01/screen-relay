import {PNG} from "../../desktop-stream-bench/node_modules/pngjs/lib/png.js";
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const markers = [[24,540],[1144,700]];
function identity(png) {
  if (png.width !== 1280 || png.height !== 720) throw Error("Motion quality requires native 1280x720 pixels");
  const ids = markers.map(([x,y]) => {
    const cells = Array.from({length:14}, (_, bit) => {
      const offset = ((y+6)*1280+x+bit*8+4)*4;
      const rgb = [...png.data.subarray(offset,offset+3)];
      if (Math.max(...rgb)-Math.min(...rgb)>60) return null;
      const mean = rgb.reduce((a,b)=>a+b,0)/3;
      return mean < 80 ? 0 : mean > 175 ? 1 : null;
    });
    return cells[0] !== 0 || cells[1] !== 1 || cells.includes(null) ? null :
      cells.slice(2).reduce((value,bit,index)=>value | bit<<index,0);
  });
  return {id:ids.every(id=>id!==null) && ids[0]===ids[1] ? ids[0] : null,
    reason:ids.includes(null) ? "invalidMarker" : ids[0]!==ids[1] ? "markerDisagreement" : null};
}
function score(source, decoded) {
  if (source.width!==decoded.width || source.height!==decoded.height || source.width!==1280 || source.height!==720)
    throw Error("Motion quality geometry mismatch");
  let squared=0, absolute=0, pixels=0;
  const channelError=[0,0,0];
  for(let y=0;y<720;y++) for(let x=0;x<1280;x++) {
    // Cursor is parked at (10,700); use the same declared exclusion for every engine.
    if(x<48 && y>=680) continue;
    const i=(y*1280+x)*4;
    for(let c=0;c<3;c++) {
      const error=Math.abs(source.data[i+c]-decoded.data[i+c]);
      squared+=error*error; absolute+=error; channelError[c]+=error;
    }
    pixels++;
  }
  return {psnrDb:squared ? 10*Math.log10(255**2/(squared/(pixels*3))) : "Infinity",
    meanAbsoluteError:absolute/(pixels*3), channelMeanAbsoluteError:channelError.map(n=>n/pixels),pixels};
}
function matchedScore(source, decoded) {
  const a=identity(source),b=identity(decoded);
  if(a.id===null || b.id===null || a.id!==b.id) throw Error("Unmatched or inconsistent frame identity");
  return score(source,decoded);
}

export async function measureMotionQuality({page,container,directory,docker,seconds=15}) {
  if(!Number.isFinite(seconds) || seconds<=0 || seconds>30) throw Error("Motion quality duration must be 0..30 seconds");
  const status=async()=>JSON.parse((await docker("exec",container,"cat","/tmp/bench-status.json")).stdout);
  const before=await status();
  if(before.frozen || !before.fps_marker || before.mode!=="video") throw Error("Motion quality requires running video fps workload");
  await page.mouse.move(10,700);
  await page.evaluate(()=>{
    const s=window.surface;
    if(!s || (s.videoWidth || s.width)!==1280 || (s.videoHeight || s.height)!==720 ||
      s.getBoundingClientRect().width!==1280 || s.getBoundingClientRect().height!==720 || devicePixelRatio!==1)
      throw Error("Motion quality surface geometry mismatch");
  });
  const result={scope:"continuous synthetic motion; exact X11/browser marker matching",seconds,maxPairs:60,
    samplingTargetMs:100,cursorExcluded:{x:0,y:680,width:48,height:40},before,pairs:[],errors:[],
    source:{samples:0,unique:0,duplicates:0,invalidMarker:0,markerDisagreement:0,evicted:0,stale:0},
    decoded:{samples:0,unique:0,duplicates:0,invalidMarker:0,markerDisagreement:0,evicted:0,stale:0}};
  const stores={source:new Map(),decoded:new Map()}, seen={source:new Map(),decoded:new Map()};
  const start=performance.now(),deadline=start+seconds*1000;
  // Producer delta below proves the 12-bit ID cannot repeat within this epoch.
  function ingest(kind,buffer) {
    const stats=result[kind],png=PNG.sync.read(buffer),decoded=identity(png),t=performance.now()-start;
    stats.samples++;
    if(decoded.id===null){stats[decoded.reason]++;return;}
    const id=decoded.id;
    const digest=createHash("sha256").update(png.data).digest("hex");
    if(seen[kind].has(id)){
      stats.duplicates++;
      if(seen[kind].get(id).digest!==digest) {
        stats.changedSameId=(stats.changedSameId||0)+1;
        if(kind==="source" && !result.errors.includes("Source pixels changed under one frame ID"))
          result.errors.push("Source pixels changed under one frame ID");
      }
      return;
    }
    const previous=[...seen[kind].keys()].at(-1);
    if(previous!==undefined && (id-previous+4096)%4096>=2048){stats.stale++;return;}
    seen[kind].set(id,{t,digest});stats.unique++;
    stores[kind].set(id,{buffer,t});
    if(stores[kind].size>60){stores[kind].delete(stores[kind].keys().next().value);stats.evicted++;}
  }
  async function pair() {
    for(const [id,a] of stores.source) {
      const b=stores.decoded.get(id);
      if(!b || result.pairs.length>=60) continue;
      const quality=matchedScore(PNG.sync.read(a.buffer),PNG.sync.read(b.buffer));
      const stem=`motion-${String(result.pairs.length).padStart(2,"0")}-id${id}`;
      await writeFile(path.join(directory,`${stem}-source.png`),a.buffer);
      await writeFile(path.join(directory,`${stem}-decoded.png`),b.buffer);
      result.pairs.push({id,sourceSampleMs:a.t,decodedSampleMs:b.t,...quality,stem});
      stores.source.delete(id);stores.decoded.delete(id);
    }
  }
  const scratch=path.join(directory,"motion-source-latest.png");
  async function capture(kind) {
    try {
      while(performance.now()<deadline && result.pairs.length<60) {
        const began=performance.now();
        let buffer;
        if(kind==="source") {
          await docker("exec","-u","bench",container,"scrot","-o","/tmp/motion-source.png");
          await docker("cp",`${container}:/tmp/motion-source.png`,scratch);
          buffer=await readFile(scratch);
        } else {
          buffer=Buffer.from(await page.evaluate(()=>{
            const c=document.createElement("canvas");c.width=1280;c.height=720;
            c.getContext("2d").drawImage(window.surface,0,0);
            return c.toDataURL("image/png").split(",")[1];
          }),"base64");
        }
        ingest(kind,buffer);
        await sleep(Math.max(0,100-(performance.now()-began)));
      }
    } catch(error){result.errors.push(`${kind}: ${error.message}`);}
  }
  // Separate producers sample independently; pairing stays serialized to avoid duplicate writes.
  let capturing=true;
  const captures=Promise.all([capture("source"),capture("decoded")]).finally(()=>{capturing=false;});
  while(capturing){await pair();await sleep(30);}
  await captures;await pair();
  result.after=await status();result.elapsedSeconds=(performance.now()-start)/1000;
  const delta=result.after.frame-before.frame;
  result.producerFrames=delta;
  result.producerUpdatesPerSecond=delta/((result.after.time_ns-before.time_ns)/1e9);
  if(delta<=0 || delta>=2048 || result.after.frozen || result.after.mode!==before.mode || !result.after.fps_marker ||
    result.after.toggles!==before.toggles) result.errors.push("Producer epoch changed, froze, or exceeded unambiguous ID range");
  for(const kind of ["source","decoded"]) {
    result[kind].invalidFraction=(result[kind].invalidMarker+result[kind].markerDisagreement)/Math.max(1,result[kind].samples);
    result[kind].unmatchedIds=[...seen[kind].keys()].filter(id=>!result.pairs.some(pair=>pair.id===id));
    result[kind].matchedFraction=result.pairs.length/Math.max(1,result[kind].unique);
    result[kind].observedIds=[...seen[kind]].map(([id,{t}])=>({id,sampleMs:t}));
  }
  if(result.pairs.length<10)result.errors.push("Insufficient matched-frame evidence: fewer than 10 unique pairs");
  if(result.pairs.length) {
    const psnr=result.pairs.map(p=>p.psnrDb==="Infinity"?Infinity:p.psnrDb).sort((a,b)=>a-b);
    const mae=result.pairs.map(p=>p.meanAbsoluteError).sort((a,b)=>a-b);
    const finite=value=>Number.isFinite(value)?value:"Infinity";
    result.summary={medianPsnrDb:finite(psnr[Math.floor(psnr.length*.5)]),
      worstDecilePsnrDb:finite(psnr[Math.floor((psnr.length-1)*.1)]),
      medianMeanAbsoluteError:mae[Math.floor(mae.length*.5)],p90MeanAbsoluteError:mae[Math.ceil(mae.length*.9)-1]};
  }
  result.valid=result.errors.length===0;
  result.limits="Sparse instrumented fidelity pass, not full-rate perceptual quality or proof of interior atomicity; resource metrics belong to a separate pass. Match coverage and delivery must accompany quality. No quality pass threshold.";
  await writeFile(path.join(directory,"motion-quality.json"),JSON.stringify(result,null,2));
  return result;
}

if(process.argv.includes("--self-check") && process.argv[1]===fileURLToPath(import.meta.url)) {
  const image=(id,color=0)=>{
    const p=new PNG({width:1280,height:720});p.data.fill(color);
    for(let i=3;i<p.data.length;i+=4)p.data[i]=255;
    for(const [x,y]of markers)for(let bit=0;bit<14;bit++){
      const value=(bit===1 || bit>=2 && ((id>>(bit-2))&1))?255:0;
      const offset=((y+6)*1280+x+bit*8+4)*4;
      p.data.fill(value,offset,offset+3);
    }
    return p;
  };
  const a=image(7),b=image(7);
  assert.equal(matchedScore(a,b).psnrDb,"Infinity");
  b.data[0]=3;
  const scored=matchedScore(a,b);
  assert.equal(scored.meanAbsoluteError,3/(scored.pixels*3));
  assert.equal(scored.psnrDb,10*Math.log10(255**2/(9/(scored.pixels*3))));
  assert.throws(()=>matchedScore(a,image(8)),/identity/);
  assert.throws(()=>matchedScore(image(4095),image(0)),/identity/);
  const inconsistent=image(7);const [x,y]=markers[1];
  // Flip an actually set ID bit to create a top/bottom contradiction.
  inconsistent.data.fill(0,((y+6)*1280+x+2*8+4)*4,((y+6)*1280+x+2*8+4)*4+3);
  assert.equal(identity(inconsistent).reason,"markerDisagreement");
  assert.throws(()=>matchedScore(a,inconsistent),/identity/);
  assert.throws(()=>identity(new PNG({width:1,height:1})),/1280/);
  console.log("motion-quality scorer self-check passed");
}
