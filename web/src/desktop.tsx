import {DesktopUpdatesEnabled} from './DesktopUpdateControl';
import {Feedback} from './notifications';
import {confirmAction} from './ui/ConfirmAction';
import {ActionButton as MiraAction} from './ui/ActionButton';
import {useEffect,useState,type ReactNode} from 'react';
import {Button,Card,ErrorBox,Field,Input,Loading,Modal,Select} from './lib';
import './desktop.css';
import BrandMark from './BrandMark';
import {parseDesktopPairing} from './desktopPairing';
import {Link} from 'react-router-dom';
import {formatDesktopVersion,startUpdateChecks,updateAction,updateChannels,useDesktopUpdates} from './desktopUpdates';
import {installDesktopWindowGestures} from './desktopWindowGestures';
import {SettingsRow,SettingsSection} from './ui/Settings';

type Status={linked:boolean;panel_url:string;device_name:string;version:string;updates_enabled:boolean;storage_error?:string};
async function local<T=Status>(path:string,body?:unknown):Promise<T>{
  const response=await fetch(`/desktop/${path}`,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'The desktop request failed.');
  return data;
}

export function DesktopAppInfo(){
  const [app,setApp]=useState<Status|null>(null),[error,setError]=useState('');
  const {status,busy,checkedAt}=useDesktopUpdates();
  useEffect(()=>{void local('status').then(setApp).catch(e=>setError(e.message))},[]);
  if(import.meta.env.VITE_DESKTOP!=='true')return null;
  return <section className="desktop-app-info settings-page">
    <ErrorBox>{error}</ErrorBox>
    <SettingsSection title="App & updates">
    <SettingsRow label="Version" control={<span className="settings-value">{app?formatDesktopVersion(app.version):'…'}</span>}/>
    {app?.updates_enabled?<>
      <SettingsRow label="Update channel" description="Release includes stable and beta builds. Nightly contains nightly builds only." control={<Select aria-label="Update channel" value={status?.channel||'release'} disabled={busy||status?.state==='ready'} onChange={async e=>{const channel=e.target.value;if(await confirmAction({title:"Switch channel?",description:'Switch update channel? The selected channel may offer an older version. You must still choose Update now and restart to apply it.',confirmLabel:"Switch channel",danger:false}))void updateAction('update-channel',{channel}).then(changed=>{if(changed)void updateAction('updates')})}}>{updateChannels.map(channel=><option key={channel.value} value={channel.value}>{channel.label}</option>)}</Select>}/>
      <SettingsRow label="Updates" description={checkedAt?`Last checked ${new Date(checkedAt).toLocaleTimeString()}. Check now bypasses the hourly timer.`:'Check now queries the selected channel immediately.'} control={<div className="desktop-app-actions"><Button variant="secondary" disabled={busy||status?.state==='ready'} onClick={()=>void updateAction('updates')}>{busy?'Working...':'Check now'}</Button>
      {status?.state==='ready'&&<Button disabled={busy} onClick={()=>void updateAction('update-restart')}>Restart to update</Button>}</div>}>{status?.state==='up-to-date'&&<span className="settings-note" role="status">No newer build on {status.channel==='release'?'Release':'Nightly'}.{status.channel==='release'?' Nightly builds appear only on Nightly.':''}</span>}</SettingsRow>
      {status?.state==='available'&&<SettingsRow label={`Version available ${formatDesktopVersion(status.available_version||'')}`} description="Download the update, then restart when you are ready." control={<Button disabled={busy} onClick={()=>void updateAction('update-install')}>{busy?'Downloading...':'Update now'}</Button>}/>}
    </>:<><SettingsRow label="Update channel" control={<Select aria-label="Update channel" disabled value="release">{updateChannels.map(channel=><option key={channel.value} value={channel.value}>{channel.label}</option>)}</Select>}/><SettingsRow label="Updates" description="This executable was built without signed updates. Replace it once with an updater-enabled build." control={<a href="https://github.com/Veky121/voltra/releases" target="_blank" rel="noreferrer">Download Voltra</a>}/></>}
    </SettingsSection>
    <SettingsSection title="Troubleshooting"><SettingsRow label="Desktop diagnostics" description="View build details or unlink this computer. Shortcut: Ctrl+Shift+T." control={<Button variant="secondary" onClick={()=>window.dispatchEvent(new Event('desktop-troubleshoot-requested'))}>Open troubleshooting</Button>}/></SettingsSection>
  </section>;
}

function requestDesktopUnlink(){window.dispatchEvent(new Event('desktop-unlink-requested'));}

export function DesktopRecoveryActions(){
  if(import.meta.env.VITE_DESKTOP!=='true')return null;
  return <Button variant="secondary" onClick={requestDesktopUnlink}>Unlink panel</Button>;
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
    {error&&<Feedback tone="error" message={<>Window control failed</>}/>}
    <MiraAction type="button" aria-label="Minimize window" title="Minimize" onClick={()=>void act('minimize')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10"/></svg></MiraAction>
    <MiraAction type="button" aria-label={maximized?'Restore window':'Maximize window'} title={maximized?'Restore':'Maximize'} onClick={()=>void act('maximize')}><svg viewBox="0 0 16 16" aria-hidden="true">{maximized?<><path d="M5 5V3h8v8h-2"/><rect x="3" y="5" width="8" height="8"/></>:<rect x="3" y="3" width="10" height="10"/>}</svg></MiraAction>
    <MiraAction type="button" className="desktop-window-close" aria-label="Close window" title="Close" onClick={()=>void act('close')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13"/></svg></MiraAction>
  </div>;
}

function DesktopTitlebar({maximized,onMaximizedChange}:{maximized:boolean;onMaximizedChange:(value:boolean)=>void}){
  return <header className="desktop-chrome">
    <div className="desktop-resize-right" aria-hidden="true"/>
    <WindowControls maximized={maximized} onMaximizedChange={onMaximizedChange}/>
  </header>;
}

export default function DesktopGate({children}:{children:ReactNode}){
  const [maximized,setMaximized]=useState(false);
  useEffect(()=>{
    const invoke=(message:string)=>(window as Window&{_wails?:{invoke?:(message:string)=>void}})._wails?.invoke?.(message);
    return installDesktopWindowGestures(window,invoke,()=>!maximized,()=>{void local<{maximized:boolean}>('window/maximize',{}).then(state=>setMaximized(state.maximized)).catch(()=>{});});
  },[maximized]);
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [connection,setConnection]=useState(''),[name,setName]=useState('My computer');
  const [disconnected,setDisconnected]=useState(false);
  const [confirmUnlink,setConfirmUnlink]=useState(false);
  const [troubleshooting,setTroubleshooting]=useState(false);
  useEffect(()=>{if(status?.updates_enabled)return startUpdateChecks()},[status?.updates_enabled]);
  useEffect(()=>{
    const open=()=>setTroubleshooting(true);
    const shortcut=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.shiftKey&&!event.altKey&&event.code==='KeyT'&&!event.repeat){event.preventDefault();open();}};
    window.addEventListener('keydown',shortcut);window.addEventListener('desktop-troubleshoot-requested',open);
    return()=>{window.removeEventListener('keydown',shortcut);window.removeEventListener('desktop-troubleshoot-requested',open)};
  },[]);
  const refresh=()=>{setError('');local('status').then(s=>{setStatus(s);setName(s.device_name||'My computer')}).catch(e=>setError(e.message))};
  useEffect(()=>{refresh();const rejected=()=>setDisconnected(true),requestUnlink=()=>setConfirmUnlink(true);window.addEventListener('desktop-session-rejected',rejected);window.addEventListener('panel-auth-changed',refresh);window.addEventListener('desktop-unlink-requested',requestUnlink);return()=>{window.removeEventListener('desktop-session-rejected',rejected);window.removeEventListener('panel-auth-changed',refresh);window.removeEventListener('desktop-unlink-requested',requestUnlink)}},[]);
  async function unlink(){setBusy(true);setError('');try{await local('unlink',{});window.location.assign('/')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  const unlinkDialog=confirmUnlink&&<Modal title="Unlink panel?" onClose={()=>{if(!busy)setConfirmUnlink(false)}}><p>This removes the saved connection from this computer. You can connect to another panel with a new connection string.</p><p className="muted">{status?.panel_url}</p><ErrorBox>{error}</ErrorBox><div className="actions"><Button variant="secondary" disabled={busy} onClick={()=>setConfirmUnlink(false)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={()=>void unlink()}>{busy?'Unlinking…':'Unlink panel'}</Button></div></Modal>;
  const titlebar=<><DesktopTitlebar maximized={maximized} onMaximizedChange={setMaximized}/>{troubleshooting&&<Modal title="Troubleshooting" onClose={()=>setTroubleshooting(false)}>
    <SettingsSection title="Desktop"><SettingsRow label="Build" control={<span className="settings-value">{status?.version||'Unavailable'}</span>}/><SettingsRow label="Panel" control={<span className="desktop-app-panel">{status?.panel_url||'Not connected'}</span>}/></SettingsSection>
    <ErrorBox>{error||status?.storage_error}</ErrorBox>
    <div className="actions"><Button variant="secondary" onClick={()=>window.location.reload()}>Reload app</Button>{status?.linked&&<><Link className="button secondary" to="/account/app" onClick={()=>setTroubleshooting(false)}>App &amp; updates</Link><Button variant="danger" disabled={busy} onClick={()=>{setTroubleshooting(false);setConfirmUnlink(true)}}>Unlink panel</Button></>}</div>
  </Modal>}</>;
  if(!status)return <>{titlebar}{unlinkDialog}<main className="desktop-connect"><Card><h1>Opening Voltra</h1>{error?<><ErrorBox>{error}</ErrorBox><Button onClick={refresh}>Retry</Button></>:<Loading/>}</Card></main></>;
  if(status.linked&&!disconnected)return <>{titlebar}{unlinkDialog}{error&&<div className="desktop-banner"><ErrorBox>{error}</ErrorBox></div>}<DesktopUpdatesEnabled.Provider value={status.updates_enabled}>{children}</DesktopUpdatesEnabled.Provider></>;
  return <>{titlebar}{unlinkDialog}<main className="desktop-connect"><Card>
    <div className="desktop-brand"><BrandMark/><span>Voltra desktop</span></div>
    <h1>{disconnected?'Link this computer again':'Connect your account'}</h1>
    <p className="muted">Create a connection string in Account → Desktop apps.</p>
    {disconnected&&<ErrorBox>This desktop session has expired or was revoked. Create a new pairing code in your web account.</ErrorBox>}
    <ErrorBox>{error||status.storage_error}</ErrorBox>
    <form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await local('link',{...parseDesktopPairing(connection),name});window.location.assign('/')}catch(failure){setError((failure as Error).message)}finally{setBusy(false)}}}>
      <Field label="Connection string"><Input required autoComplete="off" spellCheck={false} placeholder="Paste connection string" value={connection} onChange={e=>setConnection(e.target.value)} disabled={busy}/></Field>
      <Field label="Computer name"><Input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></Field>
      <Button type="submit" disabled={busy}>{busy?'Connecting...':'Connect account'}</Button>
      {status.linked&&<Button variant="secondary" disabled={busy} onClick={()=>setConfirmUnlink(true)}>Forget this connection</Button>}
    </form>

  </Card></main></>;
}
