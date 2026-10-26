import { useState, type ReactNode } from "react";
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
  cloudflare: { label: "Cloudflare", description: "Store API access and account details for future DNS or tunnel setup. Leave variable mappings empty unless an egg needs these credentials.", fields: [
    { key: "api_token", label: "API token", variables: "" },
    { key: "account_id", label: "Account ID", variables: "" },
    { key: "zone_id", label: "Zone ID", variables: "" },
  ] },
  curseforge: { label: "CurseForge", description: "Reuse an API key for compatible mod and modpack installers.", fields: [
    { key: "api_key", label: "API key", variables: "CF_API_KEY, CURSEFORGE_API_KEY" },
  ] },
  steam: { label: "SteamCMD & Workshop", description: "Reuse a Steam account for game downloads and Workshop installers. Steam Guard challenges may still require approval in Steam.", fields: [
    { key: "username", label: "Steam username", variables: "STEAM_USER, STEAM_USERNAME" },
    { key: "password", label: "Steam password", variables: "STEAM_PASS, STEAM_PASSWORD" },
    { key: "web_api_key", label: "Steam Web API key", variables: "STEAM_WEB_API_KEY" },
  ] },
  modrinth: { label: "Modrinth", description: "Store a token for installers that need authenticated Modrinth access. Configure it only when needed.", fields: [
    { key: "api_token", label: "API token", variables: "MODRINTH_TOKEN, MODRINTH_API_TOKEN" },
  ] },
  game_license: { label: "Game licence", description: "Save a game or DLC product key for a game template. Use separate entries for the base game and each DLC.", fields: [
    { key: "license_key", label: "Licence key", variables: "" },
  ] },
  custom: { label: "Other integration", description: "Store credentials for another service and map only the fields its egg needs.", fields: [
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
  return <header className="integrations-header"><Heading title={title}>{children}</Heading><IntegrationTabs/><p className="muted">{description}</p></header>;
}

export function Integrations() {
  const q = useAPI(endpoint);
  return <div className="admin-infrastructure integrations-page">
    <IntegrationHeader description="Save API keys, logins and game licences here to reuse them across new servers."><Link className="button" to="/admin/integrations/new">Add integration</Link></IntegrationHeader>
    <ErrorMessage error={q.error} />
    <Panel title="Saved integrations">
      {q.loading ? <Loading /> : <DataTable data={q.data ? rows(q.data).filter(record=>record.provider!=='game_license') : []} empty={q.error ? "Integrations could not be loaded. Refresh the page to try again." : "No service credentials saved. Game keys are managed under Game licences."} columns={[
        { label: "Name", render: x => <Link to={`/admin/integrations/${x.id}`}>{x.name}</Link> },
        { label: "Service", render: x => providers[x.provider]?.label ?? x.provider },
        { label: "Scope", render: x => x.egg_id ? <Link to={`/admin/eggs/${x.egg_id}`}>Egg #{x.egg_id}</Link> : "All matching eggs" },
        { label: "Credentials", render: x => `${Object.values(x.configured_fields).filter(Boolean).length} saved` },
        { label: "Use for new servers", render: x => <span className="badge">{x.enabled ? "Enabled" : "Disabled"}</span> },
        { label: "Actions", render: x => <Link to={`/admin/integrations/${x.id}`}>Configure</Link> },
      ]} />}
    </Panel>
  </div>;
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [keyType, setKeyType] = useState(record?.bindings?.license_key?.includes('DLC_PRODUCT_KEY') ? 'dlc' : 'game');
  const eggs = eggsQ.data ? rows(eggsQ.data) : [];
  const selectedEgg = eggs.find(egg => String(egg.id) === eggID);
  const farming = provider === 'game_license' && (selectedEgg?.features?.includes('voltra_fs25') || (variablesQ.data && rows(variablesQ.data).some(variable => variable.env_variable === 'GAME_SERIAL')));
  const licenceTarget = farming ? keyType === 'dlc' ? 'DLC_PRODUCT_KEY' : 'GAME_SERIAL' : bindings.license_key || '';
  const keyLabel = farming ? keyType === 'dlc' ? 'GIANTS DLC product key' : 'GIANTS game product key' : 'Licence key';
  const keyHelp = farming ? keyType === 'dlc' ? 'Enter the key supplied with this DLC or season pass. This is separate from the base-game key. Give the integration a descriptive name, such as FS25 Emergency Pack. You can enable multiple DLC or season-pass keys. Each download is matched to its own key.' : 'Enter the GIANTS product key from your Farming Simulator 25 purchase email for the copy used by this server. This installer uses the GIANTS download portal, not a Steam activation code.' : 'Enter the product key supplied by the game publisher.';
  const definition = providers[provider];
  return <div className="admin-infrastructure integrations-form">
    <Heading title={record ? record.name : provider==='game_license'?'Add licence':'Add integration'}><Link className="button secondary" to={provider==='game_license'?'/admin/integrations/licences':'/admin/integrations'}>{provider==='game_license'?'All licences':'All integrations'}</Link></Heading>
    <ErrorMessage error={error || eggsQ.error} />
    <form autoComplete="off" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError("");
      try {
        const payload = {
          name, provider, enabled, egg_id: eggID ? Number(eggID) : null,
          credentials: Object.fromEntries(definition.fields.flatMap<[string, string | null]>(f => cleared[f.key] ? [[f.key, null]] : credentials[f.key] ? [[f.key, credentials[f.key]]] : [])),
          bindings: Object.fromEntries(definition.fields.map(f => [f.key, cleared[f.key] || (!credentials[f.key] && !record?.configured_fields[f.key]) ? [] : (provider === 'game_license' && f.key === 'license_key' ? licenceTarget : bindings[f.key] ?? "").split(",").map(x => x.trim()).filter(Boolean)])),
        };
        await api(record ? `${endpoint}/${record.id}` : endpoint, { method: record ? "PATCH" : "POST", body: JSON.stringify(payload) });
        setCredentials({}); navigate(provider==='game_license'?'/admin/integrations/licences':'/admin/integrations');
      } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
      finally { setBusy(false); }
    }}>
      <SettingsSection title="Integration details">
          <SettingsRow label="Service" description={definition.description} control={<Select aria-label="Service" value={provider} disabled={Boolean(record)} onChange={e => {
            const next = e.target.value; setProvider(next); setName(providers[next].label); setCredentials({}); setCleared({});
            setBindings(Object.fromEntries(providers[next].fields.map(f => [f.key, f.variables])));
          }}>{Object.entries(providers).map(([key, p]) => <option key={key} value={key}>{p.label}</option>)}</Select>} />
          <SettingsRow label="Name" control={<input aria-label="Integration name" required maxLength={191} value={name} onChange={e => setName(e.target.value)} placeholder="Farming Simulator 25" />} />
          <SettingsRow label={`Game template${provider === "game_license" ? " *" : ""}`} description="Choose which game's new servers can use this credential." control={<Select aria-label="Game template" required={provider === "game_license"} value={eggID} onChange={e => {setEggID(e.target.value); if (provider === 'game_license') setBindings({license_key:''});}}>
            <option value="">{provider === "game_license" ? "Select a game template" : "All matching templates"}</option>
            {eggsQ.data && rows(eggsQ.data).map(x => <option key={x.id} value={x.id}>{x.name} (#{x.id})</option>)}
          </Select>} />
          {farming && <SettingsRow label="Key for" description="The correct licence field is selected automatically." control={<Select aria-label="Key for" value={keyType} onChange={event => setKeyType(event.target.value)}><option value="game">Farming Simulator 25 base game</option><option value="dlc">DLC or season pass</option></Select>}/>}
          {provider === 'game_license' && eggID && !farming && <SettingsRow label="Licence field" description="Select the product-key field declared by this template." control={<Select aria-label="Licence field" required value={licenceTarget} onChange={event=>setBindings(previous=>({...previous,license_key:event.target.value}))}><option value="">Choose a licence field</option>{variablesQ.data && rows(variablesQ.data).map(variable=><option key={variable.env_variable} value={variable.env_variable}>{variable.name || variable.env_variable}</option>)}</Select>}/>}
          <SettingsRow label="Use for new servers" control={<Switch aria-label="Use for new servers" checked={enabled} onCheckedChange={checked => setEnabled(checked)} />} />
      </SettingsSection>
      <SettingsSection title={provider === 'game_license' ? 'Product key' : 'Credentials'} plain>
        <div className="integrations-credential-note">
        <ErrorMessage error={variablesQ.error} />
        <p className="muted">Saved credentials stay hidden. Leave a credential blank to keep it, or select Clear to remove it.</p>
        {farming && <><p>{keyHelp}</p><p><a href="https://eshop.giants-software.com/" target="_blank" rel="noreferrer">Find GIANTS downloads</a> · <a href="https://www.farming-simulator.com/support.php?lang=en" target="_blank" rel="noreferrer">Recover a lost key</a></p>{keyType === 'dlc' && <p>Manage and apply these keys centrally under Admin Integrations, Game licences. They take effect on the selected server's next start.</p>}</>}
        </div>
        <div className="integrations-credentials settings-group">
          {definition.fields.map(field => <div className="integrations-credential" key={field.key}>
            <SettingsRow label={provider === 'game_license' ? keyLabel : field.label} description={record?.configured_fields[field.key] ? "Saved credential. Leave blank to keep it." : "No credential saved."} control={<input aria-label={provider === 'game_license' ? keyLabel : field.label} type="password" autoComplete="new-password" required={provider === 'game_license' && !cleared[field.key] && (!record?.configured_fields[field.key] || !(record.bindings?.license_key || []).includes(licenceTarget))} value={credentials[field.key] ?? ""} disabled={cleared[field.key]} onChange={e => setCredentials({ ...credentials, [field.key]: e.target.value })} placeholder={record?.configured_fields[field.key] ? "Enter a replacement" : provider === 'game_license' ? "Enter your product key" : "Not configured"} />}>
              {record?.configured_fields[field.key] && <label className="integrations-clear muted"><Switch checked={cleared[field.key] ?? false} onCheckedChange={checked => setCleared({ ...cleared, [field.key]: checked })} /> Clear saved {field.label.toLowerCase()}</label>}
            </SettingsRow>
            {provider !== 'game_license' && <details className="integrations-mapping"><summary>Advanced variable mappings</summary><SettingsRow label={`${field.label} variables`} description="Use exact template variable names, separated by commas. Leave empty to store only." control={<input aria-label={`${field.label} variables`} value={bindings[field.key] ?? ""} disabled={cleared[field.key]} onChange={e => setBindings({ ...bindings, [field.key]: e.target.value })} placeholder="Leave empty to store only" />} /></details>}
          </div>)}
          <div className="settings-actions"><button className="button" type="submit" disabled={busy}>{busy ? "Saving..." : "Save integration"}</button></div>
        </div>
        <p className="settings-note integrations-credential-note">Changes apply to new servers. Existing FS25 servers receive updates when an administrator applies saved licences from the central Game licences page. Saving does not restart a server.</p>
      </SettingsSection>
    </form>
    {record && <Panel title="Remove integration"><p className="muted">Remove these global credentials. Existing servers keep their saved copies.</p><Action path={`${endpoint}/${record.id}`} method="DELETE" danger confirm="Remove this global integration?" onDone={() => navigate("/admin/integrations")}>Remove integration</Action></Panel>}
  </div>;
}
