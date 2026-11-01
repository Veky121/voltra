const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import assert from 'node:assert/strict';
const browser=await chromium.launch({...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),headless:true});
const item=attributes=>({attributes}),list=data=>({data:data.map(item)});
let domain={label:'friends',hostname:'play.friends.example.org',dns_matches:true,dns_status:'applied'},fail=true,mode='on_start',interval=3600;
const allocation={id:1,ip:'192.0.2.10',port:25565,is_default:true,notes:''};
const choice={id:1,domain:'example.org',public_host:'gateway.example.org',public_port:25565,protocol:'tcp'};
const errors=[],writes=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async r=>{
  const q=r.request(),p=new URL(q.url()).pathname,m=q.method();let data={};
  if(m!=='GET'){writes.push({p,m,body:q.postDataJSON()});if(fail)return r.fulfill({status:422,json:{errors:[{detail:'Fixture save failed'}]}});}
  if(p==='/api/client/account')data=item({root_admin:!page.url().includes('readonly'),username:'Fixture'});
  else if(p.endsWith('/subdomain')){if(m==='PUT'){domain={...domain,label:q.postDataJSON().label,hostname:q.postDataJSON().label?'play.'+q.postDataJSON().label+'.example.org':''};}data=item({...domain,choices:[choice],route:choice});}
  else if(p.endsWith('/proxy-routes'))data=list([{...choice,local_port:25565,desired_present:true,status:'applied'}]);
  else if(p.endsWith('/proxy'))data=item({allocations:[allocation],clients:[],routes:[],primary_protocol:'tcp'});
  else if(p.endsWith('/network/allocations'))data=list([allocation]);
  else if(p==='/api/application/servers/7')data=item({id:7,name:'Fixture',limits:{memory:4096,disk:20000,cpu:200},container:{installed:1},feature_limits:{allocations:5}});
  else if(p.endsWith('/configuration'))data=item({revision:'1',template:{name:'Fixture'},overrides:{},effective:{config_stop:'stop',config_startup:{},config_files:{},script_install:'',script_entry:'',script_container:''},defaults:{},can_update:true,applies:{process:'next_start',installation:'next_install'}});
  else if(p.endsWith('/steam/private'))data=item({supported:false,private_content:false});
  else if(p.endsWith('/steam')){if(m==='PATCH'){mode=q.postDataJSON().mode;interval=q.postDataJSON().check_interval_seconds;}data=item({supported:true,mode,check_interval_seconds:interval,jobs:[],node_available:true,app_id:123});}
  else if(p.includes('/mounts'))data=list([]);
  else if(p.endsWith('/settings'))data=item({});
  else data=list([]);
  return r.fulfill({json:data});
 });
 const root=new URL('/tests/browser/minimal-settings-ui.html',process.env.UI_BASE_URL||'http://127.0.0.1:5181').href;
 await page.goto(root);await page.getByRole('textbox',{name:'Join name',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Advanced ports',exact:true}).getAttribute('aria-expanded'),'false');
 assert.equal(await page.getByRole('button',{name:'Connect',exact:true}).count(),0);
 await page.getByRole('textbox',{name:'Join name',exact:true}).fill('new-name');
 const bar=page.getByRole('region',{name:'Unsaved settings'});
 await bar.getByRole('button',{name:'Review changes'}).click();assert.match(await bar.innerText(),/Join domain/);
 await bar.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Fixture save failed',{exact:true}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'Join name',exact:true}).inputValue(),'new-name');
 fail=false;await bar.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('region',{name:'Settings saved'}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'Join name',exact:true}).inputValue(),'new-name');
 await page.getByRole('region',{name:'Settings saved'}).waitFor({state:'detached'});
 const before=writes.length;await page.getByRole('button',{name:'Clear',exact:true}).click();assert.equal(writes.length,before);await bar.getByRole('button',{name:'Discard',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Join name',exact:true}).inputValue(),'new-name');
 await page.getByRole('button',{name:'Clear',exact:true}).click();await bar.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('region',{name:'Settings saved'}).waitFor();assert.equal(domain.label,'');
 for(const width of [390,2560]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow at '+width);}
 await page.goto(root+'?readonly=1');await page.getByRole('textbox',{name:'Join name',exact:true}).waitFor();assert.ok(await page.getByRole('textbox',{name:'Join name',exact:true}).isDisabled());assert.equal(await page.getByRole('button',{name:'Clear',exact:true}).count(),0);
 await page.setViewportSize({width:1440,height:1000});
 await page.goto(root+'?view=runtime&tab=limits');await page.getByRole('tab',{name:'Resources',exact:true}).waitFor();assert.equal(await page.getByRole('tab',{name:'Resources',exact:true}).getAttribute('aria-selected'),'true');
 await page.getByRole('tab',{name:'Advanced',exact:true}).click();assert.match(page.url(),/tab=configuration/);await page.reload();assert.equal(await page.getByRole('tab',{name:'Advanced',exact:true}).getAttribute('aria-selected'),'true');
 await page.getByRole('tab',{name:'Resources',exact:true}).click();await page.goBack();assert.equal(await page.getByRole('tab',{name:'Advanced',exact:true}).getAttribute('aria-selected'),'true');
 await page.goForward();assert.equal(await page.getByRole('tab',{name:'Resources',exact:true}).getAttribute('aria-selected'),'true');
 await page.goBack();await page.getByRole('switch',{name:'Override Stop command',exact:true}).click();
 await page.locator('#server-configuration-7-config_stop').fill('changed-stop');await bar.waitFor();
 await page.getByRole('tab',{name:'Resources',exact:true}).click();const dialog=page.getByRole('alertdialog');await dialog.waitFor();
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.match(page.url(),/tab=configuration/);assert.equal(await page.locator('#server-configuration-7-config_stop').inputValue(),'changed-stop');
 await page.evaluate(()=>history.back());await dialog.waitFor();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.match(page.url(),/tab=configuration/);
 await page.getByRole('tab',{name:'Resources',exact:true}).click();await dialog.waitFor();await dialog.getByRole('button',{name:'Discard changes',exact:true}).click();await bar.waitFor({state:'detached'});assert.match(page.url(),/tab=limits/);

 await page.goto(root+'?view=steam');await page.getByRole('spinbutton',{name:'Check interval in minutes'}).fill('90');await bar.waitFor();
 fail=true;await bar.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Fixture save failed',{exact:true}).waitFor();assert.equal(await page.getByRole('spinbutton',{name:'Check interval in minutes'}).inputValue(),'90');
 fail=false;await bar.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('region',{name:'Settings saved'}).waitFor();assert.equal(interval,5400);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,writes:writes.length,checks:['DNS failed save/retry','DNS clear/discard','permission gating','compact width overflow','URL tab refresh and history','dirty tab/history cancellation and discard','Steam shared save failure/retry','transient saved feedback']}));
}finally{await browser.close();}
