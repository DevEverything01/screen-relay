import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createServer as createTLSServer} from 'node:tls';
import {connect as connectTCP} from 'node:net';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import {capabilities, connect, screenshot, status} from '../../sdk/index.js';

// Run only against a disposable, explicitly selected SSH target.
const target = process.env.TEST_SSH_TARGET;
const remoteRoot = process.env.TEST_REMOTE_ROOT;
assert(target && remoteRoot, 'Set TEST_SSH_TARGET and TEST_REMOTE_ROOT to the installed source on a disposable Linux VM');
const ssh = process.env.TEST_SSH_CONFIG ? ['-F', process.env.TEST_SSH_CONFIG] : [];
const localPort = Number(process.env.TEST_LOCAL_PORT || 18211);
const remotePort = Number(process.env.TEST_REMOTE_PORT || 18111);
const output = process.env.TEST_OUTPUT || fileURLToPath(new URL('../results/portable/', import.meta.url));
mkdirSync(output, {recursive:true});
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const remote = (code, ...args) => execFileSync('ssh', [...ssh, target,
  ['python3', '-c', code, ...args].map(quote).join(' ')], {encoding:'utf8', timeout:40000});
const json = (code, ...args) => JSON.parse(remote(code, ...args));
const read = path => remote('import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text(),end="")', path);
const url = offset => `http://127.0.0.1:${localPort+offset}`;
const sessions = [], processes = [];
let browser, controller, tunnel, tunnelError = '';
const report = {started:new Date().toISOString(), target, checks:[]};

async function poll(fn, predicate = Boolean, timeout = 12000) {
  const end = Date.now()+timeout;
  let last;
  while(Date.now()<end) {
    try { last=await fn(); if(predicate(last)) return last; } catch(error) { last=error.message; }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Timed out: '+JSON.stringify(last));
}
async function check(name, fn) {
  const start=Date.now();
  try { const evidence=await fn(); report.checks.push({name,passed:true,ms:Date.now()-start,evidence}); }
  catch(error) { report.checks.push({name,passed:false,ms:Date.now()-start,error:error.stack}); throw error; }
}
function launch(port, extra = []) {
  const result=json(`import json,pathlib,subprocess,sys
p=subprocess.run([str(pathlib.Path.home()/'.local/bin/relay'),'up','-d','--json','--name','p'+sys.argv[1],'--port',sys.argv[1],*json.loads(sys.argv[2])],stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=38)
if p.returncode: raise RuntimeError(p.stderr)
print(p.stdout.strip().splitlines()[-1])`, String(port), JSON.stringify(extra));
  sessions.push(result);
  return result;
}
function down(session) {
  remote(`import pathlib,subprocess,sys
subprocess.run([str(pathlib.Path.home()/'.local/bin/relay'),'down','--name',sys.argv[1]],check=True,stdout=subprocess.DEVNULL)`, session.name);
}
function terminate(pid) {
  remote(`import os,signal,sys
try: os.kill(int(sys.argv[1]),signal.SIGTERM)
except ProcessLookupError: pass`, String(pid));
}
function activePids(session) {
  return json(`import json,pathlib,sys
found=[]
for path in pathlib.Path('/proc').glob('[0-9]*'):
 try:
  env=(path/'environ').read_bytes().split(b'\\0')
  cmd=(path/'cmdline').read_bytes()
  executable=pathlib.Path(cmd.split(b'\\0')[0].decode(errors='replace')).name
  if ('XAUTHORITY='+sys.argv[1]).encode() in env or (sys.argv[1].encode() in cmd and executable=='Xvfb'): found.append(int(path.name))
 except (OSError,PermissionError): pass
print(json.dumps(found))`, session.xauthority);
}
function pixel(bytes, expected) {
  const png=PNG.sync.read(Buffer.from(bytes));
  assert.equal(png.width,1280); assert.equal(png.height,720);
  const rgba=[...png.data.subarray((400*png.width+800)*4,(400*png.width+800)*4+4)];
  assert(expected.every((v,i)=>Math.abs(v-rgba[i])<3),JSON.stringify(rgba));
  return rgba;
}
function attach(session, port, extra=[]) {
  const data=json(`import json,os,pathlib,subprocess,sys,time
session=json.loads(sys.argv[1]); env=dict(os.environ,DISPLAY=session['display'],XAUTHORITY=session['xauthority'])
log=pathlib.Path(session['logs'])/('attached-'+sys.argv[2]+'-'+str(time.time_ns())+'.log')
with log.open('wb') as stream:
 p=subprocess.Popen([str(pathlib.Path.home()/'.local/bin/relay-engine'),'--port',sys.argv[2],*json.loads(sys.argv[3])],env=env,stdin=subprocess.DEVNULL,stdout=stream,stderr=stream,start_new_session=True)
print(json.dumps({'pid':p.pid,'log':str(log)}))`,JSON.stringify(session),String(port),JSON.stringify(extra));
  processes.push(data);
  return data;
}

try {
  report.environment=json(`import hashlib,json,os,pathlib,platform,shutil,subprocess,sys
root=pathlib.Path(sys.argv[1]); binary=pathlib.Path.home()/'.local/bin/relay-engine'
container=subprocess.run(['systemd-detect-virt','--container'],capture_output=True,text=True)
print(json.dumps({'kernel':platform.release(),'machine':platform.machine(),'osRelease':pathlib.Path('/etc/os-release').read_text(),'pid1':pathlib.Path('/proc/1/comm').read_text().strip(),'containerDetection':container.stdout.strip(),'containerDetectionExit':container.returncode,'dockerMarker':pathlib.Path('/.dockerenv').exists(),'dockerCli':shutil.which('docker'),'engineSha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'sourceSha256':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [root/'src/server/server.cpp',root/'scripts/relay',*sorted((root/'scripts/relaycli').glob('*.py')),root/'tests/integration/input_fixture.py']}}))`,remoteRoot);
  assert.equal(report.environment.dockerMarker,false);
  assert.notEqual(report.environment.containerDetectionExit,0,'Verification target is a container');
  for(const name of ['src/server/server.cpp','scripts/relay',...readdirSync(new URL('../../scripts/relaycli/',import.meta.url)).filter(n=>n.endsWith('.py')).sort().map(n=>'scripts/relaycli/'+n),'tests/integration/input_fixture.py'])
    assert.equal(report.environment.sourceSha256[name],createHash('sha256').update(readFileSync(new URL('../../'+name,import.meta.url))).digest('hex'),'Stale remote source: '+name);
  const forwards=Array.from({length:4},(_,i)=>['-L',`127.0.0.1:${localPort+i}:127.0.0.1:${remotePort+i}`]).flat();
  tunnel=spawn('ssh',[...ssh,'-S','none','-o','ControlMaster=no','-o','ExitOnForwardFailure=yes','-N',...forwards,target],{stdio:['ignore','ignore','pipe']});
  tunnel.stderr.on('data',data=>{tunnelError+=data;});
  await new Promise(resolve=>setTimeout(resolve,500));
  assert.equal(tunnel.exitCode,null,tunnelError);

  let first, second;
  await check('portable launcher creates an XFCE display and a separate bare display',async()=>{
    first=launch(remotePort);
    second=launch(remotePort+1,['--desktop','none']);
    assert.notEqual(first.display,second.display);
    assert.notEqual(first.xauthority,second.xauthority);
    const discovery=await poll(()=>capabilities({url:url(0)}));
    assert.equal(discovery.backend,'x11');
    assert.deepEqual([discovery.width,discovery.height],[1280,720]);
    await poll(()=>screenshot({url:url(1)}));
    const desktop=await poll(()=>remote(`import pathlib,sys
for p in pathlib.Path('/proc').glob('[0-9]*'):
 try:
  if ('XAUTHORITY='+sys.argv[1]).encode() in (p/'environ').read_bytes().split(b'\\0') and (p/'comm').read_text().strip()=='xfwm4': print('xfwm4')
 except OSError: pass`,first.xauthority),s=>s.includes('xfwm4'));
    const metrics=await status({url:url(0)});
    assert.equal(typeof metrics.frames_encoded,'number');
    return {first,second,windowManager:desktop.trim(),resourceCountersAvailable:metrics.usage_usec!==null};
  });
  await check('port conflict fails without claiming another engine or stopping its display',async()=>{
    const result=json(`import json,pathlib,subprocess,sys
p=subprocess.run([str(pathlib.Path.home()/'.local/bin/relay'),'up','--json','--name','conflict','--port',sys.argv[1],'--desktop','none'],capture_output=True,text=True,timeout=38)
print(json.dumps({'code':p.returncode,'stdout':p.stdout,'stderr':p.stderr}))`,String(remotePort));
    assert.notEqual(result.code,0);
    assert(!result.stdout.includes('"ready": true'));
    const {error}=JSON.parse(result.stderr.trim().split('\n').at(-1));
    assert.equal(error.component,'engine');
    await poll(()=>activePids({xauthority:error.logs+'/Xauthority'}),p=>p.length===0);
    await screenshot({url:url(0)});
    return {exitCode:result.code,cleanupVerified:true};
  });
  await check('direct engine attaches to an existing display and leaves it alive on exit',async()=>{
    const attached=attach(first,remotePort+3);
    await poll(()=>capabilities({url:url(3)}));
    assert.equal((await screenshot({url:url(3)})).subarray(1,4).toString(),'PNG');
    terminate(attached.pid);
    await poll(()=>read(attached.log),text=>text.includes('capture_stats'));
    await screenshot({url:url(0)});
    return {attachedPid:attached.pid,existingDisplayStillCapturable:true};
  });

  const fixtureState=first.logs+'/fixture.json';
  const fixture=json(`import json,os,pathlib,subprocess,sys
session=json.loads(sys.argv[1]); env=dict(os.environ,DISPLAY=session['display'],XAUTHORITY=session['xauthority'])
with open(session['logs']+'/fixture.log','wb') as stream:
 p=subprocess.Popen(['python3',sys.argv[2]+'/tests/integration/input_fixture.py',sys.argv[3]],env=env,stdin=subprocess.DEVNULL,stdout=stream,stderr=stream,start_new_session=True)
print(json.dumps({'pid':p.pid}))`,JSON.stringify(first),remoteRoot,fixtureState);
  processes.push(fixture);
  const state=()=>JSON.parse(read(fixtureState));
  await poll(state,s=>s.pid);
  await check('SDK screenshot and input reach a real X11 application outside Docker',async()=>{
    const before=pixel(await screenshot({url:url(0)}),[32,176,96]);
    controller=await connect({url:url(0)});
    await controller.input({type:'buttonDown',button:1,x:200/1279,y:130/719});
    await controller.input({type:'buttonUp',button:1,x:200/1279,y:130/719});
    await controller.input({type:'keyDown',key:4}); await controller.input({type:'keyUp',key:4});
    await poll(state,s=>s.entry==='a');
    await controller.input({type:'keyDown',key:225});
    await poll(state,s=>s.shift);
    controller.close(); controller=undefined;
    await poll(state,s=>!s.shift);
    remote('import os,signal,sys; os.kill(int(sys.argv[1]),signal.SIGUSR1)',String(fixture.pid));
    await poll(state,s=>s.changed);
    const after=await poll(async()=>pixel(await screenshot({url:url(0)}),[192,48,176]));
    return {before,after,entry:state().entry,heldKeyReleased:true};
  });
  browser=await chromium.launch({channel:'chrome',headless:true});
  await check('browser decodes moving native frames and keyboard input reaches the application',async()=>{
    const page=await browser.newPage(); await page.goto(url(0));
    await page.waitForFunction(()=>window.nativeStats?.drawn>0);
    const before=await page.evaluate(()=>nativeStats.drawn);
    remote('import os,signal,sys; os.kill(int(sys.argv[1]),signal.SIGUSR2)',String(fixture.pid));
    await page.waitForFunction(n=>nativeStats.drawn>n+3,before);
    await page.locator('#screen').click({position:{x:200,y:130}});
    await page.keyboard.press('b');
    await poll(state,s=>s.entry==='ab');
    const stats=await page.evaluate(()=>nativeStats);
    assert.equal(stats.decodeerrors,0);
    await page.screenshot({path:output+'/vm-stream.png'});
    await page.close();
    remote('import os,signal,sys; os.kill(int(sys.argv[1]),signal.SIGUSR2)',String(fixture.pid));
    return {drawn:stats.drawn,decodeerrors:stats.decodeerrors,entry:state().entry};
  });
  await browser.close(); browser=undefined;

  let tls;
  await check('public listener rejects missing security configuration before starting',async()=>{
    const result=json(`import json,pathlib,subprocess
p=subprocess.run([str(pathlib.Path.home()/'.local/bin/relay-engine'),'--bind','0.0.0.0'],capture_output=True,text=True)
print(json.dumps({'code':p.returncode,'stderr':p.stderr}))`);
    assert.equal(result.code,2); assert.match(result.stderr,/requires a token/);
    return {exitCode:result.code};
  });
  await check('TLS SDK authentication, WSS input and denied credentials work against the native server',async()=>{
    tls=json(`import base64,hashlib,json,pathlib,secrets,subprocess,sys
d=pathlib.Path(sys.argv[1])/'tls'; d.mkdir(mode=0o700)
token=d/'token'; token.write_text(secrets.token_hex(32)+chr(10)); token.chmod(0o600)
cert=d/'cert.pem'; key=d/'key.pem'
subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',str(key),'-out',str(cert),'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
pub=subprocess.check_output(['openssl','x509','-in',str(cert),'-pubkey','-noout'])
der=subprocess.check_output(['openssl','pkey','-pubin','-outform','DER'],input=pub)
print(json.dumps({'cert':str(cert),'key':str(key),'tokenFile':str(token),'spki':base64.b64encode(hashlib.sha256(der).digest()).decode()}))`,first.logs);
    const remoteURL=`https://localhost:${localPort+2}`;
    const attached=attach(first,remotePort+2,['--bind','0.0.0.0','--token-file',tls.tokenFile,
      '--public-origin',remoteURL,'--tls-cert',tls.cert,'--tls-key',tls.key]);
    await poll(()=>read(attached.log),text=>text.includes('"ready":true'));
    const certPath=output+'/test-certificate.pem';
    writeFileSync(certPath,read(tls.cert));
    tls.token=read(tls.tokenFile).trim(); tls.url=remoteURL;
    const code=`import assert from 'node:assert/strict';
import {capabilities,connect,screenshot} from ${JSON.stringify(new URL('../../sdk/index.js',import.meta.url).href)};
let input=''; for await(const chunk of process.stdin) input+=chunk;
const {url,token}=JSON.parse(input);
await assert.rejects(capabilities({url}),{code:'UNAUTHORIZED'});
await assert.rejects(capabilities({url,token:'0'.repeat(64)}),{code:'UNAUTHORIZED'});
await assert.rejects(connect({url,token:'0'.repeat(64),timeout:2000}));
const forbidden=await fetch(url+'/capabilities',{headers:{Authorization:'Bearer '+token,Origin:'https://evil.invalid'}});
assert.equal(forbidden.status,403);
const session=await connect({url,token});
const caps=await session.capabilities(); assert.equal(caps.backend,'x11');
await session.input({type:'buttonDown',button:1,x:200/1279,y:130/719});
await session.input({type:'buttonUp',button:1,x:200/1279,y:130/719});
await session.input({type:'keyDown',key:6}); await session.input({type:'keyUp',key:6});
const bytes=await session.screenshot(); assert.equal(bytes.subarray(1,4).toString(),'PNG');
session.close(); console.log(JSON.stringify({authenticated:true,wss:true,missingAndWrongTokenRejected:true,foreignOriginRejected:true,screenshotBytes:bytes.length}));`;
    const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code],{
      input:JSON.stringify({url:remoteURL,token:tls.token}),encoding:'utf8',timeout:20000,
      env:{...process.env,NODE_EXTRA_CA_CERTS:certPath}}));
    await poll(state,s=>s.entry==='abc');
    return {...result,entry:state().entry};
  });
  await check('authenticated HTTPS viewer decodes frames; an incorrect token cannot stream',async()=>{
    browser=await chromium.launch({channel:'chrome',headless:true,args:[`--ignore-certificate-errors-spki-list=${tls.spki}`]});
    const page=await browser.newPage(); await page.goto(tls.url);
    await page.locator('#access-token').fill('0'.repeat(64)); await page.locator('#reconnect').click();
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(()=>nativeStats.drawn),0);
    await page.locator('#access-token').fill(tls.token); await page.locator('#reconnect').click();
    await page.waitForFunction(()=>nativeStats.drawn>0);
    const color=await page.evaluate(()=>[...document.querySelector('#screen').getContext('2d').getImageData(800,400,1,1).data]);
    assert([192,48,176].every((v,i)=>Math.abs(v-color[i])<12));
    const stats=await page.evaluate(()=>nativeStats); assert.equal(stats.decodeerrors,0);
    // Never retain the credential in a screenshot, even in a password input.
    await page.locator('#access-token').fill('');
    await page.screenshot({path:output+'/vm-tls-stream.png'});
    await browser.close(); browser=undefined;
    return {drawn:stats.drawn,decodeerrors:stats.decodeerrors,pixel:color};
  });
  await check('the same engine streams through an external TLS terminator',async()=>{
    const publicURL=`https://localhost:${localPort+4}`;
    const attached=attach(first,remotePort+3,['--bind','0.0.0.0','--token-file',tls.tokenFile,
      '--public-origin',publicURL,'--behind-tls-proxy']);
    await poll(()=>read(attached.log),text=>text.includes('"ready":true'));
    const sockets=new Set();
    const proxy=createTLSServer({key:read(tls.key),cert:read(tls.cert),ALPNProtocols:['http/1.1']},client=>{
      const upstream=connectTCP({host:'127.0.0.1',port:localPort+3});
      sockets.add(client); sockets.add(upstream);
      client.on('error',()=>upstream.destroy()); upstream.on('error',()=>client.destroy());
      client.on('close',()=>{sockets.delete(client); upstream.destroy();});
      upstream.on('close',()=>{sockets.delete(upstream); client.destroy();});
      client.pipe(upstream).pipe(client);
    });
    proxy.listen(localPort+4,'127.0.0.1'); await once(proxy,'listening');
    try {
      browser=await chromium.launch({channel:'chrome',headless:true,args:[`--ignore-certificate-errors-spki-list=${tls.spki}`]});
      const page=await browser.newPage(); await page.goto(publicURL);
      await page.locator('#access-token').fill(tls.token); await page.locator('#reconnect').click();
      await page.waitForFunction(()=>nativeStats.drawn>0);
      const result=await page.evaluate(async token=>{
        const response=await fetch('/screenshot.png',{headers:{Authorization:'Bearer '+token}});
        return {status:response.status,type:response.headers.get('content-type'),bytes:(await response.arrayBuffer()).byteLength,drawn:nativeStats.drawn};
      },tls.token);
      assert.equal(result.status,200); assert.match(result.type,/image\/png/); assert(result.bytes>100);
      return result;
    } finally {
      await browser?.close(); browser=undefined;
      for(const socket of sockets) socket.destroy();
      await new Promise(resolve=>proxy.close(resolve));
      terminate(attached.pid);
    }
  });
  await check('stopping one managed display leaves the other session running',async()=>{
    down(second);
    await poll(()=>activePids(second),p=>p.length===0);
    pixel(await screenshot({url:url(0)}),[192,48,176]);
    return {stoppedDisplay:second.display,survivingDisplay:first.display};
  });
  report.passed=true;
} catch(error) { report.passed=false; report.error=error.stack; process.exitCode=1; }
finally {
  controller?.close(); await browser?.close();
  const cleanupErrors=[];
  for(const process of processes.toReversed()) try {terminate(process.pid);} catch(error) {cleanupErrors.push(error.message);}
  for(const session of sessions.toReversed()) {
    try {
      down(session);
      await poll(()=>activePids(session),p=>p.length===0);
      const logs=read(session.logs+'/engine.log');
      writeFileSync(output+`/engine-${session.pid}.log`,logs);
      assert(!/ERROR: (AddressSanitizer|LeakSanitizer)|runtime error:/.test(logs),logs);
      assert(logs.includes('capture_stats'),'Missing graceful engine shutdown');
    } catch(error) {cleanupErrors.push(error.message);}
  }
  for(const process of processes) if(process.log) try {
    const logs=read(process.log); writeFileSync(output+`/attached-${process.pid}.log`,logs);
    assert(!/ERROR: (AddressSanitizer|LeakSanitizer)|runtime error:/.test(logs),logs);
  } catch(error) {cleanupErrors.push(error.message);}
  tunnel?.kill('SIGTERM');
  report.cleanup={passed:cleanupErrors.length===0,errors:cleanupErrors};
  if(cleanupErrors.length) {report.passed=false; process.exitCode=1;}
  report.finished=new Date().toISOString();
  writeFileSync(output+'/verification.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
