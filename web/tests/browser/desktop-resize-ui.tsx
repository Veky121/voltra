import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import DesktopGate from '../../src/desktop';
import '../../src/styles.css';
import '../../src/theme.css';

let maximized = false;
const messages: string[] = [];
(window as any)._wails = {invoke:(message: string) => messages.push(message)};
window.fetch = async input => {
  const path = String(input);
  let data: unknown;
  if (path === '/desktop/status') data = {linked:true,panel_url:'https://fixture.invalid',device_name:'Resize fixture',version:'fixture',updates_enabled:false};
  else if (path === '/desktop/window') data = {maximized};
  else if (path === '/desktop/window/maximize') {maximized = !maximized;data = {maximized};}
  else throw Error(`Fixture blocked unexpected request ${path}`);
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
};
const root = createRoot(document.getElementById('root')!);
await act(async () => {root.render(<MemoryRouter><DesktopGate><main style={{padding:'72px 32px'}}><h1>Desktop resize fixture</h1><p>Local gesture and cursor checks. No native window actions or panel requests.</p><label className="field"><span>Text control</span><input id="cursor-target" style={{cursor:'text'}} defaultValue="An ordinary text input"/></label></main></DesktopGate></MemoryRouter>);});
await act(async () => {});
const checks: string[] = [];
function check(ok: unknown, message: string) {if (!ok) throw Error(message);checks.push(message);}
const input = document.querySelector('#cursor-target')!;
const fire = (type: string, x: number, y: number, buttons=0) => input.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons}));
async function run() {
  const w=innerWidth,h=innerHeight;
  for (const [x,y,edge,cursor] of [[7,h/2,'w','ew-resize'],[w-7,h/2,'e','ew-resize'],[w/2,7,'n','ns-resize'],[w/2,h-7,'s','ns-resize'],[3,17,'nw','nwse-resize'],[w-3,17,'ne','nesw-resize'],[3,h-17,'sw','nesw-resize'],[w-3,h-17,'se','nwse-resize']] as const) {
    fire('mousemove',x,y);check(getComputedStyle(input).cursor===cursor,`${edge} cursor overrides text cursor`);
    fire('mousedown',x,y,1);fire('mousemove',x,y,1);fire('mouseup',x,y);fire('click',x,y);
    check(messages.at(-1)===`wails:resize:${edge}-resize`,`${edge} invokes native resize on first move`);
  }
  fire('mousemove',w/2,h/2);check(getComputedStyle(input).cursor==='text','Interior preserves text cursor');
  fire('mousemove',7,h/2);
  await act(async () => {(document.querySelector('[aria-label="Maximize window"]') as HTMLButtonElement).click();});
  fire('mousemove',7,h/2);check(getComputedStyle(input).cursor==='text','Maximized window has no resize cursor');
  const before=messages.length;fire('mousedown',7,h/2,1);fire('mousemove',6,h/2,1);fire('mouseup',6,h/2);check(messages.length===before,'Maximized window does not dispatch resize');
  await act(async () => {(document.querySelector('[aria-label="Restore window"]') as HTMLButtonElement).click();});
  fire('mousemove',7,h/2);check(getComputedStyle(input).cursor==='ew-resize','Restored window regains resize cursor');
  window.dispatchEvent(new Event('blur'));check(getComputedStyle(input).cursor==='text','Blur clears resize cursor');
  const output=document.createElement('output');output.id='suite-result';output.textContent=`${checks.length} checks passed`;document.body.append(output);return checks;
}
(window as any).runDesktopResizeSuite = run;
if(new URLSearchParams(location.search).has('suite'))void run().catch(error=>{const output=document.createElement('pre');output.id='suite-result';output.textContent=`FAIL: ${error.message}`;document.body.append(output);});
