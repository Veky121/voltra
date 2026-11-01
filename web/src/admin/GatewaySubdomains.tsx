import {usePendingSetting} from '../client/PendingSettings';
import {useErrorState} from '../notifications/useErrorState';
import {useState} from 'react';
import {api,Button,Input,Select,useAPI,unwrap} from '../lib';
import {ErrorMessage} from './shared';
import {SettingsRow,SettingsSection} from '../ui/Settings';

export function GatewaySubdomains({gateway}:{gateway:Record<string,any>}){
 const path=`/api/admin/proxy-gateways/${gateway.id}/subdomains`,query=useAPI(path),integrations=useAPI('/api/admin/integrations');
 const data=query.data?.attributes;
 const [domain,setDomain]=useState<string|null>(null),[integration,setIntegration]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useErrorState('admin/GatewaySubdomains.tsx');
 const [connecting,setConnecting]=useState(false),[token,setToken]=useState(''),[zone,setZone]=useState(''),[saved,setSaved]=useState(false);
 const providers=(integrations.data?.data||[]).map((i:any)=>i.attributes).filter((i:any)=>i.provider==='cloudflare'&&i.enabled&&!i.egg_id);
 const selectedDomain=(domain??data?.domain??'').trim(),selectedIntegration=integration??String(data?.integration_id??'');
 async function configure(id:string){await api(path,{method:'PUT',body:JSON.stringify({domain:selectedDomain,integration_id:Number(id)})});setSaved(true);query.reload();}
 async function save(){setBusy(true);setError('');setSaved(false);try{await api(path,{method:'PUT',body:JSON.stringify({domain:selectedDomain,integration_id:Number(selectedIntegration)})});setSaved(true)}catch(e){setError(e instanceof Error?e.message:String(e));throw e}finally{setBusy(false)}}
 const managed=usePendingSetting(`gateway-dns:${gateway.id}`,!connecting&&!!data&&(selectedDomain!==(data.domain??'')||selectedIntegration!==String(data.integration_id??'')),{blocked:busy||query.loading||!!query.error||!selectedDomain||!selectedIntegration,save,discard:()=>{setDomain(null);setIntegration(null);setSaved(false);setError('')},afterSave:()=>{setDomain(null);setIntegration(null);query.reload()}});

 async function connect(){
  setBusy(true);setError('');setSaved(false);
  try{
   const result=unwrap(await api('/api/admin/integrations',{method:'POST',body:JSON.stringify({name:`DNS for ${selectedDomain}`,provider:'cloudflare',enabled:true,egg_id:null,credentials:{api_token:token.trim(),zone_id:zone.trim()},bindings:{}})}));
   if(!result?.id)throw new Error('The integration was not confirmed. Check saved integrations before retrying.');
   const id=String(result.id);setIntegration(id);setToken('');setZone('');setConnecting(false);integrations.reload();
   await configure(id);
  }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 }
 return <SettingsSection title="Join domains" className="gateway-subdomains">
  <p className="settings-section-note">Set up once. Players can then choose a join name in Voltra. Renaming, clearing and deleting names updates DNS automatically.</p>
  <form onSubmit={e=>{e.preventDefault();void save().then(()=>{setDomain(null);setIntegration(null);query.reload()}).catch(()=>{})}}>
   <div className="settings-options-grid"><SettingsRow label="Domain" description={selectedDomain?`Example: play.friends.${selectedDomain}`:'Your domain or a subdomain, without https:// or a port.'} control={<Input aria-label="Join domain" required value={domain??data?.domain??''} disabled={busy||query.loading} placeholder="example.org" onChange={e=>{setDomain(e.target.value);setSaved(false)}}/>}/>
   <SettingsRow label="DNS connection" description="Cloudflare credentials stay encrypted in the panel." control={<Select aria-label="DNS connection" required value={selectedIntegration} disabled={busy||integrations.loading} onChange={e=>{setIntegration(e.target.value);setSaved(false)}}><option value="">Choose connection</option>{providers.map((i:any)=><option value={i.id} key={i.id}>{i.name}</option>)}</Select>}/>
   </div><div className="settings-actions"><Button variant="secondary" disabled={busy} onClick={()=>{setConnecting(!connecting);setToken('');setZone('')}}>{connecting?'Cancel new connection':'Connect Cloudflare'}</Button>{!managed&&<Button type="submit" disabled={busy||query.loading||!!query.error||!selectedDomain||!selectedIntegration}>{busy?'Checking...':'Save domain setup'}</Button>}</div>
  </form>
  {connecting&&<form autoComplete="off" onSubmit={e=>{e.preventDefault();void connect()}}>
   <p className="settings-section-note">One-time authorization: create a Cloudflare token with Zone Read and DNS Edit for this domain. After connecting, manage server names here without opening Cloudflare.</p>
   <div className="settings-options-grid"><SettingsRow label="Zone ID" description="The zone containing your domain." control={<Input aria-label="Cloudflare zone ID" required pattern="[a-fA-F0-9]{32}" maxLength={32} value={zone} disabled={busy} onChange={e=>setZone(e.target.value)}/>}/>
   <SettingsRow label="API token" description="Only grant access to the zone you want Voltra to manage." control={<Input aria-label="Cloudflare API token" type="password" autoComplete="new-password" required value={token} disabled={busy} onChange={e=>setToken(e.target.value)}/>}/>
   </div><div className="settings-actions"><Button type="submit" disabled={busy||!selectedDomain}>{busy?'Connecting...':'Connect DNS'}</Button></div>
  </form>}
  {saved&&<p className="settings-section-note" role="status">Domain connected. Open a server and set its join name.</p>}
  <ErrorMessage error={error||query.error||integrations.error}/>
  <p className="settings-section-note">Names point to {gateway.public_host}. Keep the public port when joining. Only records created by Voltra are managed; failed changes retry automatically.</p>
 </SettingsSection>;
}
