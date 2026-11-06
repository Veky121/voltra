import {createContext,useContext,useState} from 'react';
import {ArrowDownToLine,RefreshCw,RotateCw} from 'lucide-react';
import {Button,Modal} from './lib';
import {ActionButton} from './ui/ActionButton';
import {Feedback} from './notifications';
import {notifications} from './notificationEvents';
import {formatDesktopVersion,updateAction,useDesktopUpdates} from './desktopUpdates';

export const DesktopUpdatesEnabled=createContext(false);

export function DesktopUpdateControl(){
 const enabled=useContext(DesktopUpdatesEnabled);
 const {status,busy,operation,error}=useDesktopUpdates();
 const [open,setOpen]=useState(false);
 if(!enabled)return null;
 const available=status?.state==='available',ready=status?.state==='ready';
 const activity=operation==='update-install'?'Downloading update':operation==='update-restart'?'Restarting app':'Checking for updates';
 const label=busy?activity:ready?'Restart to update':available?'App update available':'Check for app updates';
 async function check(){
  if(available||ready){setOpen(true);return;}
  const checked=await updateAction('updates');
  if(checked)notifications.publish({key:'desktop-update-check',title:'Update check complete',message:'The app update status has been refreshed.',tone:'success'});
 }
 return <>
  <ActionButton type="button" className="desktop-account-update" data-available={available||ready||undefined} aria-label={label} title={label} aria-busy={busy} disabled={busy} onClick={()=>void check()}>
   {busy?<RefreshCw className="desktop-update-spinner" aria-hidden="true"/>:ready?<RotateCw aria-hidden="true"/>:available?<ArrowDownToLine aria-hidden="true"/>:<RefreshCw aria-hidden="true"/>}
  </ActionButton>
  <Feedback id="desktop-update-error" title="App update failed" tone="error" message={error||status?.error}/>
  {open&&<Modal title={ready?'Ready to restart':'Update Voltra'} onClose={()=>setOpen(false)}>
   <p>{ready?'Ready to install':'Version available'} <strong>{formatDesktopVersion(status?.available_version||'')}</strong></p>
   <p className="muted">{ready?'Restart Voltra to finish installing the update.':`Download the update from ${status?.channel==='nightly'?'Nightly':'Release'}. You can restart when you are ready.`}</p>
   <div className="actions"><Button variant="secondary" onClick={()=>setOpen(false)}>Later</Button>
    <Button disabled={busy||(!available&&!ready)} onClick={()=>void updateAction(ready?'update-restart':'update-install')}>{busy?`${activity}...`:ready?'Restart now':'Update now'}</Button>
   </div>
  </Modal>}
 </>;
}
