import { miBToGB, gbToMiB } from "../resourceUnits";
import {useEffect, useState} from "react";
import {api, Button, Card, Field, Input, Select, useAPI, unwrap} from "../lib";
import {Switch} from "../ui/Settings";
import "./management-ui.css";

type RuntimeRule = {
  id:string; name:string; enabled:boolean; provider:string; project_id:string;
  project_version:string; loader:string; game_version:string; required_major:number;
  required_distribution:string; min_memory_mib:number | string; jvm_args:string;
};
const emptyRule = ():RuntimeRule => ({id:crypto.randomUUID(),name:"",enabled:true,provider:"",project_id:"",project_version:"",loader:"",game_version:"",required_major:0,required_distribution:"",min_memory_mib:0,jvm_args:""});

export function MinecraftRuntimeRules(){
  const query=useAPI("/api/admin/minecraft/runtime-rules");
  const [rules,setRules]=useState<RuntimeRule[]>([]);
  const [openRules,setOpenRules]=useState<Record<string,boolean>>({});
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[saved,setSaved]=useState(false);
  useEffect(()=>{if(query.data)setRules((unwrap(query.data).rules??[]).map((rule:RuntimeRule)=>({...rule,min_memory_mib:miBToGB(Number(rule.min_memory_mib))})))},[query.data]);
  function update(id:string,patch:Partial<RuntimeRule>){setSaved(false);setRules(old=>old.map(rule=>rule.id===id?{...rule,...patch}:rule))}
  async function save(){
    setError("");setSaved(false);setBusy(true);
    try{
      const payload=rules.map(rule=>{const memory=gbToMiB(rule.min_memory_mib);if(!Number.isFinite(memory)||Number(rule.min_memory_mib)<0||Number(rule.min_memory_mib)>1024)throw new Error("Minimum server memory: enter a GB amount between 0 and 1024.");return {...rule,min_memory_mib:memory}});
      const result=await api("/api/admin/minecraft/runtime-rules",{method:"PUT",body:JSON.stringify({rules:payload})});
      setRules(unwrap(result).rules.map((rule:RuntimeRule)=>({...rule,min_memory_mib:miBToGB(Number(rule.min_memory_mib))})));setSaved(true);
    }catch(err){setError(err instanceof Error?err.message:String(err))}finally{setBusy(false)}
  }
  return <Card className="admin-panel admin-runtime-rules management-ui">
    <div className="page-header admin-section-header"><div><h2>Minecraft runtime rules</h2><p className="muted">Set Java requirements for a pack, loader or game version. Rules apply to new installations.</p></div><Button variant="secondary" disabled={busy||query.loading||!!query.error} onClick={()=>{const rule=emptyRule();setRules(old=>[...old,rule]);setOpenRules(old=>({...old,[rule.id]:true}));setSaved(false)}}>Add rule</Button></div>
    {(query.error||error)&&<p className="error" role="alert">{query.error||error}</p>}
    {query.loading&&<p role="status">Loading runtime rules...</p>}
    {!query.loading&&!query.error&&rules.length===0&&<p className="muted">No overrides. Minecraft and loader metadata choose Java automatically.</p>}
    <fieldset disabled={busy||query.loading||!!query.error} className="admin-fieldset">
      {rules.map((rule,index)=><details className="admin-disclosure admin-runtime-rule" key={rule.id} open={!!openRules[rule.id]} onToggle={e=>{const opened=e.currentTarget.open;setOpenRules(old=>old[rule.id]===opened?old:{...old,[rule.id]:opened})}}>
        <summary><span className="admin-disclosure-title">{rule.name||`New rule ${index+1}`}</span>{!rule.enabled&&<span className="badge">Disabled</span>}</summary>
        <div className="form-grid">
          <Field label="Rule name"><Input required maxLength={191} value={rule.name} onChange={e=>update(rule.id,{name:e.target.value})}/></Field>
          <Field label="Provider"><Select value={rule.provider} onChange={e=>update(rule.id,{provider:e.target.value,project_id:"",project_version:""})}><option value="">Any provider or custom setup</option><option value="curseforge">CurseForge</option><option value="modrinth">Modrinth</option></Select></Field>
          <Field label="Project ID" hint="Use the provider's project ID. Leave blank to match all projects."><Input disabled={!rule.provider} value={rule.project_id} onChange={e=>update(rule.id,{project_id:e.target.value,project_version:""})}/></Field>
          <Field label="Pack version ID" hint="Leave blank to match every version of this project."><Input disabled={!rule.project_id} value={rule.project_version} onChange={e=>update(rule.id,{project_version:e.target.value})}/></Field>
          <Field label="Loader"><Select value={rule.loader} onChange={e=>update(rule.id,{loader:e.target.value})}><option value="">Any loader</option>{["vanilla","paper","fabric","forge","neoforge","quilt"].map(loader=><option key={loader} value={loader}>{loader}</option>)}</Select></Field>
          <Field label="Minecraft version" hint="An exact version, or leave blank for all versions."><Input value={rule.game_version} onChange={e=>update(rule.id,{game_version:e.target.value})}/></Field>
          <Field label="Minimum Java major" hint="0 keeps the requirement from Minecraft metadata."><Input type="number" min={0} max={999} step={1} value={rule.required_major} onChange={e=>update(rule.id,{required_major:Number(e.target.value)})}/></Field>
          <Field label="Required distribution" hint="Match a distribution registered above, such as temurin or graalvm. Leave blank for any."><Input value={rule.required_distribution} onChange={e=>update(rule.id,{required_distribution:e.target.value})}/></Field>
          <Field label="Minimum server memory (GB)" hint="0 adds no minimum memory requirement."><Input type="number" min={0} max={1024} step="any" value={rule.min_memory_mib} onChange={e=>update(rule.id,{min_memory_mib:e.target.value})}/></Field>
          <Field label="Additional JVM arguments" hint="Heap size is managed separately. Example: -XX:+UseG1GC"><Input value={rule.jvm_args} maxLength={4096} onChange={e=>update(rule.id,{jvm_args:e.target.value})}/></Field>
        </div>
        <div className="actions admin-form-actions admin-form-actions-split"><label className="admin-inline-switch"><Switch checked={rule.enabled} onCheckedChange={checked => update(rule.id,{enabled:checked})}/>Enabled</label><Button variant="danger" onClick={()=>{setRules(old=>old.filter(x=>x.id!==rule.id));setSaved(false)}}>Remove rule</Button></div>
      </details>)}
    </fieldset>
    <div className="actions admin-form-actions"><Button disabled={busy||query.loading||!!query.error} onClick={save}>{busy?"Saving...":"Save runtime rules"}</Button>{saved&&<span className="success" role="status">Runtime rules saved.</span>}</div>
  </Card>;
}
