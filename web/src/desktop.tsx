import {useEffect,useState,type ReactNode} from 'react';
import {Button,Card,ErrorBox,Field,Input,Loading,Select} from './lib';
import './desktop.css';
import BrandMark from './BrandMark';
import {parseDesktopPairing} from './desktopPairing';
import {Link,useLocation} from 'react-router-dom';
import {startUpdateChecks,updateAction,useDesktopUpdates} from './desktopUpdates';
import {installDesktopWindowGestures} from './desktopWindowGestures';
import {SettingsRow,SettingsSection} from './ui/Settings';

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
  return <section className="desktop-app-info settings-page">
    {app&&!app.linked&&<Link to="/">Back to connection</Link>}
    <ErrorBox>{error||updateError||status?.error}</ErrorBox>
    <SettingsSection title="App & updates">
    <SettingsRow label="Version" control={<span className="settings-value">{app?`Voltra ${app.version}`:'…'}</span>}/>
    {app?.updates_enabled?<>
      <SettingsRow label="Update channel" control={<Select aria-label="Update channel" value={status?.channel||'stable'} disabled={busy||!status||status.state==='ready'} onChange={e=>void updateAction('update-channel',{channel:e.target.value}).then(()=>updateAction('updates'))}><option value="stable">Stable</option><option value="beta">Beta</option><option value="nightly">Nightly</option></Select>}/>
      <SettingsRow label="Updates" description={checkedAt?`Last checked ${new Date(checkedAt).toLocaleTimeString()}`:undefined} control={<div className="desktop-app-actions"><Button variant="secondary" disabled={busy||status?.state==='ready'} onClick={()=>void updateAction('updates')}>{busy?'Checking…':'Check for updates'}</Button>
      {status?.state==='available'&&<Button disabled={busy} onClick={()=>void updateAction('update-install')}>Install {status.available_version}</Button>}
      {status?.state==='ready'&&<Button disabled={busy} onClick={()=>void updateAction('update-restart')}>Restart to update</Button>}</div>}>{status?.state==='up-to-date'&&<span className="settings-note" role="status">Up to date</span>}</SettingsRow>
    </>:<SettingsRow label="Updates" control={<span className="settings-value">Not configured</span>}/>}
    </SettingsSection>
    <SettingsSection title="Connection"><SettingsRow label="Panel" control={<span className="settings-value desktop-app-panel">{app?.panel_url||'Not connected'}</span>}/>
    {app?.linked&&<SettingsRow label="This computer" control={<Button variant="danger" disabled={unlinking} onClick={()=>void unlink()}>{unlinking?'Unlinking…':'Unlink'}</Button>}/>}
    </SettingsSection>
  </section>;
}

function WindowControls({maximized,onMaximizedChange}:{maximized:boolean;onMaximizedChange:(value:boolean)=>void}){
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true,timer:ReturnType<typeof setTimeout>;
    const refresh=()=>{void local<{maximized:boolean}>('window').then(state=>{if(active)onMaximizedChange(state.maximized)}).catch(()=>{});};
    const resized=()=>{clearTimeout(timer);timer=setTimeout(refresh,120);};
    refresh();window.addEventListener('resize',resized);
    return()=>{active=false;clearTimeout(timer);window.removeEventListener('resize',resized);};
  },[onMaximizedChange]);
  async function act(action:string){setError('');try{const state=await local<{maximized:boolean}>(`window/${action}`,{});onMaximizedChange(state.maximized);}catch(failure){setError((failure as Error).message);}}
  return <div className="desktop-window-controls" aria-label="Window controls" title={error||undefined}>
    {error&&<span className="desktop-update-error" role="alert">Window control failed</span>}
    <button type="button" aria-label="Minimize window" title="Minimize" onClick={()=>void act('minimize')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10"/></svg></button>
    <button type="button" aria-label={maximized?'Restore window':'Maximize window'} title={maximized?'Restore':'Maximize'} onClick={()=>void act('maximize')}><svg viewBox="0 0 16 16" aria-hidden="true">{maximized?<><path d="M5 5V3h8v8h-2"/><rect x="3" y="5" width="8" height="8"/></>:<rect x="3" y="3" width="10" height="10"/>}</svg></button>
    <button type="button" className="desktop-window-close" aria-label="Close window" title="Close" onClick={()=>void act('close')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13"/></svg></button>
  </div>;
}

function DesktopTitlebar({status,maximized,onMaximizedChange}:{status:Status|null;maximized:boolean;onMaximizedChange:(value:boolean)=>void}){
  return <header className="desktop-bar">
    <div className="desktop-title"><BrandMark/><span>Voltra</span>{status&&<span className="desktop-version-label">v{status.version}</span>}{status?.linked&&<span className="desktop-panel-address" title={status.panel_url}>{status.panel_url}</span>}</div>
    <div className="desktop-title-actions">{status&&<DesktopUpdates enabled={status.updates_enabled}/>} <Link className="button secondary" to="/account/app">App &amp; updates</Link></div>
    <WindowControls maximized={maximized} onMaximizedChange={onMaximizedChange}/>
  </header>;
}

export default function DesktopGate({children}:{children:ReactNode}){
  const location=useLocation();
  const [maximized,setMaximized]=useState(false);
  useEffect(()=>{
    const invoke=(message:string)=>(window as Window&{_wails?:{invoke?:(message:string)=>void}})._wails?.invoke?.(message);
    return installDesktopWindowGestures(window,invoke,()=>!maximized,()=>{void local<{maximized:boolean}>('window/maximize',{}).then(state=>setMaximized(state.maximized)).catch(()=>{});});
  },[maximized]);
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [connection,setConnection]=useState(''),[name,setName]=useState('My computer');
  const [disconnected,setDisconnected]=useState(false);
  const refresh=()=>{setError('');local('status').then(s=>{setStatus(s);setName(s.device_name||'My computer')}).catch(e=>setError(e.message))};
  useEffect(()=>{refresh();const rejected=()=>setDisconnected(true);window.addEventListener('desktop-session-rejected',rejected);window.addEventListener('panel-auth-changed',refresh);return()=>{window.removeEventListener('desktop-session-rejected',rejected);window.removeEventListener('panel-auth-changed',refresh)}},[]);
  async function unlink(){setBusy(true);setError('');try{await local('unlink',{});window.location.assign('/')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  const titlebar=<DesktopTitlebar status={status} maximized={maximized} onMaximizedChange={setMaximized}/>;
  if(!status)return <>{titlebar}<main className="desktop-connect"><Card><h1>Opening Voltra</h1>{error?<><ErrorBox>{error}</ErrorBox><Button onClick={refresh}>Retry</Button></>:<Loading/>}</Card></main></>;
  if(!status.linked&&location.pathname==='/account/app')return <>{titlebar}<main className="desktop-connect"><DesktopAppInfo/></main></>;
  if(status.linked&&!disconnected)return <>{titlebar}{error&&<div className="desktop-banner"><ErrorBox>{error}</ErrorBox></div>}{children}</>;
  return <>{titlebar}<main className="desktop-connect"><Card>
    <div className="desktop-brand"><BrandMark/><span>Voltra desktop</span></div>
    <h1>{disconnected?'Link this computer again':'Connect your account'}</h1>
    <p className="muted">Create a connection string in Account → Desktop apps.</p>
    {disconnected&&<ErrorBox>This desktop session has expired or was revoked. Create a new pairing code in your web account.</ErrorBox>}
    <ErrorBox>{error||status.storage_error}</ErrorBox>
    <form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await local('link',{...parseDesktopPairing(connection),name});window.location.assign('/')}catch(failure){setError((failure as Error).message)}finally{setBusy(false)}}}>
      <Field label="Connection string"><Input required autoComplete="off" spellCheck={false} placeholder="Paste connection string" value={connection} onChange={e=>setConnection(e.target.value)} disabled={busy}/></Field>
      <Field label="Computer name"><Input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></Field>
      <Button type="submit" disabled={busy}>{busy?'Connecting...':'Connect account'}</Button>
      {status.linked&&<Button variant="secondary" disabled={busy} onClick={()=>void unlink()}>Forget this connection</Button>}
    </form>

  </Card></main></>;
}
