import {createRoot} from 'react-dom/client';
import {Button} from '../components/ui/button';
import {demoResponse} from './demoData';
import './demo.css';

const key='voltra.dev.demo';
export function initializeDevPreview(){
 if(!import.meta.env.DEV)return;
 const query=new URLSearchParams(location.search);
 let enabled=query.get('demo')==='1';
 try{
  if(query.has('demo'))sessionStorage.setItem(key,enabled?'1':'0');
  else enabled=sessionStorage.getItem(key)==='1';
 }catch{/* The query parameter still works with storage disabled. */}
 if(enabled){
  const originalFetch=window.fetch.bind(window);
  window.fetch=async(input,init)=>{
   const request=input instanceof Request?input:null;
   const url=new URL(request?.url??String(input),location.href);
   const method=(init?.method??request?.method??'GET').toUpperCase();
   const signal=init?.signal??request?.signal;
   if(signal?.aborted)throw new DOMException('Aborted','AbortError');
   // Only local static assets can leave the fixture transport. Unknown APIs fail closed.
   if(url.origin===location.origin&&!/^\/(api|desktop)(\/|$)/.test(url.pathname)&&method==='GET')return originalFetch(input,init);
   const body=init?.body??(request&&method!=='GET'?await request.clone().text():undefined);
   return demoResponse(url,method,body);
  };
  // Live event channels and uploads must never talk to the real panel in demo mode.
  window.WebSocket=new Proxy(WebSocket,{construct(){throw new Error('Live sockets are disabled in the static demo.')}});
  window.EventSource=new Proxy(EventSource,{construct(){throw new Error('Live events are disabled in the static demo.')}});
  XMLHttpRequest.prototype.open=function(){throw new Error('Uploads are disabled in the static demo.')};
  navigator.sendBeacon=()=>false;
  document.documentElement.dataset.devDemo='true';
 }
 const host=document.createElement('div');host.id='dev-preview-controls';document.body.append(host);
 function toggle(){
  const url=new URL(location.href);url.pathname='/admin';url.search=enabled?'?demo=0':'?demo=1';url.hash='';location.assign(url);
 }
 createRoot(host).render(<aside className={`dev-preview-controls${enabled?' is-demo':''}`} aria-label="Development preview">
  {enabled?<><strong>Demo data</strong><span>2 nodes · 5 servers · Read-only</span></>:<span>Development</span>}
  <Button type="button" variant="outline" size="sm" onClick={toggle}>{enabled?'Exit demo':'Try demo data'}</Button>
 </aside>);
}
