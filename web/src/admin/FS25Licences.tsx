import {SettingsSection,SettingsRow} from '../ui/Settings';
import {useErrorState} from '../notifications/useErrorState';
import {useState} from 'react';
import {api,Button,ErrorBox,unwrap,useAPI} from '../lib';
import './fs25Licences.css';

// Assignment is shown only on the global licence page; keys are created there.
export function FS25Licences({serverID}:{serverID:number}) {
 const endpoint=`/api/admin/servers/${serverID}/fs25/licences`,query=useAPI(endpoint);
 const data=query.data?unwrap(query.data):null;
 const [busy,setBusy]=useState(false),[error,setError]=useErrorState('admin/FS25Licences.tsx'),[success,setSuccess]=useState('');
 return <SettingsSection title="Assigned licences" className="fs25-licences">
  <ErrorBox>{error||query.error}</ErrorBox>{success&&<p role="status">{success}</p>}
  {!data&&!query.error&&<p>Loading assigned licences...</p>}
  {data&&<><div className="settings-options-grid"><SettingsRow label="Game licence" control={<span>{data.game_configured?'Configured':'Not configured'}</span>}/><SettingsRow label="DLC licences" control={<span>{data.dlcs.length} assigned</span>}/></div>
   {data.dlcs.length>0&&<ul className="integration-products">{data.dlcs.map((entry:{id:string;name:string})=><li key={entry.id}>{entry.name}</li>)}</ul>}
   <SettingsRow label="Apply saved keys" description="Updates this server for its next start. The running game is not restarted." control={<Button disabled={busy||!Object.keys(data.available||{}).length} onClick={async()=>{
    if(busy)return;setBusy(true);setError('');setSuccess('');
    try {await api(endpoint,{method:'PUT',body:'{}'});query.reload();setSuccess('Saved licences applied to this server for its next start. The running game was not restarted.');}
    catch(error){setError(error instanceof Error?error.message:'Could not apply licences.');}finally{setBusy(false);}
   }}>Apply saved licences</Button>}/>
   <p className="settings-note">DLC downloads become available on the next start.</p>
  </>}
 </SettingsSection>;
}
