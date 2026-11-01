import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

// In-memory TSX fixtures. No browser, server, real fetch, or dist output.
const fixtureKey = '__serverAdminToolsFixture';
const modules = {
  icons: `export const Info='svg';`,
  errors: `import {useState} from 'react'; export const useErrorState=()=>useState('');`,
  pending: `export const usePendingSetting=(key,dirty,change)=>globalThis.${fixtureKey}.pending.set(key,{...change,dirty}); export const useDiscardSettings=()=>async()=>{const f=globalThis.${fixtureKey};const entries=[...f.pending.values()].filter(x=>x.dirty);if(!entries.length)return true;f.confirmations.push('Discard changes?');if(!f.confirm)return false;for(const item of entries)item.discard();return true};`,
  confirm: `export const confirmAction=async options=>{const f=globalThis.${fixtureKey};f.confirmations.push(options.description);return f.confirm;};`,
  primitives: `export const Card='section',Field='div',Input='input',Textarea='textarea',ActionButton='button',Button='button';`,
  tabs: `import {jsx} from 'react/jsx-runtime';export const SectionTabs=({items,scope,active,onChange})=>jsx('nav',{children:items.map(item=>jsx('button',{role:'tab',id:scope+'-tab-'+item.id,'aria-selected':active===item.id,onClick:()=>onChange(item.id),children:item.label}))});`,
  integrationHeader: `export const IntegrationHeader=({children})=>children;`,

  react: `export const useState=(...args)=>globalThis.${fixtureKey}.useState(...args); export const useEffect=(...args)=>globalThis.${fixtureKey}.useEffect(...args); export const useId=()=>globalThis.${fixtureKey}.useId(); export const useRef=initial=>useState(()=>({current:initial}))[0]; export const createContext=initial=>{const context={value:initial};context.Provider=({value,children})=>{context.value=value;return children};return context}; export const useContext=context=>context.value;`,
  'react/jsx-runtime': `export const Fragment='fragment'; export const jsx=(type,props,key)=>({type,props:props||{},key}); export const jsxs=jsx;`,
  'react-router-dom': `export const useParams=()=>({id:'999'}); export const useSearchParams=()=>{const f=globalThis.${fixtureKey};const [search,setSearch]=f.useState(()=>new URLSearchParams(f.initialSearch||''));f.setSearch=setSearch;return [search,next=>{const dirty=[...f.pending.values()].filter(x=>x.dirty);if(dirty.length){f.confirmations.push('Discard changes?');if(!f.confirm)return;for(const change of dirty)change.discard();}f.navigations.push('?'+next.toString());setSearch(next);}];}; export const useNavigate=()=>path=>globalThis.${fixtureKey}.navigations.push(path); export const Link='a'; export const NavLink='a'; export const Navigate=props=>({type:'fixture-redirect',props});`,
  lib: `import {jsx} from 'react/jsx-runtime';
    export const api=(...args)=>globalThis.${fixtureKey}.api(...args);
    export const useAPI=path=>globalThis.${fixtureKey}.query(path);
    export const unwrap=value=>value?.attributes??value;
    export const rows=value=>(value?.data??[]).map(unwrap);
    export const Button=({children,...props})=>jsx('button',{type:'button',...props,children});
    export const Input=props=>jsx('input',props);
    export const Select=props=>jsx('select',props);
    export const Card=({children})=>jsx('section',{children});
    export const ErrorBox=({children})=>children?jsx('div',{role:'alert',children}):null;
    export const Loading=()=>jsx('p',{role:'status',children:'Loading'});`,
  common: `export const can=(permissions,key)=>permissions.includes('*')||permissions.includes(key); export const useServer=()=>globalThis.${fixtureKey}.context;`,
  // Keep the real Settings wrapper and its consumers, but isolate the shadcn
  // primitive from this DOM-free React renderer. Model its boolean callback,
  // controlled state and disabled guard instead of a legacy checkbox event.
  switch: `import {jsx} from 'react/jsx-runtime';
    export const Switch=({checked=false,onCheckedChange,disabled,render,nativeButton,inputRef,...props})=>jsx('button',{
      ...props,type:'button',role:'switch','aria-checked':checked,disabled,
      onClick:()=>{if(!disabled)onCheckedChange?.(!checked,{event:{type:'click'}});}
    });`,
  operations: `import {jsx} from 'react/jsx-runtime'; export const Settings=()=>jsx('fixture-general',{});`,
  startup: `import {jsx} from 'react/jsx-runtime'; export default ({runtimeCommand,...props})=>jsx('fixture-runtime',{...props,children:runtimeCommand});`,
  shared: `export {api,useAPI,unwrap,rows} from 'fixture:lib';
    import {jsx} from 'react/jsx-runtime';
    export const f=(key,label,type,extra={})=>({key,label,type,...extra});
    export const defaults=()=>({}); export const normalize=(_fields,value)=>value;
    export const Panel=({children})=>jsx('section',{children});
    export const Heading=({children})=>jsx('header',{children});
    export const ErrorMessage=({error})=>error?jsx('div',{role:'alert',children:error}):null;
    export const Editor=props=>jsx('fixture-editor',props);
    export const Action=props=>jsx('fixture-action',props);
    export const DataTable=props=>jsx('fixture-table',props);
    export const Fields=props=>jsx('fixture-fields',props);
    export const JsonView=props=>jsx('fixture-json',props);
    export const ResourceList=props=>jsx('fixture-resources',props);`,
};
const bundled = await build({
  stdin: {contents:`export * from './src/client/ServerAdminTools'; export {default} from './src/client/ServerAdminTools'; export {Server,Startup,Manage,DeleteServer,ServerSettingsTabs} from './src/admin/servers'; export {GameLicences} from './src/admin/GameLicences';`, resolveDir:fileURLToPath(new URL('..', import.meta.url)), loader:'tsx'},
  bundle:true, write:false, platform:'node', format:'esm', jsx:'automatic', loader:{'.css':'empty'},
  plugins:[{name:'isolated-ui-fixtures', setup(builder) {
    builder.onResolve({filter:/^lucide-react$/},()=>({path:'icons',namespace:'fixture'}));
    builder.onResolve({filter:/notifications\/useErrorState$/},()=>({path:'errors',namespace:'fixture'}));
    builder.onResolve({filter:/PendingSettings$/},()=>({path:'pending',namespace:'fixture'}));
    builder.onResolve({filter:/ui\/ConfirmAction$/},()=>({path:'confirm',namespace:'fixture'}));
    builder.onResolve({filter:/ui\/SectionTabs$/},()=>({path:'tabs',namespace:'fixture'}));
    builder.onResolve({filter:/components\/ui\/(card|field|input|textarea|button)$|ui\/ActionButton$/},()=>({path:'primitives',namespace:'fixture'}));
    builder.onResolve({filter:/^\.\/integrations$/},()=>({path:'integrationHeader',namespace:'fixture'}));
    builder.onResolve({filter:/^\.\/Operations$/}, () => ({path:'operations',namespace:'fixture'}));
    builder.onResolve({filter:/client\/ServerStartup$|^\.\/ServerStartup$/}, () => ({path:'startup',namespace:'fixture'}));
    builder.onResolve({filter:/components\/ui\/switch$/}, () => ({path:'switch',namespace:'fixture'}));
    builder.onResolve({filter:/^(react(?:\/jsx-runtime)?|react-router-dom|fixture:lib)$|(?:^|\/)lib$|(?:^|\/)common$|(?:^|\/)shared$/}, args => {
      const name=args.path === 'fixture:lib' ? 'lib' : args.path.replace(/^.*\//,'');
      const key=args.path.startsWith('react') ? args.path : name;
      return {path:key,namespace:'fixture'};
    });
    builder.onLoad({filter:/.*/,namespace:'fixture'}, args => ({contents:modules[args.path],loader:'js'}));
  }}],
});
const ui = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const item = attributes => ({object:'fixture',attributes});
const base = '/api/client/servers/7/configuration';
const values = {config_stop:'^C',config_startup:{done:'Ready'},config_files:{'server.properties':{parser:'properties'}},script_container:'alpine:3',script_entry:'sh',script_install:'echo install'};
const configuration = extra => ({revision:'revision-1',template:{id:2,name:'Fixture template',nest_id:1},managed:false,overrides:{},effective:structuredClone(values),defaults:structuredClone(values),can_update:true,applies:{process:'next_start',installation:'next_install'},...extra});

function fixture(Component=ui.default, props={}) {
  const state=new Map(); let active, effects=[], pending=false;
  const f={
    context:{server:{internal_id:7,identifier:'client-uuid'},permissions:['*'],base:'/api/client/servers/untrusted-url',reload:()=>{}},
    data:new Map([
      ['/api/client/account',{data:item({root_admin:true})}],
      ['/api/application/servers/7?include=allocations,variables,user,node,egg',{data:item({id:7,name:'Fixture server',uuid:'safe-uuid',egg:2,container:{installed:1,environment:{PASSWORD:'never display this'}}})}],
      [base,{data:item(configuration())}],
    ]), queries:[], requests:[], navigations:[], confirmations:[], confirm:true, apiError:'', tree:null, pending:new Map(),
    useId() { return f.useState(()=>`fixture-id-${f.nextId=(f.nextId||0)+1}`)[0]; },
    useState(initial) {
      const index=active.index++;
      if (!active.hooks[index]) {
        const hook={value:typeof initial==='function'?initial():initial};
        hook.set=value=>{const next=typeof value==='function'?value(hook.value):value;if(!Object.is(next,hook.value)){hook.value=next;pending=true;}};
        active.hooks[index]=hook;
      }
      const hook=active.hooks[index]; return [hook.value,hook.set];
    },
    useEffect(fn,deps) {
      const index=active.index++, old=active.hooks[index];
      if (!old || !deps || deps.some((value,i)=>!Object.is(value,old.deps[i]))) {
        const hook={deps,cleanup:old?.cleanup}; active.hooks[index]=hook;
        effects.push(()=>{hook.cleanup?.();hook.cleanup=fn();});
      }
    },
    query(path) {
      if(path) f.queries.push(path);
      return {data:null,error:'',loading:false,...f.data.get(path),reload:()=>{f.reloads=(f.reloads||0)+1;}};
    },
    async api(path,options) {
      f.requests.push({path,method:options.method,body:JSON.parse(options.body)});
      if(f.apiError) throw new Error(f.apiError);
      const before=f.data.get(base).data.attributes;
      return item({...before,revision:'revision-2',overrides:JSON.parse(options.body).overrides});
    },
    render() {
      globalThis[fixtureKey]=f;
      globalThis.window={confirm:message=>{f.confirmations.push(message);return f.confirm;},addEventListener(){},removeEventListener(){}};
      function visit(node,path='root') {
        if(node==null||typeof node==='boolean')return null;
        if(Array.isArray(node))return node.map((child,index)=>visit(child,`${path}.${index}`));
        if(typeof node!=='object')return node;
        if(typeof node.type==='function') {
          const id=`${path}:${node.type.name}:${node.key??''}`;
          if(!state.has(id))state.set(id,[]);
          active={hooks:state.get(id),index:0};
          return visit(node.type(node.props),`${id}.result`);
        }
        return {...node,props:{...node.props,children:visit(node.props.children,`${path}:${node.key??''}.children`)}};
      }
      for(let turn=0;turn<20;turn++) {
        pending=false; effects=[]; f.tree=visit({type:Component,props});
        for(const effect of effects)effect();
        if(!pending)return f.tree;
      }
      throw new Error('Fixture render did not settle');
    },
    nodes(predicate) {
      const found=[];
      function walk(node){if(Array.isArray(node))node.forEach(walk);else if(node&&typeof node==='object'){if(predicate(node))found.push(node);walk(node.props.children);}}
      walk(f.tree);return found;
    },
    text(){return JSON.stringify(f.tree,(key,value)=>key==='type'&&typeof value==='function'?value.name:value);},
    async tab(key){const node=f.nodes(node=>node.props.role==='tab'&&node.props.id.endsWith(`-${key}`))[0];assert.ok(node,`missing ${key} tab`);await node.props.onClick();f.render();},
    field(key){return f.nodes(node=>node.props.id===`server-configuration-7-${key}`)[0];},
    override(key) {
      const group=f.nodes(node=>node.props.className?.split(' ').includes('server-configuration-option')&&f.textOf(node).includes(`server-configuration-7-${key}`))[0];
      const switches=[];
      function walk(node){if(Array.isArray(node))node.forEach(walk);else if(node&&typeof node==='object'){if(node.props.role==='switch')switches.push(node);walk(node.props.children);}}
      walk(group);assert.equal(switches.length,1,`missing override switch for ${key}`);
      const control=switches[0];
      assert.equal(control.props.disabled,false,`override switch for ${key} must be enabled`);
      const wasChecked=control.props['aria-checked'];
      control.props.onClick();f.render();
      const refreshed=f.nodes(node=>node.props.role==='switch'&&node.props['aria-label']===control.props['aria-label'])[0];
      assert.equal(refreshed.props['aria-checked'],!wasChecked,'Switch callback must update controlled state');
    },
    textOf(node){return JSON.stringify(node);},
    async save(){const change=f.pending.get('configuration:7');assert.ok(change,'configuration must register its global save handler');try{await change.save();change.afterSave?.();}finally{f.render();}},
  };
  return f;
}

test('inheritance survives edits and explicit empty overrides; resets omit fields from replacement map',async()=>{
  const original=configuration({overrides:{config_stop:'stop',config_files:{}}});
  const draft=ui.configurationDraft(original);
  draft.config_stop='';delete draft.config_files;
  const request=ui.configurationRequest(original,draft);
  assert.deepEqual(request,{revision:'revision-1',overrides:{config_stop:''}});
  assert.deepEqual(original.overrides,{config_stop:'stop',config_files:{}});
  assert.deepEqual(ui.configurationRequest(configuration(),{}).overrides,{});
});

test('configuration payload rejects invalid objects, stale metadata and managed installer overrides',async()=>{
  for(const value of ['null','[]','42','"text"','{broken'])assert.throws(()=>ui.configurationRequest(configuration(),{config_files:value}),/JSON object/);
  assert.throws(()=>ui.configurationRequest(configuration({can_update:false}),{config_stop:'stop'}),/Stop the server/);
  assert.throws(()=>ui.configurationRequest(configuration({revision:''}),{}),/revision/);
  for(const key of ['script_install','script_container','script_entry'])assert.throws(()=>ui.configurationRequest(configuration({managed:true}),{[key]:'override'}),/managed installer/);
  assert.deepEqual(ui.configurationRequest(configuration({managed:true}),{config_stop:'stop'}).overrides,{config_stop:'stop'});
});

test('server IDs reject missing, malformed, fractional and unsafe identifiers',async()=>{
  for(const value of [undefined,null,true,{},0,-1,1.5,Infinity,'','../7','7?force=1','1e3',Number.MAX_SAFE_INTEGER+1])assert.equal(ui.serverAdminID(value),null);
  assert.equal(ui.serverAdminID(7),7);assert.equal(ui.serverAdminID('7'),7);
});

test('account admin gate blocks owners and wildcard permissions before admin data loads',async()=>{
  for(const account of [{root_admin:false},{root_admin:'true'},{}]) {
    const f=fixture();f.data.set('/api/client/account',{data:item(account)});f.render();
    assert.equal(f.nodes(node=>node.type==='fixture-general').length,1);
    assert.deepEqual([...new Set(f.queries)],['/api/client/account']);
    assert.equal(f.requests.length,0);
  }
  const f=fixture();f.context.server.internal_id=undefined;f.render();assert.match(f.text(),/internal ID is unavailable/);
  assert.deepEqual([...new Set(f.queries)],['/api/client/account']);
});

test('runtime tools use internal ID, keep top tabs local, and omit raw environment',async()=>{
  const f=fixture();f.render();
  assert.equal(f.nodes(node=>node.props.role==='tab').length,6);
  assert.ok(f.queries.includes('/api/application/servers/7?include=allocations,variables,user,node,egg'));
  assert.ok(f.queries.every(path=>!path.includes('untrusted-url')&&!path.includes('999')));
  assert.doesNotMatch(f.text(),/never display this/);
  await f.tab('configuration');assert.ok(f.queries.includes(base));
  assert.equal(f.field('config_stop').props.disabled,true);
  const installer=f.nodes(node=>node.type==='details');
  assert.equal(installer.length,0);
  assert.equal(f.nodes(node=>node.props.title === "Startup command and template").length,0);
  assert.equal(f.requests.length,0);
});

test('revision conflict retains draft; retry uses server endpoint and never invokes lifecycle or global template writes',async()=>{
  const f=fixture();f.render();await f.tab('configuration');f.override('config_stop');
  f.field('config_stop').props.onChange({target:{value:'server-stop'}});f.render();
  f.apiError='Configuration revision changed. Reload current settings.';await assert.rejects(f.save(),/Configuration revision changed/);
  assert.equal(f.field('config_stop').props.value,'server-stop');assert.match(f.text(),/Configuration revision changed/);
  f.confirm=false;await f.tab('runtime');assert.ok(f.field('config_stop'));assert.equal(f.confirmations.length,1);
  f.apiError='';await f.save();
  assert.deepEqual(f.requests,[0,1].map(()=>({path:base,method:'PUT',body:{revision:'revision-1',overrides:{config_stop:'server-stop'}}})));
  assert.match(f.text(),/Nothing was started or reinstalled/);
});

test('disabling an override through the Switch callback restores inheritance and omits the override on save',async()=>{
  const f=fixture();
  f.data.set(base,{data:item(configuration({overrides:{config_stop:'custom-stop'}}))});
  f.render();await f.tab('configuration');
  assert.equal(f.field('config_stop').props.value,'custom-stop');
  f.override('config_stop');
  assert.equal(f.field('config_stop').props.disabled,true);
  assert.equal(f.field('config_stop').props.value,'^C');
  await f.save();
  assert.deepEqual(f.requests,[{path:base,method:'PUT',body:{revision:'revision-1',overrides:{}}}]);
});

test('backend update guard and managed installer locks do not erase inherited values',async()=>{
  const f=fixture();f.data.set(base,{data:item(configuration({managed:true,can_update:false}))});f.render();await f.tab('configuration');
  for(const key of ['config_stop','config_files','script_container','script_entry','script_install'])assert.equal(f.field(key).props.disabled,true);
  assert.equal(f.field('script_install').props.value,'echo install');
  assert.match(f.text(),/Stop the server/);
  assert.equal(f.pending.get('configuration:7').blocked,true);
  const controls=f.nodes(node=>node.props.role==='switch');
  assert.ok(controls.length>0,'guarded configuration must retain its override switches');
  for(const control of controls){assert.equal(control.props.disabled,true);control.props.onClick();}
  f.render();
  assert.ok(f.nodes(node=>node.props.role==='switch').every(node=>node.props['aria-checked']===false),'disabled Switch callbacks must not create overrides');
  assert.equal(f.requests.length,0);
});

test('legacy admin server pages redirect into the shared server workspace',async()=>{
  const f=fixture(ui.Server);f.data.set('/api/application/servers/999?include=allocations,variables,user,node,egg',{data:item({id:999,identifier:'legacy-server',name:'Legacy admin server',container:{}})});f.render();
  assert.equal(f.nodes(node=>node.type==='fixture-redirect')[0].props.to,'/server/legacy-server/runtime');
  assert.equal(f.nodes(node=>node.props.role==='tab').length,0);
});

test('contextual runtime masks credential inputs and submits only changed environment fields',async()=>{
  const record={id:7,egg:2,container:{image:'runtime-image',environment:{PASSWORD:'supersecret',PORT:'25565'}}};
  const f=fixture(ui.Startup,{record,onSaved(){},contextual:true});
  f.data.set('/api/admin/eggs/2',{data:item({relationships:{variables:{data:[
    item({env_variable:'PASSWORD',name:'Password',field_type:'password'}),item({env_variable:'PORT',name:'Port'})
  ]}}})});f.render();
  const editor=f.nodes(node=>node.type==='fixture-editor'&&node.props.title==='Image and environment')[0];
  assert.equal(editor.props.initial['env:PASSWORD'],'');
  assert.equal(editor.props.fields.find(field=>field.key==='env:PASSWORD').type,'password');
  assert.deepEqual(editor.props.transform({image:'runtime-image','env:PORT':'25566'}),{image:'runtime-image',environment:{PORT:'25566'}});
  assert.equal(f.nodes(node=>node.type==='details').length,0);
});

test('generic runtime saves retain untouched secrets and preserve opaque replacements exactly',async()=>{
  for(const savedSecret of ['saved-private-credential','[hidden]']) {
    const record={id:7,egg:2,container:{image:'runtime-image',environment:{PASSWORD:savedSecret,PORT:'25565'}}};
    const f=fixture(ui.Startup,{record,onSaved(){},contextual:true});
    f.data.set('/api/admin/eggs/2',{data:item({relationships:{variables:{data:[
      item({env_variable:'PASSWORD',name:'Password',field_type:'password'}),item({env_variable:'PORT',name:'Port'})
    ]}}})});f.render();
    const editor=f.nodes(node=>node.type==='fixture-editor'&&node.props.title==='Image and environment')[0];
    assert.equal(editor.props.initial['env:PASSWORD'],'');
    assert.ok(!f.text().includes(savedSecret),'saved secret must not appear in the rendered tree');
    assert.deepEqual(editor.props.transform({...editor.props.initial,image:'new-image'}),{image:'new-image',environment:{}});
    assert.deepEqual(editor.props.transform({...editor.props.initial,'env:PORT':'25566'}),{image:'runtime-image',environment:{PORT:'25566'}});
    const replacement='  fixture "quote" \\ +quit λé  ';
    assert.deepEqual(editor.props.transform({...editor.props.initial,'env:PASSWORD':replacement}),{image:'runtime-image',environment:{PASSWORD:replacement}});
    assert.deepEqual(editor.props.transform({...editor.props.initial,'env:PASSWORD':'  '}),{image:'runtime-image',environment:{PASSWORD:'  '}});
  }
});

test('server-limited Runtime omits global licence creation and assignment',async()=>{
 const record={id:7,egg:2,container:{image:'runtime-image',environment:{GAME_SERIAL:'server-key',DLC_PRODUCT_KEY:'private-dlc-key'}}};
 const f=fixture(ui.Startup,{record,onSaved(){},contextual:true});
 f.data.set('/api/admin/eggs/2',{data:item({features:['voltra_fs25'],relationships:{variables:{data:[item({env_variable:'GAME_SERIAL'}),item({env_variable:'DLC_PRODUCT_KEY'})]}}})});f.render();
 const editor=f.nodes(node=>node.type==='fixture-editor'&&node.props.title==='Image and environment')[0];
 assert.ok(!editor.props.fields.some(field=>field.key.includes('GAME_SERIAL')||field.key.includes('DLC_PRODUCT_KEY')));
 assert.equal(f.nodes(node=>node.props['aria-label']==='Licence name').length,0);
 assert.ok(!f.queries.some(path=>path.includes('/fs25/licences')));
 assert.ok(!f.text().includes('server-key')&&!f.text().includes('private-dlc-key'));
});

test('central licence page identifies an unknown key and saves it globally without a server',async()=>{
 const f=fixture(ui.GameLicences);f.data.set('/api/admin/integrations',{data:{data:[]}});f.data.set('/api/admin/eggs',{data:{data:[]}});f.data.set('/api/application/servers?per_page=100',{data:{data:[]}});
 f.api=async(path,options)=>{f.requests.push({path,method:options.method,body:JSON.parse(options.body)});return path.endsWith('/inspect')?item({egg_id:2,kind:'dlc',suggested_name:'Emergency Pack',products:[{name:'Emergency Pack',kind:'dlc'}]}):item({id:3});};f.render();
 const field=f.nodes(node=>node.props['aria-label']==='GIANTS product key')[0];assert.equal(field.props.type,'password');field.props.onChange({target:{value:'private-fixture-key'}});f.render();
 await f.nodes(node=>node.type==='button'&&node.props.children==='Look up key')[0].props.onClick();f.render();
 assert.equal(f.nodes(node=>node.props['aria-label']==='Licence name')[0].props.value,'Emergency Pack');
 assert.equal(f.nodes(node=>typeof node.props.children==='string'&&node.props.children.includes('private-fixture-key')).length,0);
 await f.nodes(node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});f.render();
 assert.deepEqual(f.requests.map(request=>request.path),['/api/admin/fs25/licences/inspect','/api/admin/integrations']);
 assert.deepEqual(f.requests[1].body.bindings,{license_key:['DLC_PRODUCT_KEY']});
 assert.equal(f.nodes(node=>node.props['aria-label']==='GIANTS product key')[0].props.value,'');
 assert.ok(!f.requests.some(request=>request.path.includes('/servers/')));
});

test('editing an inspected key invalidates the discovered product and prevents stale saves',async()=>{
 const f=fixture(ui.GameLicences);f.api=async()=>item({egg_id:2,kind:'dlc',suggested_name:'One',products:[{name:'One',kind:'dlc'}]});f.render();
 f.nodes(node=>node.props['aria-label']==='GIANTS product key')[0].props.onChange({target:{value:'first'}});f.render();
 await f.nodes(node=>node.type==='button'&&node.props.children==='Look up key')[0].props.onClick();f.render();
 assert.equal(f.nodes(node=>node.props['aria-label']==='Licence name').length,1);
 f.nodes(node=>node.props['aria-label']==='GIANTS product key')[0].props.onChange({target:{value:'second'}});f.render();
 assert.equal(f.nodes(node=>node.props['aria-label']==='Licence name').length,0);
 assert.equal(f.nodes(node=>node.type==='button'&&node.props.children==='Save licence').length,0);
});

test('General retains lifecycle safeguards and Transfer contains only transfer actions',async()=>{
  const f=fixture();f.render();
  const actions=f.nodes(node=>node.type==='fixture-action');
  assert.match(actions.find(node=>node.props.path.endsWith('/reinstall')).props.confirm,/may overwrite files/);
  assert.match(actions.find(node=>node.props.path.endsWith('/force')).props.confirm,/Daemon files may remain/);
  assert.match(actions.find(node=>node.props.method==='DELETE'&&node.props.path==='/api/application/servers/7').props.confirm,/Permanently delete/);
  await f.tab('manage');assert.ok(f.nodes(node=>node.type==='fixture-action').every(node=>node.props.path.includes('/transfer')));
  const transfer=f.nodes(node=>node.type==='form')[0];
  f.confirm=false;await transfer.props.onSubmit({preventDefault(){}});
  assert.match(f.confirmations.at(-1),/server will stop/);assert.equal(f.requests.length,0);
  actions.find(node=>node.props.path.endsWith('/force')).props.onDone();assert.deepEqual(f.navigations,['?tab=manage','/']);
});

test('empty restricted options omit the form; real restricted secrets remain masked',async()=>{
  const record={id:7,egg:2,container:{environment:{TOKEN:'private-token'}}};
  const f=fixture(ui.Startup,{record,onSaved(){},contextual:true,restrictedOnly:true});
  f.data.set('/api/admin/eggs/2',{data:item({relationships:{variables:{data:[]}}})});f.render();
  assert.equal(f.nodes(node=>node.type==='fixture-editor').length,0);
  f.data.set('/api/admin/eggs/2',{data:item({relationships:{variables:{data:[item({env_variable:'TOKEN',user_viewable:false})]}}})});f.render();
  const editor=f.nodes(node=>node.type==='fixture-editor')[0];
  assert.equal(editor.props.initial['env:TOKEN'],'');
  assert.equal(editor.props.fields[0].type,'password');
  assert.deepEqual(editor.props.transform({'env:TOKEN':''}),{environment:{}});
});


test('Runtime owns command assignment and suppresses the duplicate preview',async()=>{
  const f=fixture();f.render();await f.tab('runtime');
  const runtime=f.nodes(node=>node.type==='fixture-runtime')[0];
  assert.equal(runtime.props.showCommandPreview,false);
  assert.equal(f.nodes(node=>node.type==='fixture-editor'&&node.props.title==='Startup command and template').length,1);
  await f.tab('manage');
  assert.equal(f.nodes(node=>node.type==='details').length,0);
});

test('global discard restores configuration inheritance without refreshing or writing',async()=>{
  const f=fixture();f.render();await f.tab('configuration');f.override('config_stop');
  f.field('config_stop').props.onChange({target:{value:'unsaved-stop'}});f.render();
  assert.equal(f.nodes(node=>node.type==='button'&&node.props.children==='Refresh settings').length,0);
  const before=f.reloads||0;
  f.pending.get('configuration:7').discard();f.render();
  assert.equal(f.field('config_stop').props.value,'^C');
  assert.equal(f.field('config_stop').props.disabled,true);
  assert.equal(f.reloads||0,before);assert.equal(f.requests.length,0);
});

test('General is available under Runtime for administrators and users without startup access',async()=>{
 const admin=fixture();admin.render();await admin.tab('general');
 assert.equal(admin.nodes(node=>node.type==='fixture-general').length,1);
 const user=fixture();user.context.permissions=['settings.rename'];
 user.data.set('/api/client/account',{data:item({root_admin:false})});user.render();
 assert.equal(user.nodes(node=>node.type==='fixture-general').length,1);
 assert.ok(!user.queries.some(path=>path.startsWith('/api/application/')));
});


test('runtime tabs restore URL selection, preserve other parameters and respond to history changes',async()=>{
 const f=fixture();f.initialSearch='?tab=limits&keep=1';f.render();
 assert.ok(f.nodes(n=>n.props.role==='tab'&&n.props['aria-selected']&&n.props.id.endsWith('-limits')).length);
 await f.tab('runtime');assert.equal(f.navigations.at(-1),'?tab=runtime&keep=1');
 f.setSearch(new URLSearchParams('tab=mounts&keep=1'));f.render();
 assert.ok(f.nodes(n=>n.props.role==='tab'&&n.props['aria-selected']&&n.props.id.endsWith('-mounts')).length);
});
test('unknown and unauthorized tab URLs fall back to General without exposing controls',()=>{
 for(const tab of ['unknown','limits']){
  const f=fixture();f.initialSearch='?tab='+tab;f.context.permissions=[];f.data.set('/api/client/account',{data:item({root_admin:false})});f.render();
  assert.equal(f.nodes(n=>n.props.role==='tab').length,1);
  assert.equal(f.nodes(n=>n.type==='fixture-general').length,1);
 }
});
