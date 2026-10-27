import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {request} from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {connect, capabilities, snapshot} from '../sdk/index.js';

const container = process.env.TEST_CONTAINER;
assert(container, 'Set TEST_CONTAINER to a dedicated existing native container');
const url = process.env.TEST_URL || 'http://127.0.0.1:18094';
const output = fileURLToPath(new URL('./results/', import.meta.url));
mkdirSync(output, {recursive:true});
const tag = `/tmp/nsl-framework-${process.pid}-${Date.now()}`;
const docker = (...args) => execFileSync('docker', args, {encoding:'utf8', timeout:15000});
const state = () => JSON.parse(docker('exec', container, 'cat', tag+'.json'));
const report = {url, container, checks:[]};
let fixturePID, browser, controller;
async function poll(read, matches, timeout=8000) {
  const end = Date.now()+timeout;
  let last;
  while (Date.now()<end) {
    try {last=await read(); if(matches(last)) return last;} catch {}
    await new Promise(resolve=>setTimeout(resolve,80));
  }
  throw new Error(`Timed out: ${JSON.stringify(last)}`);
}
async function check(name, fn) {
  const started=Date.now();
  try {report.checks.push({name, passed:true, evidence:await fn(), ms:Date.now()-started});}
  catch(error) {report.checks.push({name, passed:false, error:error.stack}); throw error;}
}
async function http(path, headers={}) {
  return new Promise((resolve,reject)=>{
    const req=request(new URL(path,url), {headers}, response=>{
      const chunks=[];
      response.on('data',chunk=>chunks.push(chunk));
      response.on('end',()=>resolve({status:response.statusCode, headers:response.headers, bytes:Buffer.concat(chunks)}));
    });
    req.setTimeout(5000,()=>req.destroy(new Error('HTTP timeout')));
    req.on('error',reject); req.end();
  });
}
async function snapshotPixel(expected, bytes, decodePage) {
  if (!bytes) {
    const response=await http('/snapshot.png');
    assert.equal(response.status,200);
    assert.match(response.headers['content-type'],/^image\/png/);
    bytes=response.bytes;
  }
  assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  const page=decodePage || await browser.newPage();
  try {
    const pixel=await page.evaluate(async data=>{
      const image=new Image(); image.src='data:image/png;base64,'+data; await image.decode();
      const canvas=document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
      const ctx=canvas.getContext('2d'); ctx.drawImage(image,0,0);
      return {width:image.width,height:image.height,rgba:[...ctx.getImageData(800,400,1,1).data]};
    },bytes.toString('base64'));
    assert.equal(pixel.width,1280); assert.equal(pixel.height,720);
    assert(expected.every((value,i)=>Math.abs(value-pixel.rgba[i])<3),JSON.stringify(pixel));
    return pixel;
  } finally {if (!decodePage) await page.close();}
}
async function rawMalformed() {
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(url.replace(/^http/,'ws')+'/control','nsl1');
    socket.binaryType='arraybuffer'; let ready, generation;
    const statuses=[];
    const input=(sequence,key)=>{
      const b=Buffer.alloc(36); b.write('NSL1'); b[4]=1; b[5]=3;
      b.writeUInt32BE(generation,8); b.writeUInt32BE(sequence,12); b.writeUInt32BE(16,16);
      b[20]=1; b.writeUInt16BE(key,22); socket.send(b);
    };
    const timer=setTimeout(()=>{socket.close(); reject(new Error('Malformed control was not closed'));},3000);
    socket.onmessage=event=>{
      try {
      const b=Buffer.from(event.data);
      if (!ready) {
        assert.equal(b.toString('ascii',0,4),'NSL1'); assert.equal(b[4],1); assert.equal(b[5],4);
        assert.equal(b.length,24); assert.equal(b.readUInt32BE(12),0); assert.equal(b.readUInt32BE(16),4);
        assert(b.readUInt32BE(8)>0); assert.equal(b.readUInt16BE(20),1280); assert.equal(b.readUInt16BE(22),720);
        generation=b.readUInt32BE(8); ready=true; input(1,232);
      } else {
        assert.equal(b.length,21); assert.equal(b[5],5); assert.equal(b.readUInt32BE(8),generation);
        assert.equal(b.readUInt32BE(12),statuses.length+1); assert.equal(b.readUInt32BE(16),1);
        statuses.push(b[20]);
        if(statuses.length===1) {assert.equal(b[20],1); input(2,0);}
        else {assert.equal(b[20],2); socket.send(new Uint8Array(19));}
      }
      } catch(error) {clearTimeout(timer); socket.close(); reject(error);}
    };
    socket.onerror=()=>{};
    socket.onclose=event=>{clearTimeout(timer); resolve({ready,statuses,code:event.code});};
  });
}
try {
  docker('cp',fileURLToPath(new URL('./input_fixture.py',import.meta.url)),`${container}:${tag}.py`);
  docker('exec','-d','-e','DISPLAY=:1',container,'python3',tag+'.py',tag+'.json');
  fixturePID=(await poll(state,s=>s.pid)).pid;
  browser=await chromium.launch({channel:'chrome',headless:true});
  await check('discovery and fresh PNG work with no viewer or controller',async()=>{
    const discovery=await capabilities({url});
    assert.equal(discovery.version,1); assert.equal(discovery.backend,'x11');
    assert.equal(discovery.width,1280); assert.equal(discovery.height,720);
    assert.equal(discovery.snapshot,'/snapshot.png'); assert.equal(discovery.control,'/control');
    assert.deepEqual(discovery.input,{keyboard:true,pointer:true,buttons:true,wheel:true});
    assert.equal(discovery.wayland,false);
    const before=await snapshotPixel([32,176,96]);
    docker('exec',container,'kill','-USR1',String(fixturePID));
    await poll(state,s=>s.changed);
    const after=await poll(()=>snapshotPixel([192,48,176]),Boolean);
    return {discovery,before,after};
  });
  await check('SDK acknowledged input reaches native application and disconnect releases controls',async()=>{
    controller=await connect({url});
    assert.deepEqual(controller.surface,{width:1280,height:720});
    await controller.input({type:'buttonDown',button:1,x:200/1279,y:130/719});
    await controller.input({type:'buttonUp',button:1,x:200/1279,y:130/719});
    await poll(state,s=>s.xFocus===s.entryWindow);
    await controller.input({type:'keyDown',key:4}); await controller.input({type:'keyUp',key:4});
    await poll(state,s=>s.entry==='a');
    await assert.rejects(connect({url,timeout:2000}));
    const viewer=await browser.newPage(); await viewer.goto(url);
    await viewer.waitForTimeout(500);
    assert.equal(await viewer.evaluate(()=>window.nativeStats?.drawn||0),0,'Viewer acquired controller ownership');
    await viewer.close();
    await controller.input({type:'keyDown',key:225});
    await controller.input({type:'buttonDown',button:1,x:0.6,y:0.6});
    await poll(state,s=>s.shift&&s.button1);
    controller.close(); controller=undefined;
    const released=await poll(state,s=>!s.shift&&!s.button1);
    return {entry:released.entry,shift:released.shift,button1:released.button1};
  });
  await check('control ready envelope is real and malformed input releases ownership',async()=>{
    const result=await rawMalformed(); assert(result.ready); assert.deepEqual(result.statuses,[1,2]);
    controller=await poll(()=>connect({url,timeout:1000}),Boolean);
    controller.close(); controller=undefined; return result;
  });
  await check('Host and Origin validation reject HTTP access',async()=>{
    const badHost=await http('/capabilities',{Host:'untrusted.invalid'});
    const badOrigin=await http('/snapshot.png',{Origin:'https://untrusted.invalid'});
    const longOrigin=await http('/capabilities',{Origin:'https://'+('a'.repeat(256))+'.invalid'});
    assert(badHost.status>=400); assert(badOrigin.status>=400);
    assert(longOrigin.status>=400);
    return {host:badHost.status,origin:badOrigin.status,longOrigin:longOrigin.status};
  });
  await check('concurrent snapshots stay bounded and live viewer continues decoding',async()=>{
    const viewer=await browser.newPage(); await viewer.goto(url);
    await viewer.waitForFunction(()=>window.nativeStats?.drawn>0);
    await assert.rejects(connect({url,timeout:2000}));
    const before=await viewer.evaluate(()=>nativeStats.drawn);
    docker('exec',container,'kill','-USR2',String(fixturePID));
    try {
      await viewer.locator('canvas').focus(); await viewer.keyboard.down('Shift');
      await poll(state,s=>s.shift);
      const sdkPixel=await snapshotPixel([192,48,176],await snapshot({url}),viewer);
      assert(state().shift,'SDK snapshot disrupted the viewer control session');
      await viewer.keyboard.up('Shift'); await poll(state,s=>!s.shift);
      const responses=await Promise.all(Array.from({length:12},()=>http('/snapshot.png')));
      assert(responses.some(r=>r.status===200));
      for(const response of responses) assert([200,409,429,503].includes(response.status),String(response.status));
      await viewer.waitForFunction(previous=>nativeStats.drawn>previous+2&&nativeStats.decodeerrors===0,before);
      return {sdkPixel,statuses:responses.map(r=>r.status),stats:await viewer.evaluate(()=>nativeStats)};
    } finally {
      docker('exec',container,'kill','-USR2',String(fixturePID));
      await viewer.close();
    }
  });
  report.passed=true;
} catch(error) {report.passed=false; report.error=error.stack; process.exitCode=1;}
finally {
  controller?.close(); await browser?.close();
  if(fixturePID) try {docker('exec',container,'kill',String(fixturePID));} catch(error) {report.cleanupError=error.message; process.exitCode=1;}
  writeFileSync(output+'framework-integration.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
