import {IntegrationLayout} from './IntegrationLayout';
import {SettingsSection,SettingsRow} from '../ui/Settings';
import {useErrorState} from '../notifications/useErrorState';
import {useState} from 'react';
import {Link} from 'react-router-dom';
import {api,Button,ErrorBox,Input,Loading,Select,rows,unwrap,useAPI} from '../lib';
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
 return <IntegrationLayout className="game-licences">
  <IntegrationHeader title="Game licences" description="Game and DLC keys for your servers."><Link className="button secondary" to="/admin/integrations/new?provider=game_license">Add another game licence</Link></IntegrationHeader>
  <ErrorBox>{error||records.error||eggs.error||servers.error}</ErrorBox>{success&&<p role="status">{success}</p>}
  <SettingsSection title="Add a GIANTS key" className="fs25-licences">
   <form autoComplete="off" onSubmit={async event=>{
    event.preventDefault();if(busy||!inspection)return;setBusy(true);setError('');setSuccess('');
    try {await api('/api/admin/integrations',{method:'POST',body:JSON.stringify({name,provider:'game_license',enabled:true,egg_id:inspection.egg_id,credentials:{license_key:key},bindings:{license_key:[inspection.kind==='game'?'GAME_SERIAL':'DLC_PRODUCT_KEY']}})});setKey('');setName('');setInspection(null);records.reload();eggs.reload();setSuccess('Licence saved. Apply it to an existing server below.');}
    catch(error){setError(error instanceof Error?error.message:'Could not save licence.');}finally{setBusy(false);}
   }}>
    <div className="settings-options-grid"><SettingsRow label="GIANTS product key" description="Check which FS25 game or DLC your key unlocks." control={<Input aria-label="GIANTS product key" type="password" autoComplete="new-password" required maxLength={128} disabled={busy} value={key} onChange={event=>{setKey(event.target.value);setInspection(null);setName('');}}/>}/>
     <SettingsRow label="Check products" description="Requires a GIANTS key, not a Steam activation code." control={<Button disabled={busy||!key.trim()} onClick={async()=>{
      if(busy)return;setBusy(true);setError('');setSuccess('');setInspection(null);
      try {const result=unwrap(await api('/api/admin/fs25/licences/inspect',{method:'POST',body:JSON.stringify({key})})) as Inspection;setInspection(result);setName(result.suggested_name);}
      catch(error){setError(error instanceof Error?error.message:'Could not identify the key.');}finally{setBusy(false);}
     }}>{busy?'Working...':'Look up key'}</Button>}/>
    </div>
    {inspection&&<><div className="integration-products"><h3>Included products</h3><ul>{inspection.products.map((product,index)=><li key={index}>{product.name}{product.kind==='game'?' · Base game':' · DLC'}</li>)}</ul></div>
     <SettingsRow label="Licence name" control={<Input aria-label="Licence name" required maxLength={191} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/>}/>
     <div className="settings-actions"><Button type="submit" disabled={busy||!name.trim()}>Save licence</Button></div></>}
   </form>
   <p className="settings-note">Looking up a key does not save or activate it.</p>

  </SettingsSection>
  <SettingsSection title="Saved licences" className="integration-records management-ui">{records.loading?<Loading/>:<DataTable data={all} empty="No game licences saved yet." columns={[
   {label:'Name',render:record=><Link to={`/admin/integrations/${record.id}`}>{record.name}</Link>},
   {label:'Game',render:record=>templates.find(egg=>egg.id===record.egg_id)?.features?.includes('voltra_fs25')?'Farming Simulator 25':templates.find(egg=>egg.id===record.egg_id)?.name||'Game template'},
   {label:'Type',render:record=>record.bindings?.license_key?.includes('DLC_PRODUCT_KEY')?'DLC / season pass':'Game'},
   {label:'Status',render:record=>record.enabled?'Enabled':'Disabled'},
   {label:'Actions',render:record=><><Link to={`/admin/integrations/${record.id}`}>Configure</Link>{templates.find(egg=>egg.id===record.egg_id)?.features?.includes('voltra_fs25')&&<Button variant="secondary" disabled={busy} onClick={async()=>{
    setBusy(true);setError('');try{const result=unwrap(await api('/api/admin/fs25/licences/inspect',{method:'POST',body:JSON.stringify({integration_id:record.id})})) as Inspection;setSavedInspection({name:record.name,products:result.products});}catch(error){setError(error instanceof Error?error.message:'Could not inspect licence.');}finally{setBusy(false);}
   }}>Check products</Button>}</>},
  ]}/>} {savedInspection&&<div role="status" className="integration-products"><h4>{savedInspection.name} includes</h4><ul>{savedInspection.products.map((product,index)=><li key={index}>{product.name}</li>)}</ul></div>}</SettingsSection>
  <SettingsSection title="Apply licences" className="fs25-licences">
   <SettingsRow label="Server" description="Choose an existing FS25 server. Assigned keys cannot be reused automatically." control={<Select aria-label="Licence target server" value={selected} onChange={event=>setSelected(event.target.value)}><option value="">Select a server</option>{targets.map(server=><option key={server.id} value={server.id}>{server.name}</option>)}</Select>}/>
   {!servers.loading&&!targets.length&&<p className="settings-note">No FS25 servers yet. You can still save keys above.</p>}
  </SettingsSection>
  {selected&&<FS25Licences key={selected} serverID={Number(selected)}/>}
 </IntegrationLayout>;
}
