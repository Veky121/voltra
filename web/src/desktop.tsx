import {useEffect,useState,type ReactNode} from 'react';
import {Button,Card,ErrorBox,Field,Input,Loading,Select} from './lib';
import './desktop.css';
import BrandMark from './BrandMark';
import {parseDesktopPairing} from './desktopPairing';
import {Link,useLocation} from 'react-router-dom';
import {startUpdateChecks,updateAction,useDesktopUpdates} from './desktopUpdates';

type Status={linked:boolean;panel_url:string;device_name:string;version:string;updates_enabled:boolean;storage_error?:string};
async function local<T=Status>(path:string,body?:unknown):Promise<T>{
  const response=await fetch(`/desktop/${path}`,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'The desktop request failed.');
  return data;
}

function DesktopUpdates({enabled}:{enabled:boolean}){
  const {status,busy}=useDesktopUpdates();
  useEffect(()=>{if(enabled)return startUpdateChecks()},[enabled]);
  if(!enabled)return null;
  return <div className="desktop-updates" aria-live="polite">
    {status?.state==='available'&&<Button disabled={busy} onClick={()=>void updateAction('update-install')}>{busy?'Downloading...':`Update to ${status.available_version}`}</Button>}
    {status?.state==='ready'&&<Button disabled={busy} onClick={()=>void updateAction('update-restart')}>Restart to update</Button>}
  </div>;
}

export function DesktopAppInfo(){
  const [app,setApp]=useState<Status|null>(null),[error,setError]=useState(''),[unlinking,setUnlinking]=useState(false);
  const {status,busy,error:updateError,checkedAt}=useDesktopUpdates();
  useEffect(()=>{void local('status').then(setApp).catch(e=>setError(e.message))},[]);
  if(import.meta.env.VITE_DESKTOP!=='true')return null;
  async function unlink(){
    if(!confirm('Unlink this desktop? You can pair it again from your web account.'))return;
    setUnlinking(true);try{await local('unlink',{});window.location.assign('/')}catch(e){setError((e as Error).message);setUnlinking(false)}
  }
  return <section className="desktop-app-info"><Card>
    <h2>App &amp; updates</h2><p>Voltra desktop {app&&`v${app.version}`}</p>
    {app&&!app.linked&&<Link to="/">Back to connection</Link>}
    <p className="muted">Checks for updates on launch and every hour. You choose when to install and restart.</p>
    <ErrorBox>{error||updateError||status?.error}</ErrorBox>
    {app?.updates_enabled?<>
      <Field label="Update channel" hint="Beta and nightly include testing builds. Stable is the default."><Select aria-label="Update channel" value={status?.channel||'stable'} disabled={busy||!status||status.state==='ready'} onChange={e=>void updateAction('update-channel',{channel:e.target.value}).then(()=>updateAction('updates'))}><option value="stable">Stable</option><option value="beta">Beta</option><option value="nightly">Nightly</option></Select></Field>
      <div className="desktop-app-actions"><Button variant="secondary" disabled={busy||status?.state==='ready'} onClick={()=>void updateAction('updates')}>{busy?'Working...':'Check for updates'}</Button>
      {status?.state==='available'&&<Button disabled={busy} onClick={()=>void updateAction('update-install')}>Install {status.available_version}</Button>}
      {status?.state==='ready'&&<Button disabled={busy} onClick={()=>void updateAction('update-restart')}>Restart to update</Button>}</div>
      <p className="muted" role="status">{status?.state==='up-to-date'?'You are up to date. ':''}{checkedAt&&`Last checked ${new Date(checkedAt).toLocaleTimeString()}`}</p>
    </>:<p className="muted">Updates are not configured for this build.</p>}
    <hr/><h3>Connected panel</h3><p className="desktop-app-panel">{app?.panel_url||'Not connected'}</p>
    {app?.linked&&<Button variant="danger" disabled={unlinking} onClick={()=>void unlink()}>{unlinking?'Unlinking...':'Unlink this computer'}</Button>}
  </Card></section>;
}

function WindowControls(){
  const [maximized,setMaximized]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    let active=true,timer:ReturnType<typeof setTimeout>;
    const refresh=()=>{void local<{maximized:boolean}>('window').then(state=>{if(active)setMaximized(state.maximized)}).catch(()=>{});};
    const resized=()=>{clearTimeout(timer);timer=setTimeout(refresh,120);};
    refresh();window.addEventListener('resize',resized);
    return()=>{active=false;clearTimeout(timer);window.removeEventListener('resize',resized);};
  },[]);
  async function act(action:string){setError('');try{const state=await local<{maximized:boolean}>(`window/${action}`,{});setMaximized(state.maximized);}catch(failure){setError((failure as Error).message);}}
  return <div className="desktop-window-controls" aria-label="Window controls" title={error||undefined}>
    {error&&<span className="desktop-update-error" role="alert">Window control failed</span>}
    <button type="button" aria-label="Minimize window" title="Minimize" onClick={()=>void act('minimize')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10"/></svg></button>
    <button type="button" aria-label={maximized?'Restore window':'Maximize window'} title={maximized?'Restore':'Maximize'} onClick={()=>void act('maximize')}><svg viewBox="0 0 16 16" aria-hidden="true">{maximized?<><path d="M5 5V3h8v8h-2"/><rect x="3" y="5" width="8" height="8"/></>:<rect x="3" y="3" width="10" height="10"/>}</svg></button>
    <button type="button" className="desktop-window-close" aria-label="Close window" title="Close" onClick={()=>void act('close')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13"/></svg></button>
  </div>;
}

function DesktopTitlebar({status}:{status:Status|null}){
  return <header className="desktop-bar">
    <div className="desktop-title"><BrandMark/><span>Voltra</span>{status&&<span className="desktop-version-label">v{status.version}</span>}{status?.linked&&<span className="desktop-panel-address" title={status.panel_url}>{status.panel_url}</span>}</div>
    <div className="desktop-title-actions">{status&&<DesktopUpdates enabled={status.updates_enabled}/>} <Link className="button secondary" to="/account/app">App &amp; updates</Link></div>
    <WindowControls/>
  </header>;
}

export default function DesktopGate({children}:{children:ReactNode}){
  const location=useLocation();
  useEffect(()=>{
    // The external localhost page receives Wails Core, but not its gesture listeners.
    const invoke=(message:string)=>(window as Window&{_wails?:{invoke?:(message:string)=>void}})._wails?.invoke?.(message);
    let origin:{x:number;y:number;edge:string}|null=null;
    const edge=(e:MouseEvent)=>{const x=e.clientX,y=e.clientY,w=innerWidth,h=innerHeight;const horizontal=x<5?'w':x>w-5?'e':'';const vertical=y<5?'n':y>h-5?'s':'';return vertical+horizontal;};
    const down=(e:MouseEvent)=>{
      if(e.button!==0)return;
      const target=e.target as Element;
      const border=edge(e);
      if(border||getComputedStyle(target).getPropertyValue('--wails-draggable').trim()==='drag')origin={x:e.clientX,y:e.clientY,edge:border};
    };
    const move=(e:MouseEvent)=>{if(!origin||!(e.buttons&1))return;if(Math.abs(e.clientX-origin.x)+Math.abs(e.clientY-origin.y)<3)return;invoke(origin.edge?`wails:resize:${origin.edge}-resize`:'wails:drag');origin=null;};
    const up=()=>{origin=null;};
    const double=(e:MouseEvent)=>{if(getComputedStyle(e.target as Element).getPropertyValue('--wails-draggable').trim()==='drag')void local('window/maximize',{});};
    window.addEventListener('mousedown',down);window.addEventListener('mousemove',move);window.addEventListener('mouseup',up);window.addEventListener('dblclick',double);
    return()=>{window.removeEventListener('mousedown',down);window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up);window.removeEventListener('dblclick',double);};
  },[]);
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [connection,setConnection]=useState(''),[name,setName]=useState('My computer');
  const [disconnected,setDisconnected]=useState(false);
  const refresh=()=>{setError('');local('status').then(s=>{setStatus(s);setName(s.device_name||'My computer')}).catch(e=>setError(e.message))};
  useEffect(()=>{refresh();const rejected=()=>setDisconnected(true);window.addEventListener('desktop-session-rejected',rejected);window.addEventListener('panel-auth-changed',refresh);return()=>{window.removeEventListener('desktop-session-rejected',rejected);window.removeEventListener('panel-auth-changed',refresh)}},[]);
  async function unlink(){setBusy(true);setError('');try{await local('unlink',{});window.location.assign('/')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  const titlebar=<DesktopTitlebar status={status}/>;
  if(!status)return <>{titlebar}<main className="desktop-connect"><Card><h1>Opening Voltra</h1>{error?<><ErrorBox>{error}</ErrorBox><Button onClick={refresh}>Retry</Button></>:<Loading/>}</Card></main></>;
  if(!status.linked&&location.pathname==='/account/app')return <>{titlebar}<main className="desktop-connect"><DesktopAppInfo/></main></>;
  if(status.linked&&!disconnected)return <>{titlebar}{error&&<div className="desktop-banner"><ErrorBox>{error}</ErrorBox></div>}{children}</>;
  return <>{titlebar}<main className="desktop-connect"><Card>
    <div className="desktop-brand"><BrandMark/><span>Voltra desktop</span></div>
    <h1>{disconnected?'Link this computer again':'Connect your account'}</h1>
    <p className="muted">In your web account, open Desktop apps and create a pairing code. Copy the connection string and paste it here to use the same servers and account.</p>
    {disconnected&&<ErrorBox>This desktop session has expired or was revoked. Create a new pairing code in your web account.</ErrorBox>}
    <ErrorBox>{error||status.storage_error}</ErrorBox>
    <form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await local('link',{...parseDesktopPairing(connection),name});window.location.assign('/')}catch(failure){setError((failure as Error).message)}finally{setBusy(false)}}}>
      <Field label="Connection string" hint="Includes the panel address and pairing code in one paste."><Input required autoComplete="off" spellCheck={false} placeholder="Paste your Voltra connection string" value={connection} onChange={e=>setConnection(e.target.value)} disabled={busy}/></Field>
      <Field label="Computer name" hint="Shown in your account so you can revoke this computer's access."><Input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></Field>
      <Button type="submit" disabled={busy}>{busy?'Connecting...':'Connect account'}</Button>
      {status.linked&&<Button variant="secondary" disabled={busy} onClick={()=>void unlink()}>Forget this connection</Button>}
    </form>

  </Card></main></>;
}
