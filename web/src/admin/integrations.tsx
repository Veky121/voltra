import {IntegrationLayout} from './IntegrationLayout';
import {usePendingSetting} from '../client/PendingSettings';
import {useErrorState} from '../notifications/useErrorState';
import {Badge as MiraBadge} from '../components/ui/badge';
import {Button as MiraButton} from '../components/ui/button';
import {Disclosure,DisclosureTrigger} from '../ui/Disclosure';
import {ActionButton as MiraAction} from '../ui/ActionButton';
import {Input as MiraInput} from '../components/ui/input';
import { useState, useRef, type ReactNode } from "react";
import {Select,  Loading } from "../lib";
import { SettingsRow, SettingsSection, Switch } from "../ui/Settings";
import {SectionTabs} from '../ui/SectionTabs';
import "./infrastructure-ui.css";
import "./integrations.css";
import { Link, NavLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Action, DataTable, ErrorMessage, Heading, Panel, api, rows, unwrap, useAPI } from "./shared";

const endpoint = "/api/admin/integrations";
type Credential = { key: string; label: string; variables: string };
const providers: Record<string, { label: string; description: string; fields: Credential[] }> = {
  cloudflare: { label: "Cloudflare", description: "DNS access for server join names.", fields: [
    { key: "api_token", label: "API token", variables: "" },
    { key: "account_id", label: "Account ID", variables: "" },
    { key: "zone_id", label: "Zone ID", variables: "" },
  ] },
  curseforge: { label: "CurseForge", description: "API access for mod and modpack installers.", fields: [
    { key: "api_key", label: "API key", variables: "CF_API_KEY, CURSEFORGE_API_KEY" },
  ] },
  steam: { label: "SteamCMD & Workshop", description: "Game and Workshop downloads. Steam Guard may require approval.", fields: [
    { key: "username", label: "Steam username", variables: "STEAM_USER, STEAM_USERNAME" },
    { key: "password", label: "Steam password", variables: "STEAM_PASS, STEAM_PASSWORD" },
    { key: "web_api_key", label: "Steam Web API key", variables: "STEAM_WEB_API_KEY" },
  ] },
  modrinth: { label: "Modrinth", description: "A token for installers that require Modrinth sign-in.", fields: [
    { key: "api_token", label: "API token", variables: "MODRINTH_TOKEN, MODRINTH_API_TOKEN" },
  ] },
  game_license: { label: "Game licence", description: "Save a product key. Add each game or DLC key separately.", fields: [
    { key: "license_key", label: "Licence key", variables: "" },
  ] },
  custom: { label: "Other integration", description: "Credentials for another service.", fields: [
    { key: "username", label: "Username", variables: "" },
    { key: "password", label: "Password", variables: "" },
    { key: "api_key", label: "API key", variables: "" },
    { key: "license_key", label: "Licence key", variables: "" },
  ] },
};

export function IntegrationTabs() {
  return <SectionTabs label="Integrations" items={[{id:'credentials',label:'Credentials',to:'/admin/integrations',end:true},{id:'licences',label:'Game licences',to:'/admin/integrations/licences'},{id:'gateways',label:'Proxy gateways',to:'/admin/integrations/proxy-gateways'}]}/>;
}

export function IntegrationHeader({children,description,title='Integrations'}:{children?:ReactNode;description:string;title?:string}) {
  return <header className="integrations-header"><Heading title={title}/><IntegrationTabs/><div className="integrations-toolbar"><p className="muted">{description}</p>{children&&<div className="actions integrations-toolbar-actions">{children}</div>}</div></header>;
}

export function Integrations() {
  const q = useAPI(endpoint);
  return <IntegrationLayout>
    <IntegrationHeader description="Connect DNS, mod downloads and game accounts."><MiraButton className="button" nativeButton={false} render={<Link to="/admin/integrations/new"/>}>Add integration</MiraButton></IntegrationHeader>
    <ErrorMessage error={q.error} />
    <Panel title="Saved integrations">
      {q.loading ? <Loading /> : <DataTable data={q.data ? rows(q.data).filter(record=>record.provider!=='game_license') : []} empty={q.error ? "Could not load integrations. Refresh to retry." : "No integrations yet."} columns={[
        { label: "Name", render: x => <Link to={`/admin/integrations/${x.id}`}>{x.name}</Link> },
        { label: "Service", render: x => providers[x.provider]?.label ?? x.provider },
        { label: "Applies to", render: x => x.egg_id ? <Link to={`/admin/eggs/${x.egg_id}`}>Egg #{x.egg_id}</Link> : "All matching games" },
        { label: "Credentials", render: x => `${Object.values(x.configured_fields).filter(Boolean).length} saved` },
        { label: "Status", render: x => <MiraBadge variant="secondary" className="badge">{x.enabled ? "Enabled" : "Disabled"}</MiraBadge> },
        { label: "Actions", render: x => <Link to={`/admin/integrations/${x.id}`}>Configure</Link> },
      ]} />}
    </Panel>
  </IntegrationLayout>;
}

export function Integration() {
  const { id = "new" } = useParams();
  const q = useAPI(id === "new" ? null : endpoint);
  const record = q.data ? rows(q.data).find(x => String(x.id) === id) : null;
  if (id !== "new" && q.loading) return <div className="admin-infrastructure"><Loading /></div>;
  if (id !== "new" && !record) return <div className="admin-infrastructure"><Heading title="Integration" /><ErrorMessage error={q.error || "Integration not found."} /><Link className="button secondary" to="/admin/integrations">All integrations</Link></div>;
  return <IntegrationForm key={id} record={record} />;
}

function IntegrationForm({ record }: { record: any }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fs25 = !record && params.get("game") === "fs25" && /^\d+$/.test(params.get("egg") || "");
  const licenceMode=fs25||params.get('provider')==='game_license';
  const eggsQ = useAPI("/api/admin/eggs");
  const [provider, setProvider] = useState(record?.provider ?? (licenceMode ? "game_license" : "curseforge"));
  const [name, setName] = useState(record?.name ?? (fs25 ? "Farming Simulator 25" : licenceMode?'':'CurseForge'));
  const [eggID, setEggID] = useState(String(record?.egg_id ?? (fs25 ? params.get("egg") : "")));
  const variablesQ = useAPI(eggID ? `/api/admin/eggs/${eggID}/variables` : null);
  const [enabled, setEnabled] = useState(record?.enabled ?? true);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [cleared, setCleared] = useState<Record<string, boolean>>({});
  const [bindings, setBindings] = useState<Record<string, string>>(() => record
    ? Object.fromEntries(Object.entries(record.bindings ?? {}).map(([k, v]) => [k, (v as string[]).join(", ")]))
    : fs25 ? {license_key:"GAME_SERIAL"} : Object.fromEntries(providers.curseforge.fields.map(f => [f.key, f.variables])));
  const [error, setError] = useErrorState('admin/integrations.tsx');
  const [busy, setBusy] = useState(false);
  const [keyType, setKeyType] = useState(record?.bindings?.license_key?.includes('DLC_PRODUCT_KEY') ? 'dlc' : 'game');
  const eggs = eggsQ.data ? rows(eggsQ.data) : [];
  const selectedEgg = eggs.find(egg => String(egg.id) === eggID);
  const farming = provider === 'game_license' && (selectedEgg?.features?.includes('voltra_fs25') || (variablesQ.data && rows(variablesQ.data).some(variable => variable.env_variable === 'GAME_SERIAL')));
  const licenceTarget = farming ? keyType === 'dlc' ? 'DLC_PRODUCT_KEY' : 'GAME_SERIAL' : bindings.license_key || '';
  const keyLabel = farming ? keyType === 'dlc' ? 'GIANTS DLC product key' : 'GIANTS game product key' : 'Licence key';
  const keyHelp = farming ? keyType === 'dlc' ? 'Use the GIANTS key for this DLC or season pass, separate from your base-game key.' : 'Use the GIANTS product key from your FS25 purchase email. Steam activation codes are not supported.' : 'Enter the product key supplied by the game publisher.';
  const definition = providers[provider];
  const formRef=useRef<HTMLFormElement>(null);
  const snapshot=JSON.stringify({name,eggID,enabled,bindings,keyType});
  const [baseline,setBaseline]=useState(snapshot);
  const [savedRecord,setSavedRecord]=useState(record);
  const dirty=snapshot!==baseline||Object.values(credentials).some(Boolean)||Object.values(cleared).some(Boolean);
  function discard(){const original=JSON.parse(baseline);setName(original.name);setEggID(original.eggID);setEnabled(original.enabled);setBindings(original.bindings);setKeyType(original.keyType);setCredentials({});setCleared({});setError('')}
  async function save(){
    if(!formRef.current?.reportValidity())throw new Error('Complete the required integration fields.');
    setBusy(true);setError('');
    try{
        const payload = {
          name, provider, enabled, egg_id: eggID ? Number(eggID) : null,
          credentials: Object.fromEntries(definition.fields.flatMap<[string, string | null]>(f => cleared[f.key] ? [[f.key, null]] : credentials[f.key] ? [[f.key, credentials[f.key]]] : [])),
          bindings: Object.fromEntries(definition.fields.map(f => [f.key, cleared[f.key] || (!credentials[f.key] && !savedRecord?.configured_fields?.[f.key]) ? [] : (provider === 'game_license' && f.key === 'license_key' ? licenceTarget : bindings[f.key] ?? "").split(",").map(x => x.trim()).filter(Boolean)])),
        };

      const response=unwrap(await api(record ? `${endpoint}/${record.id}` : endpoint,{method:record?'PATCH':'POST',body:JSON.stringify(payload)}));
      setCredentials({});setCleared({});setBaseline(snapshot);if(response)setSavedRecord(response);
      if(!record)navigate(provider==='game_license'?'/admin/integrations/licences':'/admin/integrations');
    }catch(err){setError(err instanceof Error?err.message:String(err));throw err}finally{setBusy(false)}
  }
  const managed=usePendingSetting(`integration:${record?.id}`,!!record&&dirty,{blocked:busy||!name.trim(),save,discard});
  return <IntegrationLayout className="integrations-form">
    <Heading title={record ? record.name : provider==='game_license'?'Add licence':'Add integration'}><Link className="button secondary" to={provider==='game_license'?'/admin/integrations/licences':'/admin/integrations'}>{provider==='game_license'?'All licences':'All integrations'}</Link></Heading>
    <ErrorMessage error={error || eggsQ.error} />
    <form ref={formRef} autoComplete="off" onSubmit={e=>{e.preventDefault();void save().catch(()=>{})}}>
      <fieldset disabled={busy} className="integrations-fieldset">
      <SettingsSection title="Integration details"><div className="settings-options-grid">
          <SettingsRow label="Service" description={definition.description} control={<Select aria-label="Service" value={provider} disabled={Boolean(record)} onChange={e => {
            const next = e.target.value; setProvider(next); setName(providers[next].label); setCredentials({}); setCleared({});
            setBindings(Object.fromEntries(providers[next].fields.map(f => [f.key, f.variables])));
          }}>{Object.entries(providers).map(([key, p]) => <option key={key} value={key}>{p.label}</option>)}</Select>} />
          <SettingsRow label="Name" control={<MiraInput aria-label="Integration name" required maxLength={191} value={name} onChange={e => setName(e.target.value)} placeholder="Farming Simulator 25" />} />
          {provider!=='cloudflare'&&<SettingsRow label={`Game template${provider === "game_license" ? " *" : ""}`} description="New servers using this template can use these credentials." control={<Select aria-label="Game template" required={provider === "game_license"} value={eggID} onChange={e => {setEggID(e.target.value); if (provider === 'game_license') setBindings({license_key:''});}}>
            <option value="">{provider === "game_license" ? "Select a game template" : "All matching templates"}</option>
            {eggsQ.data && rows(eggsQ.data).map(x => <option key={x.id} value={x.id}>{x.name} (#{x.id})</option>)}
          </Select>} />}
          {farming && <SettingsRow label="Key for" description="Select the game or DLC this key unlocks." control={<Select aria-label="Key for" value={keyType} onChange={event => setKeyType(event.target.value)}><option value="game">Farming Simulator 25 base game</option><option value="dlc">DLC or season pass</option></Select>}/>}
          {provider === 'game_license' && eggID && !farming && <SettingsRow label="Licence field" description="The template field that receives the key." control={<Select aria-label="Licence field" required value={licenceTarget} onChange={event=>setBindings(previous=>({...previous,license_key:event.target.value}))}><option value="">Choose a licence field</option>{variablesQ.data && rows(variablesQ.data).map(variable=><option key={variable.env_variable} value={variable.env_variable}>{variable.name || variable.env_variable}</option>)}</Select>}/>}
          <SettingsRow label={provider==='cloudflare'?'Enable connection':'Use for new servers'} control={<Switch aria-label={provider==='cloudflare'?'Enable connection':'Use for new servers'} checked={enabled} onCheckedChange={checked => setEnabled(checked)} />} />
      </div></SettingsSection>
      <SettingsSection title={provider === 'game_license' ? 'Product key' : 'Credentials'}>
        <div className="integrations-credential-note">
        <ErrorMessage error={variablesQ.error} />
        <p className="muted">Leave blank to keep a saved credential. Clear removes it.</p>{provider==='cloudflare'&&<p>Use Zone Read and DNS Edit for one domain. Then connect it under Proxy gateways. Account ID is optional for DNS.</p>}
        {farming && <><p>{keyHelp}</p><p><a href="https://eshop.giants-software.com/" target="_blank" rel="noreferrer">Find GIANTS downloads</a> · <a href="https://www.farming-simulator.com/support.php?lang=en" target="_blank" rel="noreferrer">Recover a lost key</a></p>{keyType === 'dlc' && <p>Apply keys under Game licences. They take effect on the server's next start.</p>}</>}
        </div>
        <div className="integrations-credentials settings-options-grid">
          {definition.fields.map(field => <div className="integrations-credential" key={field.key}>
            <SettingsRow label={provider === 'game_license' ? keyLabel : field.label} description={savedRecord?.configured_fields?.[field.key] ? "Saved. Leave blank to keep." : "Not saved."} control={<MiraInput aria-label={provider === 'game_license' ? keyLabel : field.label} type={["account_id","zone_id","username"].includes(field.key)?"text":"password"} autoComplete="new-password" required={provider === 'game_license' && !cleared[field.key] && (!savedRecord?.configured_fields?.[field.key] || !(savedRecord?.bindings?.license_key || []).includes(licenceTarget))} value={credentials[field.key] ?? ""} disabled={cleared[field.key]} onChange={e => setCredentials({ ...credentials, [field.key]: e.target.value })} placeholder={savedRecord?.configured_fields?.[field.key] ? "Enter a replacement" : provider === 'game_license' ? "Enter your product key" : "Not configured"} />}>
              {savedRecord?.configured_fields?.[field.key] && <label className="integrations-clear muted"><Switch checked={cleared[field.key] ?? false} onCheckedChange={checked => setCleared({ ...cleared, [field.key]: checked })} /> Clear saved {field.label.toLowerCase()}</label>}
            </SettingsRow>
            {provider !== 'game_license' && provider !== 'cloudflare' && <Disclosure className="integrations-mapping"><DisclosureTrigger>Advanced variable mappings</DisclosureTrigger><SettingsRow label={`${field.label} variables`} description="Template variables, separated by commas. Leave blank to store only." control={<MiraInput aria-label={`${field.label} variables`} value={bindings[field.key] ?? ""} disabled={cleared[field.key]} onChange={e => setBindings({ ...bindings, [field.key]: e.target.value })} placeholder="Leave empty to store only" />} /></Disclosure>}
          </div>)}
          {(!record||!managed)&&<div className="settings-actions"><MiraAction className="button" type="submit" disabled={busy}>{busy ? "Saving..." : record?"Save integration":"Add integration"}</MiraAction></div>}
        </div>
        <p className="settings-note">{provider==='cloudflare'?'Connect this credential to a gateway under Proxy gateways.':provider==='game_license'?'Apply saved keys to existing servers under Game licences.':'Used when creating servers from matching game templates.'} Saving does not restart servers.</p>
      </SettingsSection>
      </fieldset>
    </form>
    {record && <Panel title="Remove integration"><SettingsRow label="Remove integration" description="Existing servers keep their saved copies." control={<Action path={`${endpoint}/${record.id}`} method="DELETE" danger confirm="Remove this global integration?" onDone={() => navigate("/admin/integrations")}>Remove integration</Action>}/></Panel>}
  </IntegrationLayout>;
}
