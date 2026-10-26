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
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(''),[selected,setSelected]=useState('');
 const [savedInspection,setSavedInspection]=useState<{name:string;products:Inspection['products']}|null>(null);
 const all=records.data?rows(records.data).filter(record=>record.provider==='game_license'):[];
 const templates=eggs.data?rows(eggs.data):[];
 const targets=servers.data?rows(servers.data).filter(server=>templates.some(egg=>egg.id===(server.egg??server.egg_id)&&egg.features?.includes('voltra_fs25'))):[];
 return <div className="admin-infrastructure integrations-page">
  <IntegrationHeader title="Game licences" description="Manage game and DLC keys for the whole panel, including future servers. Keys stay encrypted and hidden. Existing servers change only when you explicitly apply saved licences."/>
  <ErrorBox>{error||records.error||eggs.error||servers.error}</ErrorBox>{success&&<p role="status">{success}</p>}
  <Card className="fs25-licences"><h3>Identify and add a GIANTS key</h3>
   <p>Don’t know the DLC name? Enter the key and look it up. GIANTS shows which Windows FS25 products it unlocks. One season-pass key can cover several packs.</p>
   <form autoComplete="off" onSubmit={async event=>{
    event.preventDefault();if(busy||!inspection)return;setBusy(true);setError('');setSuccess('');
    try {await api('/api/admin/integrations',{method:'POST',body:JSON.stringify({name,provider:'game_license',enabled:true,egg_id:inspection.egg_id,credentials:{license_key:key},bindings:{license_key:[inspection.kind==='game'?'GAME_SERIAL':'DLC_PRODUCT_KEY']}})});setKey('');setName('');setInspection(null);records.reload();eggs.reload();setSuccess('Licence saved globally. Add another key, use it for a new server, or apply saved licences below.');}
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
   <p className="muted">Looking up a key does not save it, download game files, or activate anything. Steam codes are not GIANTS download keys.</p>
   <Link to="/admin/integrations/new?provider=game_license">Add a licence manually for another game</Link>
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
  <Card className="fs25-licences"><h3>Existing servers</h3><p>New servers use available saved licences automatically. To update an existing FS25 server, select it here. A licence already assigned to another server cannot be silently reused.</p>
   <label>Server<Select aria-label="Licence target server" value={selected} onChange={event=>setSelected(event.target.value)}><option value="">Select a server</option>{targets.map(server=><option key={server.id} value={server.id}>{server.name}</option>)}</Select></label>
   {!servers.loading&&!targets.length&&<p className="muted">No FS25 servers yet. You can save keys above before creating a server.</p>}
  </Card>
  {selected&&<FS25Licences key={selected} serverID={Number(selected)}/>}
 </div>;
}
