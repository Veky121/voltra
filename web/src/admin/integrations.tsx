import { useState, type ReactNode } from "react";
import "./integrations.css";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
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
  game_license: { label: "Game licence", description: "Save a licence for a specific game egg, such as Farming Simulator. Use a separate entry for each game or version.", fields: [
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
  return <nav className="tabs" aria-label="Integrations"><NavLink end to="/admin/integrations">Credentials</NavLink><NavLink to="/admin/integrations/proxy-gateways">Proxy gateways</NavLink></nav>;
}

export function IntegrationHeader({children,description}:{children:ReactNode;description:string}) {
  return <header className="integrations-header"><Heading title="Integrations">{children}</Heading><IntegrationTabs/><p className="muted">{description}</p></header>;
}

export function Integrations() {
  const q = useAPI(endpoint);
  return <div className="integrations-page">
    <IntegrationHeader description="Save API keys, logins and game licences here to reuse them across new servers."><Link className="button" to="/admin/integrations/new">Add integration</Link></IntegrationHeader>
    <ErrorMessage error={q.error} />
    <Panel title="Saved integrations">
      {q.loading ? <p>Loading integrations...</p> : <DataTable data={q.data ? rows(q.data) : []} empty="No integrations saved. Add an integration to share credentials across new servers." columns={[
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
  if (id !== "new" && q.loading) return <p>Loading integration...</p>;
  if (id !== "new" && !record) return <><Heading title="Integration" /><ErrorMessage error={q.error || "Integration not found."} /><Link to="/admin/integrations">All integrations</Link></>;
  return <IntegrationForm key={id} record={record} />;
}

function IntegrationForm({ record }: { record: any }) {
  const navigate = useNavigate();
  const eggsQ = useAPI("/api/admin/eggs");
  const [provider, setProvider] = useState(record?.provider ?? "curseforge");
  const [name, setName] = useState(record?.name ?? "CurseForge");
  const [eggID, setEggID] = useState(String(record?.egg_id ?? ""));
  const variablesQ = useAPI(eggID ? `/api/admin/eggs/${eggID}/variables` : null);
  const [enabled, setEnabled] = useState(record?.enabled ?? true);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [cleared, setCleared] = useState<Record<string, boolean>>({});
  const [bindings, setBindings] = useState<Record<string, string>>(() => record
    ? Object.fromEntries(Object.entries(record.bindings ?? {}).map(([k, v]) => [k, (v as string[]).join(", ")]))
    : Object.fromEntries(providers.curseforge.fields.map(f => [f.key, f.variables])));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const definition = providers[provider];
  return <>
    <Heading title={record ? record.name : "Add integration"}><Link to="/admin/integrations">All integrations</Link></Heading>
    <ErrorMessage error={error || eggsQ.error} />
    <form autoComplete="off" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError("");
      try {
        const payload = {
          name, provider, enabled, egg_id: eggID ? Number(eggID) : null,
          credentials: Object.fromEntries(definition.fields.flatMap<[string, string | null]>(f => cleared[f.key] ? [[f.key, null]] : credentials[f.key] ? [[f.key, credentials[f.key]]] : [])),
          bindings: Object.fromEntries(definition.fields.map(f => [f.key, cleared[f.key] || (!credentials[f.key] && !record?.configured_fields[f.key]) ? [] : (bindings[f.key] ?? "").split(",").map(x => x.trim()).filter(Boolean)])),
        };
        await api(record ? `${endpoint}/${record.id}` : endpoint, { method: record ? "PATCH" : "POST", body: JSON.stringify(payload) });
        setCredentials({}); navigate("/admin/integrations");
      } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
      finally { setBusy(false); }
    }}>
      <Panel title="Integration details">
        <div className="form-grid">
          <label className="field"><span>Service</span><select value={provider} disabled={Boolean(record)} onChange={e => {
            const next = e.target.value; setProvider(next); setName(providers[next].label); setCredentials({}); setCleared({});
            setBindings(Object.fromEntries(providers[next].fields.map(f => [f.key, f.variables])));
          }}>{Object.entries(providers).map(([key, p]) => <option key={key} value={key}>{p.label}</option>)}</select></label>
          <label className="field"><span>Name</span><input required maxLength={191} value={name} onChange={e => setName(e.target.value)} placeholder="Farming Simulator 25" /></label>
          <label className="field"><span>Egg scope{provider === "game_license" ? " *" : ""}</span><select required={provider === "game_license"} value={eggID} onChange={e => setEggID(e.target.value)}>
            <option value="">{provider === "game_license" ? "Select a game egg" : "All matching eggs"}</option>
            {eggsQ.data && rows(eggsQ.data).map(x => <option key={x.id} value={x.id}>{x.name} (#{x.id})</option>)}
          </select><small className="muted">Only declared egg variables receive mapped values. Game licences require a specific egg.</small></label>
          <label className="field"><span>Use for new servers</span><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /></label>
        </div>
        <p className="muted">{definition.description}</p>
      </Panel>
      <Panel title="Credentials and variable mappings">
        {variablesQ.data && <p className="muted">Available variables for this egg: {rows(variablesQ.data).map(x => x.env_variable).join(", ") || "None"}.</p>}
        <ErrorMessage error={variablesQ.error} />
        <p className="muted">Saved credentials stay hidden. Leave a credential blank to keep it, or select Clear to remove it. Mappings use comma-separated egg variable names.</p>
        <div className="form-grid">
          {definition.fields.map(field => <div key={field.key}>
            <label className="field"><span>{field.label}</span><input type="password" autoComplete="new-password" value={credentials[field.key] ?? ""} disabled={cleared[field.key]} onChange={e => setCredentials({ ...credentials, [field.key]: e.target.value })} placeholder={record?.configured_fields[field.key] ? "Saved. Enter a replacement." : "Not configured"} /></label>
            {record?.configured_fields[field.key] && <label className="muted"><input type="checkbox" checked={cleared[field.key] ?? false} onChange={e => setCleared({ ...cleared, [field.key]: e.target.checked })} /> Clear saved {field.label.toLowerCase()}</label>}
            <label className="field"><span>{field.label} variables</span><input value={bindings[field.key] ?? ""} disabled={cleared[field.key]} onChange={e => setBindings({ ...bindings, [field.key]: e.target.value })} placeholder="Leave empty to store only" /><small className="muted">Use the exact variable names from the egg. Empty mappings keep this credential stored for future use.</small></label>
          </div>)}
        </div>
        <p className="muted">Changes apply to new servers. Existing servers keep their saved credentials. This page stores credentials; provider actions still depend on the server's installer.</p>
        <button disabled={busy}>{busy ? "Saving..." : "Save integration"}</button>
      </Panel>
    </form>
    {record && <Panel title="Remove integration"><p className="muted">Remove these global credentials. Existing servers keep their saved copies.</p><Action path={`${endpoint}/${record.id}`} method="DELETE" danger confirm="Remove this global integration?" onDone={() => navigate("/admin/integrations")}>Remove integration</Action></Panel>}
  </>;
}
