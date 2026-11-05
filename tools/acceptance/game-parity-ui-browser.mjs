import { chromium } from 'file:///C:/Users/Veky/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const origin='http://127.0.0.1:18099';
const privateDir='.local/game-parity-20261029/ui-browser-evidence';
fs.mkdirSync(privateDir,{recursive:true});
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);
const source=Object.fromEntries(walk('web/src').map(p=>[p,hash(p)]));
const report={lane:'ui-browser',captured_at:new Date().toISOString(),origin,evidence_basis:'real isolated panel unless explicitly marked synthetic',source_hashes:source,bundle_hashes:Object.fromEntries(walk('.local/game-parity-20261029/runtime/web').map(p=>[p,hash(p)])),checks:[],api:[],errors:[],gaps:[],mutations:'No real API mutations, game actions or panel restarts. Isolated frontend assets published only.'};
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
const page=await browser.newPage({viewport:{width:1440,height:1100}});
await page.route('**/*',route=>{const u=new URL(route.request().url()); if(u.origin!==origin)return route.abort();if(!['GET','HEAD'].includes(route.request().method()))return route.abort();return route.continue();});
page.on('pageerror',e=>report.errors.push(e.message));
page.on('response',async r=>{if(r.url().includes('/api/'))report.api.push({url:r.url(),status:r.status()});});
async function capture(route,label,basis='real panel'){
await page.goto(origin+route); await page.waitForTimeout(1600);
const dom=await page.locator('body').innerText();
fs.writeFileSync(`${privateDir}/${label}.txt`,dom);
await page.screenshot({path:`${privateDir}/${label}.png`,fullPage:true});
const fields=await page.locator('input,select,textarea').evaluateAll(es=>es.map(e=>({tag:e.tagName,type:e.type,name:e.name,id:e.id,placeholder:e.placeholder,disabled:e.disabled,required:e.required,labels:[...(e.labels||[])].map(l=>l.innerText),value:e.type==='password'?'[redacted]':e.value,options:e.options?[...e.options].map(o=>({text:o.text,value:o.value})):undefined})));
const links=await page.locator('a').evaluateAll(es=>es.map(e=>({text:e.innerText,href:e.getAttribute('href')})));
report.checks.push({route,label,basis,title:await page.title(),dom_sha256:crypto.createHash('sha256').update(dom).digest('hex'),fields,links,dom:`${privateDir}/${label}.txt`,screenshot:`${privateDir}/${label}.png`}); return links;
}
await capture('/','overview');
const links=await capture('/game-library','library');
const templates=[...new Set(links.map(l=>l.href).filter(h=>h?.startsWith('/game-library/template/')))];
for(const [i,route]of templates.slice(0,4).entries())await capture(route,`setup-${i}`);
await capture('/game-library/minecraft?setup=custom','minecraft-setup');
const servers=await page.request.get(origin+'/api/client');
report.server_list_status=servers.status();
if(servers.ok()){
const data=await servers.json(); report.server_count=data.data?.length;
for(const row of(data.data||[])){const s=row.attributes||{};if(!/stk|supertux/i.test(s.name||''))continue;const id=s.identifier||s.uuid;
for(const suffix of['','/settings','/runtime'])await capture(`/server/${id}${suffix}`,`stk-${suffix.replace('/','')||'console'}`);
}}
if(!report.checks.some(c=>c.label.startsWith('stk-')))report.gaps.push('No owned STK fixture found in live GET /api/client. Native Settings/Runtime, console, permission and field loading/error/empty checks unavailable. No game created.');
const fixture='.local/game-parity-20261029/ui-browser-fixture/console-lifecycle-ui';
await page.route(origin+'/__ui_acceptance_console',r=>r.fulfill({contentType:'text/html',body:`<div id="root"></div><style>${fs.readFileSync(fixture+'.css','utf8')}</style><script type="module">${fs.readFileSync(fixture+'.js','utf8').replaceAll('</script','<\\/script')}</script>`}));
await capture('/__ui_acceptance_console','synthetic-console-offline','synthetic compiled existing fixture, mocked fetch/WebSocket');
for(const [label,button]of[['running','Start fixture'],['offline-after-stop','Stop fixture'],['error','Simulate request failure']]){
await page.getByRole('button',{name:button,exact:true}).click();await page.waitForTimeout(600);const dom=await page.locator('body').innerText();fs.writeFileSync(`${privateDir}/synthetic-console-${label}.txt`,dom);await page.screenshot({path:`${privateDir}/synthetic-console-${label}.png`,fullPage:true});report.checks.push({label:`synthetic-console-${label}`,basis:'synthetic compiled existing fixture, mocked fetch/WebSocket',action:button,dom:`${privateDir}/synthetic-console-${label}.txt`,screenshot:`${privateDir}/synthetic-console-${label}.png`});}
report.gaps.push('Synthetic lifecycle fixture does not prove native game lifecycle or ANSI colors. No real game changes, settings saves, reinstall, secrets submission or player connection attempted.');
report.source_unchanged=Object.entries(source).every(([p,h])=>hash(p)===h);
}catch(e){report.errors.push(e.stack);report.gaps.push('Browser run interrupted; inspect completed checks.');}
finally{await browser.close();fs.writeFileSync('artifacts/game-parity-20261029/ui-browser.json',JSON.stringify(report,null,2));}
