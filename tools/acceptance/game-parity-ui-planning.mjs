import { chromium } from 'file:///C:/Users/Veky/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
const origin='http://127.0.0.1:18099';
const prior=JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/ui-browser.json'));
const setups=prior.checks.filter(x=>x.label.startsWith('setup-'));
const allowed=new Set(setups.map(x=>origin+'/api/client/game-library/templates/'+x.route.split('/').pop()+'/ports'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files=['internal/panel/game_install_ports.go','internal/panel/game_port_network.go','internal/panel/game_port_reservations.go','internal/panel/game_templates.go','internal/panel/game_library.go','internal/panel/steam_games.go'];
const report={captured_at:new Date().toISOString(),origin,allowed_post_urls:[...allowed],requests:[],api:[],checks:[],errors:[],product_findings:[],guard_errors:[],source_hashes:Object.fromEntries(files.map(p=>[p,sha(p)])),backend:{pid:52408,path:'.local/game-parity-20261029/runtime/panel-frozen.exe',sha256:sha('.local/game-parity-20261029/runtime/panel-frozen.exe'),new_build:JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/frozen-build.json')),boundary:'Old running backend only; current discovery/parsers not attributed to this binary.'},route_audit:{handlers:'game_install_ports.go:420-525',planning:'game_install_ports.go:313-362',reads:'SELECT settings and allocations; node lookup; optional transient node network bind probe',writes:'No provisionGamePorts, createServer, forwarding, install or power calls from these handlers'},mutations:'No create, install, power, settings, users, credentials, restart, download or asset publication.'};
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const pending=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 await page.route('**/*',route=>{const req=route.request(),u=new URL(req.url());const ok=u.origin===origin&&(['GET','HEAD'].includes(req.method())||(req.method()==='POST'&&allowed.has(req.url())));report.requests.push({url:req.url(),method:req.method(),decision:ok?'allow':'block',body:req.method()==='POST'&&ok?req.postData():undefined});if(!ok)report.guard_errors.push({url:req.url(),method:req.method(),reason:'outside exact read-only allowlist'});return ok?route.continue():route.abort();});
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('response',r=>{if(r.url().includes('/api/'))pending.push((async()=>{const a={url:r.url(),method:r.request().method(),status:r.status()};if(allowed.has(r.url()))a.body=await r.text();report.api.push(a);})());});
 for(const setup of setups){
  await page.goto(origin+setup.route);await page.waitForTimeout(12500);
  const dom=await page.locator('body').innerText();
  const fields=await page.locator('input,select,textarea').evaluateAll(es=>es.map(e=>({tag:e.tagName,id:e.id,type:e.type,required:e.required,disabled:e.disabled,value:e.type==='password'?'[redacted]':e.value,valid:e.validity.valid,validationMessage:e.validationMessage,min:e.min,max:e.max,step:e.step,labels:[...(e.labels||[])].map(l=>l.innerText)})));
  const check={route:setup.route,dom,fields,invalid_fields:fields.filter(x=>!x.valid),buttons:await page.locator('button').evaluateAll(es=>es.map(e=>({text:e.innerText,disabled:e.disabled,type:e.type})))};
  report.checks.push(check);
 }
 await Promise.allSettled(pending);
 report.backend.old_snapshot_fingerprint=JSON.parse(fs.readFileSync('.local/game-parity-20261029/runtime/build-input-1793255101616/snapshot-manifest.json')).fingerprint;
 report.backend.old_snapshot_route_hashes=Object.fromEntries(files.map(p=>[p,sha('.local/game-parity-20261029/runtime/build-input-1793255101616/'+p)]));
 report.backend.route_code_matches_current=files.every(p=>report.source_hashes[p]===report.backend.old_snapshot_route_hashes[p]);
 report.product_findings.push({severity:'capability_gap',detail:'All four planning responses return 200 with database-only plans. Node bind checks unavailable; update/reconnect compatible node agent and verify local ports/forwarding before accepting host capability. No verified bind or external reachability pass.'},{severity:'expected_required_input',detail:'ASA admin password intentionally empty and required. No secret supplied; this is not a default-field defect.'});
 report.result={planning_http_success:report.api.filter(a=>allowed.has(a.url)&&a.status===200).length,host_capability_verified:false,guard_errors:report.guard_errors.length};
 report.source_unchanged=files.every(p=>sha(p)===report.source_hashes[p]);
}catch(e){report.errors.push(e.stack);}finally{await browser.close();fs.writeFileSync('artifacts/game-parity-20261029/ui-planning.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({checks:report.checks.map(c=>({route:c.route,invalid:c.invalid_fields,dom:c.dom.slice(-1800)})),planning:report.api.filter(a=>allowed.has(a.url)),errors:report.errors,guard_errors:report.guard_errors},null,2));
