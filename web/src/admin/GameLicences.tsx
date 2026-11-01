import {useErrorState} from '../notifications/useErrorState';
import {useState} from 'react';
import {Link} from 'react-router-dom';
import {api,Button,Card,ErrorBox,Input,Loading,Select,rows,unwrap,useAPI} from '../lib';
import {DataTable} from './shared';
import {IntegrationHeader} from './integrations';
import {FS25Licences} from './FS25Licences';
import './fs25Licences.css';

type Inspection={products:{name:string;kind:string}[];suggested_name:string;kind:string;egg_id:number};

export function GameLicences() {
 const records=useAPI('/api/admin/integrations'),eggs=useAPI('/api/admin/eggs'),servers=useAPI('/api/application/servers?per_page=100');
 const [key,setKey]=useState(''),[name,setName]=useState(''),[inspection,setInspection]=useState<Inspection|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useErrorState('admin/GameLicences.tsx'),[success,setSuccess]=useState(''),[selected,setSelected]=useState('');
 const [savedInspection,setSavedInspection]=useState<{name:string;products:Inspection['products']}|null>(null);
 const all=records.data?rows(records.data).filter(record=>record.provider==='game_license'):[];
 const templates=eggs.data?rows(eggs.data):[];
 const targets=servers.data?rows(servers.data).filter(server=>templates.some(egg=>egg.id===(server.egg??server.egg_id)&&egg.features?.includes('voltra_fs25'))):[];
 return <div className="admin-infrastructure integrations-page">
  <IntegrationHeader title="Game licences" description="Game and DLC keys. Apply saved keys to update existing servers."/>
  <ErrorBox>{error||records.error||eggs.error||servers.error}</ErrorBox>{success&&<p role="status">{success}</p>}
  <Card className="fs25-licences"><h3>Add a GIANTS key</h3>
   <p>Look up a key to see which FS25 games or DLC it unlocks.</p>
   <form autoComplete="off" onSubmit={async event=>{
    event.preventDefault();if(busy||!inspection)return;setBusy(true);setError('');setSuccess('');
    try {await api('/api/admin/integrations',{method:'POST',body:JSON.stringify({name,provider:'game_license',enabled:true,egg_id:inspection.egg_id,credentials:{license_key:key},bindings:{license_key:[inspection.kind==='game'?'GAME_SERIAL':'DLC_PRODUCT_KEY']}})});setKey('');setName('');setInspection(null);records.reload();eggs.reload();setSuccess('Licence saved. Apply it to an existing server below.');}
    catch(error){setError(error instanceof Error?error.message:'Could not save licence.');}finally{setBusy(false);}
   }}>
    <div className="fs25-licence-fields"><label>GIANTS product key<Input aria-label="GIANTS product key" type="password" autoComplete="new-password" required maxLength={128} disabled={busy} value={key} onChange={event=>{setKey(event.target.value);setInspection(null);setName('');}}/></label>
     <div className="fs25-lookup-action"><Button disabled={busy||!key.trim()} onClick={async()=>{
      if(busy)return;setBusy(true);setError('');setSuccess('');setInspection(null);
      try {const result=unwrap(await api('/api/admin/fs25/licences/inspect',{method:'POST',body:JSON.stringify({key})})) as Inspection;setInspection(result);setName(result.suggested_name);}
      catch(error){setError(error instanceof Error?error.message:'Could not identify the key.');}finally{setBusy(false);}
     }}>{busy?'Working...':'Look up key'}</Button></div>
    </div>
    {inspection&&<><p>GIANTS offers:</p><ul>{inspection.products.map((product,index)=><li key={index}>{product.name}{product.kind==='game'?' · Base game':' · DLC'}</li>)}</ul>
     <label>Licence name<Input aria-label="Licence name" required maxLength={191} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/></label>
     <div className="actions"><Button type="submit" disabled={busy||!name.trim()}>Save licence</Button></div></>}
   </form>
   <p className="muted">Lookup does not save or activate the key. Requires a GIANTS key, not a Steam code.</p>
   <Link to="/admin/integrations/new?provider=game_license">Add another game?s licence</Link>
  </Card>
  <Card><h3>Saved licences</h3>{records.loading?<Loading/>:<DataTable data={all} empty="No game licences saved yet." columns={[
   {label:'Name',render:record=><Link to={`/admin/integrations/${record.id}`}>{record.name}</Link>},
   {label:'Game',render:record=>templates.find(egg=>egg.id===record.egg_id)?.features?.includes('voltra_fs25')?'Farming Simulator 25':templates.find(egg=>egg.id===record.egg_id)?.name||'Game template'},
   {label:'Type',render:record=>record.bindings?.license_key?.includes('DLC_PRODUCT_KEY')?'DLC / season pass':'Game'},
   {label:'Status',render:record=>record.enabled?'Enabled':'Disabled'},
   {label:'Actions',render:record=><><Link to={`/admin/integrations/${record.id}`}>Configure</Link>{templates.find(egg=>egg.id===record.egg_id)?.features?.includes('voltra_fs25')&&<Button variant="secondary" disabled={busy} onClick={async()=>{
    setBusy(true);setError('');try{const result=unwrap(await api('/api/admin/fs25/licences/inspect',{method:'POST',body:JSON.stringify({integration_id:record.id})})) as Inspection;setSavedInspection({name:record.name,products:result.products});}catch(error){setError(error instanceof Error?error.message:'Could not inspect licence.');}finally{setBusy(false);}
   }}>Check products</Button>}</>},
  ]}/>} {savedInspection&&<div role="status"><h4>{savedInspection.name} includes</h4><ul>{savedInspection.products.map((product,index)=><li key={index}>{product.name}</li>)}</ul></div>}</Card>
  <Card className="fs25-licences"><h3>Existing servers</h3><p>New servers use saved keys automatically. Select an existing FS25 server to apply keys. Assigned licences cannot be reused automatically.</p>
   <label>Server<Select aria-label="Licence target server" value={selected} onChange={event=>setSelected(event.target.value)}><option value="">Select a server</option>{targets.map(server=><option key={server.id} value={server.id}>{server.name}</option>)}</Select></label>
   {!servers.loading&&!targets.length&&<p className="muted">No FS25 servers yet. You can still save keys above.</p>}
  </Card>
  {selected&&<FS25Licences key={selected} serverID={Number(selected)}/>}
 </div>;
}
