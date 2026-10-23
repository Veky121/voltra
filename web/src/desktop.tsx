import {useEffect,useState,type ReactNode} from 'react';
import {Button,Card,ErrorBox,Field,Input,Loading,Select} from './lib';
import './desktop.css';
import BrandMark from './BrandMark';
import {parseDesktopPairing} from './desktopPairing';

type Status={linked:boolean;panel_url:string;device_name:string;version:string;updates_enabled:boolean;storage_error?:string};
async function local<T=Status>(path:string,body?:unknown):Promise<T>{
  const response=await fetch(`/desktop/${path}`,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'The desktop request failed.');
  return data;
}

type UpdateStatus={channel:string;state:string;version:string;available_version?:string;error?:string};
function DesktopUpdates({enabled}:{enabled:boolean}){
  const [status,setStatus]=useState<UpdateStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(enabled)void local<UpdateStatus>('update-status').then(setStatus).catch(e=>setError(e.message))},[enabled]);
  async function act(path:string,body:unknown={}){setBusy(true);setError('');try{setStatus(await local<UpdateStatus>(path,body))}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  if(!enabled)return <small>Updates are not configured for this build.</small>;
  return <div className="actions" aria-live="polite">
    <Select aria-label="Update channel" value={status?.channel||'stable'} disabled={busy||!status||status.state==='ready'} onChange={e=>void act('update-channel',{channel:e.target.value})}>
      <option value="stable">Stable</option><option value="beta">Beta (opt in)</option><option value="nightly">Nightly (opt in)</option>
    </Select>
    <Button variant="secondary" disabled={busy||status?.state==='ready'} onClick={()=>void act('updates')}>{busy?'Working...':'Check for updates'}</Button>
    {status?.state==='up-to-date'&&<small>No newer update in this channel.</small>}
    {status?.state==='available'&&<><small>Version {status.available_version} is available.</small><Button disabled={busy} onClick={()=>void act('update-install')}>Download and install</Button></>}
    {status?.state==='ready'&&<><small>Update verified and ready.</small><Button disabled={busy} onClick={()=>void act('update-restart')}>Restart to apply update</Button></>}
    {(error||status?.error)&&<ErrorBox>{error||status?.error}</ErrorBox>}
  </div>;
}

export default function DesktopGate({children}:{children:ReactNode}){
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [connection,setConnection]=useState(''),[name,setName]=useState('My computer');
  const [disconnected,setDisconnected]=useState(false);
  const refresh=()=>{setError('');local('status').then(s=>{setStatus(s);setName(s.device_name||'My computer')}).catch(e=>setError(e.message))};
  useEffect(()=>{refresh();const rejected=()=>setDisconnected(true);window.addEventListener('desktop-session-rejected',rejected);window.addEventListener('panel-auth-changed',refresh);return()=>{window.removeEventListener('desktop-session-rejected',rejected);window.removeEventListener('panel-auth-changed',refresh)}},[]);
  async function unlink(){setBusy(true);setError('');try{await local('unlink',{});window.location.assign('/')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  if(!status)return <main className="desktop-connect"><Card><h1>Opening Voltra</h1>{error?<><ErrorBox>{error}</ErrorBox><Button onClick={refresh}>Retry</Button></>:<Loading/>}</Card></main>;
  if(status.linked&&!disconnected)return <><div className="desktop-bar"><span>Voltra desktop <small>{status.version} · {status.panel_url}</small></span><div className="actions"><DesktopUpdates enabled={status.updates_enabled}/><Button variant="secondary" disabled={busy} onClick={()=>{if(confirm('Unlink this desktop? You can pair it again from your web account.'))void unlink()}}>Unlink</Button></div></div>{error&&<ErrorBox>{error}</ErrorBox>}{children}</>;
  return <main className="desktop-connect"><Card>
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
    <DesktopUpdates enabled={status.updates_enabled}/><p className="muted desktop-version">Version {status.version}. {status.updates_enabled?'Choose a channel and check for updates below.':'Updates will be enabled when releases are configured.'}</p>
  </Card></main>;
}
