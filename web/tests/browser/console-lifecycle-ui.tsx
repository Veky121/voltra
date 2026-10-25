import React from 'react';
import {createRoot} from 'react-dom/client';
import Console from '../../src/client/Console';
import {ServerContext} from '../../src/client/common';
import {requestServerPower} from '../../src/client/serverPower';
import '../../src/styles.css';
import '../../src/theme.css';

let state = 'offline', fail = false;
const persistent = new URLSearchParams(location.search).has('persistent');
const storageKey = 'voltra-console-history-fixture';
let retained: {id:string;event:string;line:string;created_at:string}[] = persistent ? JSON.parse(localStorage.getItem(storageKey) || '[]') : [];
function retain(event:string,line:string) {
  if(!persistent) return;
  const id=String(Number(retained.at(-1)?.id || 0)+1);
  retained=[...retained,{id,event,line,created_at:new Date().toISOString()}].slice(-5000);
  localStorage.setItem(storageKey,JSON.stringify(retained));
}
const sockets = new Set<FixtureSocket>();
function event(name: string, value: unknown) {if(['console output','daemon message','install output'].includes(name)) retain(name,String(value)); if(name==='status') retain('panel message',`[Voltra]: Server state: ${value}.`); for (const socket of sockets) socket.onmessage?.({data:JSON.stringify({event:name,args:[value]})});}
function status(next: string) {state=next;event('status', next);event('stats', JSON.stringify({state:next}));}
class FixtureSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: {data:string}) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror = null;
  constructor(_url: string | URL) {sockets.add(this);setTimeout(()=>this.onopen?.(),0);}
  send(raw: string) {
    const message=JSON.parse(raw);
    if(message.event==='auth') setTimeout(()=>event('auth success',''),0);
    if(message.event==='send stats') setTimeout(()=>status(state),0);
  }
  close() {sockets.delete(this);}
}
window.WebSocket=FixtureSocket as unknown as typeof WebSocket;
window.fetch=async(input,init)=>{
  const path=String(input);
  if(path.includes('/console-history')) {
    if(!persistent) return new Response('404 page not found',{status:404});
    const after=Number(new URL(path,location.origin).searchParams.get('after') || 0);
    return Response.json({data:retained.filter(row=>Number(row.id)>after),cursor:retained.at(-1)?.id || '0',more:false,reset:false,truncated:false,limits:{lines:5000,bytes:8388608},capture:{connected:true}});
  }
  if(path.endsWith('/websocket')) return Response.json({data:{socket:'ws://fixture.invalid',token:'fixture'}});
  if(path.endsWith('/power')) {
    if(fail) {fail=false;return Response.json({errors:[{detail:'Fixture node unavailable'}]},{status:503});}
    const signal=JSON.parse(String(init?.body)).signal;
    retain('panel message', `[Voltra]: ${signal} requested.`);
    if(path.includes('/other/')) return new Response(null,{status:204});
    if(signal==='start'||signal==='restart') {
      setTimeout(()=>{
        status('starting');
        event('daemon message','Checking server disk space usage, this could take a few seconds...');
        event('daemon message','Updating process configuration files...');
        event('daemon message','Pulling Docker container image, this could take a few minutes to complete...');
        event('console output','container@pterodactyl~ java -version');
        event('console output','[INFO] Starting Minecraft server');
        status('running');
      },100);
    } else setTimeout(()=>{status('stopping');event('console output','stop');event('console output','[INFO] Saving worlds');setTimeout(()=>status('offline'),100);},100);
    return new Response(null,{status:204});
  }
  throw Error(`Unexpected fixture request: ${path}`);
};
const base='/api/client/servers/fixture';
createRoot(document.getElementById('root')!).render(<ServerContext.Provider value={{server:{name:'Minecraft lifecycle fixture'},permissions:['*'],base,reload(){}}}>
  <main style={{padding:24,maxWidth:1200,margin:'0 auto'}}>
    <h1>{persistent ? "Persistent console replay fixture" : "Console lifecycle fixture"}</h1><p>Simulated transport. No live server is changed.</p>
    <div className="toolbar">
      <button onClick={()=>void requestServerPower(base,'start').catch(()=>{})}>Start fixture</button>
      <button onClick={()=>void requestServerPower(base,'stop').catch(()=>{})}>Stop fixture</button>
      <button onClick={()=>{fail=true;void requestServerPower(base,'start').catch(()=>{});}}>Simulate request failure</button>
      <button onClick={()=>void requestServerPower('/api/client/servers/other','start')}>Other server request</button>
    </div><Console />
  </main>
</ServerContext.Provider>);
