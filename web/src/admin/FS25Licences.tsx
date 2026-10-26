import {useState} from 'react';
import {api,Button,Card,ErrorBox,unwrap,useAPI} from '../lib';
import './fs25Licences.css';

// Assignment is shown only on the global licence page; keys are created there.
export function FS25Licences({serverID}:{serverID:number}) {
 const endpoint=`/api/admin/servers/${serverID}/fs25/licences`,query=useAPI(endpoint);
 const data=query.data?unwrap(query.data):null;
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 return <Card className="fs25-licences"><h3>Apply to the selected server</h3>
  <ErrorBox>{error||query.error}</ErrorBox>{success&&<p role="status">{success}</p>}
  {!data&&!query.error&&<p>Loading assigned licences...</p>}
  {data&&<><p>Game licence: {data.game_configured?'Configured':'Not configured'}. Assigned DLC licences: {data.dlcs.length}.</p>
   {data.dlcs.length>0&&<ul>{data.dlcs.map((entry:{id:string;name:string})=><li key={entry.id}>{entry.name}</li>)}</ul>}
   <Button disabled={busy||!Object.keys(data.available||{}).length} onClick={async()=>{
    if(busy)return;setBusy(true);setError('');setSuccess('');
    try {await api(endpoint,{method:'PUT',body:'{}'});query.reload();setSuccess('Saved licences applied to this server for its next start. The running game was not restarted.');}
    catch(error){setError(error instanceof Error?error.message:'Could not apply licences.');}finally{setBusy(false);}
   }}>Apply saved licences</Button>
   <p className="muted">This updates only the selected server. Keys remain in the global Admin store. Applying DLC keys enables their downloads for the next start.</p>
  </>}
 </Card>;
}
