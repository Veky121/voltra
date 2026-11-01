import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

test('socket failures remain visible, completion refreshes once, and stale polling cannot undo it',async()=>{
 const source=readFileSync(new URL('../src/client/useRemoteTransfers.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const states=[],effects=[],calls=[];let socket,refreshes=0,cleanup;
 class Socket {constructor(){socket=this}send(){}close(){this.onclose?.()}}
 const react={useState(initial){const n=states.length;states.push(initial);return[initial,v=>{states[n]=v}]},useRef:current=>({current}),useEffect:effect=>effects.push(effect)};
 const api=async(path,options)=>{calls.push({path,options});if(path.endsWith('/websocket'))return{attributes:{socket:'http://example.test/ws',token:'test'}};if(options)return{identifier:'new'};return{transfers:[]}};
 const module={exports:{}};
 new Function('require','module','exports','WebSocket','location','setInterval','clearInterval','setTimeout','clearTimeout',compiled)(name=>name==='react'?react:name==='../lib'?{api}:{can:()=>true,value:d=>d.attributes??d},module,module.exports,Socket,{href:'http://example.test/'},()=>1,()=>{},()=>1,()=>{});
 const hook=module.exports.default('/api/client/servers/a',['*'],()=>refreshes++);
 cleanup=effects[0]();await new Promise(resolve=>setImmediate(resolve));
 const send=r=>socket.onmessage({data:JSON.stringify({event:'download progress',args:[JSON.stringify(r)]})});
 send({identifier:'failed',state:'failed',directory:'/mods',name:'a.zip',error:'Download site returned 403 Forbidden',updated:1});
 assert.equal(states[0].failed.state,'failed');assert.equal(refreshes,0);
 send({identifier:'ok',state:'complete',directory:'/mods',name:'b.zip',progress:1,updated:3});
 send({identifier:'ok',state:'downloading',directory:'/mods',name:'b.zip',progress:.5,updated:3});
 send({identifier:'ok',state:'complete',directory:'/mods',name:'b.zip',progress:1,updated:3});
 assert.equal(states[0].ok.state,'complete');assert.equal(refreshes,1);
 await hook.start({url:'https://example.test/c.zip',directory:'/selected',use_header:true});
 const request=JSON.parse(calls.find(c=>c.options)?.options.body);
 assert.equal(request.directory,'/selected');assert.equal(request.foreground,false);assert.equal(request.tracked,true);assert.equal(request.use_header,true);
 cleanup();send({identifier:'after-unmount',state:'complete',updated:4});assert.equal(refreshes,1);
});
