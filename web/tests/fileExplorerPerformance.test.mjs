import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const key='__fileExplorerPerformanceFixture';
const bundled=await build({
  entryPoints:[fileURLToPath(new URL('../src/client/FileExplorer.tsx',import.meta.url))],
  bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},
  plugins:[{name:'explorer-fixture',setup(builder){
    builder.onResolve({filter:/^react$|^react\/jsx-runtime$|^\.\.\/lib$|^\.\.\/Icons$|^\.\/common$/},args=>({path:args.path,namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'js',contents:
      path==='react'?`export const useState=(...a)=>globalThis.${key}.useState(...a); export const useRef=(...a)=>globalThis.${key}.useRef(...a); export const useMemo=(...a)=>globalThis.${key}.useMemo(...a); export const useEffect=(...a)=>globalThis.${key}.useEffect(...a);`:
      path==='react/jsx-runtime'?`export const Fragment='fragment'; export const jsx=(type,props,key)=>({type,props:props||{},key});export const jsxs=jsx;`:
      path==='../lib'?`export const useAPI=path=>globalThis.${key}.query(path);`:
      path==='../Icons'?`export const Icon=()=>null;`:
      `export const bytes=n=>String(n);export const can=(p,v)=>p.includes('*')||p.includes(v);export const items=r=>(r?.data||[]).map(x=>x.attributes);`
    }));
  }}],
});
const {default:FileExplorer}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const entry=(name,is_file=true)=>({name,is_file,size:1,modified_at:''});
const response=files=>({data:files.map(attributes=>({attributes}))});
function fixture(){
  const instances=new Map(),queries=new Map(),effects=[];let active;
  const f={props:{base:'/server/a',activeFile:'',dirty:false,permissions:['*'],onOpen:()=>{},onBrowse:()=>{},onDirectory:()=>{}},tree:null,memos:0,
    query(path){if(!path)return {data:null,loading:false,error:'',reload:()=>{}};if(!queries.has(path))queries.set(path,{data:null,loading:true,error:'',calls:0,reload(){this.calls++}});const q=queries.get(path);q.reloadBound??=q.reload.bind(q);return {...q,reload:q.reloadBound};},
    listing(path,files){const url=`${f.props.base}/files/list?directory=${encodeURIComponent(path)}`;f.query(url);const q=queries.get(url);if(files)q.data=response(files);return q;},
    useState(initial){const i=active.index++;const h=active.hooks[i]??=( {value:typeof initial==='function'?initial():initial} );return [h.value,v=>{h.value=typeof v==='function'?v(h.value):v}];},
    useRef(initial){return f.useState(()=>({current:initial}))[0];},
    useMemo(fn,deps){const i=active.index++,old=active.hooks[i];if(!old||deps.some((x,j)=>!Object.is(x,old.deps[j]))){f.memos++;active.hooks[i]={deps,value:fn()}}return active.hooks[i].value;},
    useEffect(fn,deps){const i=active.index++,old=active.hooks[i];if(!old||deps.some((x,j)=>!Object.is(x,old.deps[j]))){active.hooks[i]={deps};effects.push(fn)}},
    render(){globalThis[key]=f;function visit(node,path='root'){if(Array.isArray(node))return node.map((n,i)=>visit(n,`${path}/${n?.key??i}`));if(!node||typeof node!=='object')return node;if(typeof node.type==='function'){const id=`${path}/${node.type.name}:${node.key??''}`;const parent=active;active=instances.get(id)??{hooks:[]};instances.set(id,active);active.index=0;const child=node.type(node.props);active=parent;return visit(child,id)}return {...node,props:{...node.props,children:visit(node.props.children,path+'/children')}}}f.tree=visit({type:FileExplorer,props:f.props});while(effects.length)effects.shift()();return f;},
    nodes(){const out=[];function walk(n){if(Array.isArray(n))return n.forEach(walk);if(n&&typeof n==='object'){out.push(n);walk(n.props?.children)}}walk(f.tree);return out;},
    button(label){return f.nodes().find(n=>n.type==='button'&&n.props['aria-label']===label);},
    text(){return JSON.stringify(f.tree);},
  };return f;
}

test('refresh preserves rows and expansion, refreshes mounted folders, and keeps rows on failure',()=>{
  const f=fixture();const root=f.listing('/',[entry('mods',false),entry('server.properties')]);root.loading=false;f.render();
  f.button('Expand /mods').props.onClick();const mods=f.listing('/mods',[entry('plugin.jar')]);mods.loading=false;f.render();
  f.button('Refresh file explorer').props.onClick();f.render();
  assert.equal(root.calls,1);assert.equal(mods.calls,1);assert.ok(f.button('Open /mods/plugin.jar'));
  root.loading=true;mods.loading=true;f.render();assert.ok(f.button('Open /server.properties'));assert.ok(f.button('Open /mods/plugin.jar'));assert.match(f.text(),/Refreshing/);
  root.loading=false;root.error='offline';f.render();assert.ok(f.button('Open /server.properties'));assert.match(f.text(),/Could not refresh/);
  f.props.refreshKey=1;f.render();assert.equal(root.calls,2);assert.equal(mods.calls,2);
});

test('sorting and filtering reuse memoized results on selection and background state changes',()=>{
  const f=fixture(),q=f.listing('/',[entry('z.txt'),entry('a10.txt'),entry('a2.txt'),entry('mods',false)]);q.loading=false;f.render();
  const labels=f.nodes().filter(n=>n.type==='button').map(n=>n.props['aria-label']).filter(x=>x?.startsWith('Open /'));assert.deepEqual(labels,['Open /a2.txt','Open /a10.txt','Open /z.txt']);
  const before=f.memos;f.props.dirty=true;q.loading=true;f.render();assert.equal(f.memos,before);
  f.nodes().find(n=>n.type==='input'&&n.props.type==='search').props.onChange({target:{value:'A2'}});f.render();assert.equal(f.memos,before+2);assert.ok(f.button('Open /a2.txt'));assert.equal(f.button('Open /z.txt'),undefined);assert.ok(f.button('Browse /mods'));
});


test('server changes do not expose previous rows and initial failure keeps retry available',()=>{
  const f=fixture(),old=f.listing('/',[entry('private.txt')]);old.loading=false;f.render();assert.ok(f.button('Open /private.txt'));
  f.props.base='/server/b';f.render();assert.equal(f.button('Open /private.txt'),undefined);
  const q=f.listing('/');q.loading=false;q.error='denied';f.render();assert.match(f.text(),/Could not load this folder/);const retry=f.nodes().find(n=>n.type==='button'&&n.props.children==='Retry');retry.props.onClick();assert.equal(q.calls,1);
});
