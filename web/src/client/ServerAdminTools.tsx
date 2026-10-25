import './gameSwitch.css';
import { useEffect, useState } from "react";
import { api, Button, Card, ErrorBox, Loading, unwrap, useAPI } from "../lib";
import {
  Build, DeleteServer, Details, Manage, ServerDatabases, ServerMounts,
  ServerSettingsTabs, Startup,
} from "../admin/servers";
import { useServer } from "./common";
import {SettingsRow,SettingsSection,Switch} from '../ui/Settings';
import "./serverAdminTools.css";

const tabs = [
  ["overview", "Overview"], ["details", "Details"], ["limits", "Limits"],
  ["runtime", "Runtime"], ["databases", "Databases"], ["mounts", "Mounts"],
  ["configuration", "Installation & process"], ["manage", "Manage"],
] as const;

const configurationFields = [
  { key: "config_stop", label: "Stop command", hint: "Command sent when stopping this server. Use ^C for a stop signal.", kind: "text", group: "process" },
  { key: "config_startup", label: "Startup detection", hint: "JSON object describing the output Wings uses to detect a successful start.", kind: "json", group: "process" },
  { key: "config_files", label: "Configuration file rules", hint: "JSON object describing the files Wings updates before starting this server.", kind: "json", group: "process" },
  { key: "script_container", label: "Installer container image", hint: "Container image used for the next installation.", kind: "text", group: "installation" },
  { key: "script_entry", label: "Installer entrypoint", hint: "Interpreter used to run the installation script, for example bash.", kind: "text", group: "installation" },
  { key: "script_install", label: "Installation script", hint: "Runs only during a separately requested install or reinstall and may overwrite server files.", kind: "script", group: "installation" },
] as const;
type ConfigurationKey = typeof configurationFields[number]["key"];
type ConfigurationValues = {
  config_files: Record<string, unknown>;
  config_startup: Record<string, unknown>;
  config_stop: string;
  script_install: string;
  script_container: string;
  script_entry: string;
};
export type ServerConfiguration = {
  revision: string;
  template: { id: number; name: string; nest_id: number };
  managed: boolean;
  overrides: Partial<ConfigurationValues>;
  effective: ConfigurationValues;
  defaults: ConfigurationValues;
  can_update: boolean;
  update_unavailable_reason?: string;
  applies: { process: "next_start"; installation: "next_install" };
};
export type ConfigurationDraft = Partial<Record<ConfigurationKey, string>>;

export function serverAdminID(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function fieldText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function configurationDraft(configuration: ServerConfiguration): ConfigurationDraft {
  return Object.fromEntries(configurationFields
    .filter(field => Object.hasOwn(configuration.overrides, field.key))
    .map(field => [field.key, fieldText(configuration.overrides[field.key]) ]));
}

export function configurationRequest(configuration: ServerConfiguration, draft: ConfigurationDraft) {
  if (!configuration.can_update) throw new Error("Stop the server and reload configuration before saving. The backend must allow this update.");
  if (!configuration.revision) throw new Error("Reload configuration to obtain its current revision.");
  const overrides: Partial<ConfigurationValues> = {};
  for (const field of configurationFields) {
    if (!Object.hasOwn(draft, field.key)) continue;
    const text = draft[field.key];
    if (typeof text !== "string") throw new Error(`${field.label} must be text.`);
    if (configuration.managed && field.group === "installation") {
      throw new Error("This server uses a managed installer. Reset installer overrides to template defaults and use the server's managed installation controls.");
    }
    if (field.kind === "json") {
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw new Error(`${field.label} must be a valid JSON object.`); }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${field.label} must be a JSON object, such as {}.`);
      }
      overrides[field.key] = parsed as Record<string, unknown>;
    } else {
      overrides[field.key] = text;
    }
  }
  return { revision: configuration.revision, overrides };
}

export default function ServerAdminTools() {
  const { server } = useServer();
  const account = useAPI("/api/client/account");
  if (account.loading) return <Loading />;
  if (account.error) return <Card><ErrorBox>{account.error}</ErrorBox><Button variant="secondary" onClick={account.reload}>Retry administrator check</Button></Card>;
  // Ownership and wildcard server permissions do not grant panel administration.
  // Each application/admin/configuration endpoint also enforces backend admin auth.
  if (unwrap(account.data)?.root_admin !== true) return <Card><h2>Administrator access required</h2><p>Only panel administrators can open this server's admin tools.</p></Card>;
  const id = serverAdminID(server.internal_id);
  if (id === null) return <ErrorBox>This server's internal ID is unavailable. Reload the server before opening admin tools.</ErrorBox>;
  return <AuthorizedServerTools key={id} serverID={id} />;
}

function AuthorizedServerTools({ serverID }: { serverID: number }) {
  const { reload } = useServer();
  const query = useAPI(`/api/application/servers/${serverID}?include=allocations,variables,user,node,egg`);
  const [active, setActive] = useState("overview");
  const [configurationDirty, setConfigurationDirty] = useState(false);
  const record = query.data ? unwrap(query.data) : null;
  const scope = `server-admin-${serverID}`;
  const discard = () => !configurationDirty || window.confirm("Discard unsaved installation and process changes?");
  const saved = () => { query.reload(); reload(); };
  return <section className="server-admin-tools" aria-label="Server admin tools">
    <div className="toolbar server-page-toolbar">
      <div><h2>Server admin tools</h2><p className="muted">Manage {record?.name || "this server"}. Changes are limited to this server.</p></div>
      <Button variant="secondary" disabled={query.loading || configurationDirty} onClick={query.reload}>Refresh server details</Button>
    </div>
    <ErrorBox>{query.error}</ErrorBox>
    <ServerSettingsTabs scope={scope} tabs={tabs} active={active} onChange={tab => {
      if (tab === active || !discard()) return;
      setConfigurationDirty(false);
      setActive(tab);
    }} />
    {query.loading && !record ? <Loading /> : record && serverAdminID(record.id) !== serverID
      ? <ErrorBox>The returned server does not match this workspace. Reload before making changes.</ErrorBox>
      : record && <section role="tabpanel" id={`${scope}-panel-${active}`} aria-labelledby={`${scope}-tab-${active}`} tabIndex={0}>
        {active === "overview" && <SettingsSection title="Server information">
          <div className="server-admin-summary">{[
            ["Name", record.name], ["Internal ID", serverID], ["UUID", record.uuid],
            ["Status", record.status || "Ready"], ["Node", record.node ?? record.node_id],
            ["Owner", record.user ?? record.owner_id], ["Template", record.egg ?? record.egg_id],
            ["Installed", record.container?.installed ? "Yes" : "No"],
          ].map(([label, value]) => <SettingsRow key={String(label)} label={String(label)} control={<span className="settings-value">{String(value ?? "Unavailable")}</span>}/>)}</div>
          <div className="server-admin-note"><p className="settings-note">Use Runtime for the next start, Installation &amp; process for server overrides, and Manage for explicit lifecycle actions.</p></div>
        </SettingsSection>}
        {active === "details" && <Details record={record} onSaved={saved} />}
        {active === "limits" && <Build record={record} onSaved={saved} />}
        {active === "runtime" && <Startup record={record} onSaved={saved} contextual />}
        {active === "databases" && <ServerDatabases record={record} />}
        {active === "mounts" && <ServerMounts record={record} contextual />}
        {active === "configuration" && <ServerConfigurationEditor serverID={serverID} onSaved={saved} onDirtyChange={setConfigurationDirty} />}
        {active === "manage" && <><Manage record={record} onSaved={saved} /><DeleteServer record={record} returnTo="/" /></>}
      </section>}
  </section>;
}

export function ServerConfigurationEditor({ serverID, onSaved, onDirtyChange }: {
  serverID: number;
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const endpoint = `/api/client/servers/${serverID}/configuration`;
  const query = useAPI(endpoint);
  const [configuration, setConfiguration] = useState<ServerConfiguration | null>(null);
  const [draft, setDraft] = useState<ConfigurationDraft>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const dirty = configuration !== null && JSON.stringify(draft) !== JSON.stringify(configurationDraft(configuration));
  useEffect(() => {
    if (!query.data) return;
    const next = unwrap(query.data) as ServerConfiguration;
    setConfiguration(next);
    setDraft(configurationDraft(next));
  }, [query.data]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const reloadCurrent = () => {
    if (busy || (dirty && !window.confirm("Discard your unsaved draft and load the current server configuration?"))) return;
    setError(""); setSuccess(""); query.reload();
  };
  if (!configuration) return <Card><h3>Installation &amp; process</h3><ErrorBox>{query.error}</ErrorBox>
    {query.loading ? <Loading /> : <Button variant="secondary" onClick={query.reload}>Retry configuration</Button>}
  </Card>;

  const editable = configuration.can_update && !busy && !query.loading && !query.error;
  const change = (key: ConfigurationKey, value?: string) => {
    setDraft(current => {
      const next = { ...current };
      if (value === undefined) delete next[key]; else next[key] = value;
      return next;
    });
    setSuccess("");
  };
  const renderField = (field: typeof configurationFields[number]) => {
    const overridden = Object.hasOwn(draft, field.key);
    const managed = configuration.managed && field.group === "installation";
    const id = `server-configuration-${serverID}-${field.key}`;
    const text = overridden ? draft[field.key]! : fieldText(configuration.defaults[field.key]);
    const changed = overridden !== Object.hasOwn(configuration.overrides, field.key)
      || overridden && draft[field.key] !== configurationDraft(configuration)[field.key];
    const controls = <>
      <div className="server-configuration-field-heading"><label htmlFor={id}>{field.label}</label>
        <span className="badge">{overridden ? "Server override" : "Inherited from template"}{changed ? " · Unsaved" : ""}</span>
      </div>
      <p id={`${id}-hint`} className="muted">{field.hint}</p>
      <div className="actions server-configuration-inheritance">
        <label><Switch checked={overridden} disabled={!editable || managed && !overridden}
          onCheckedChange={checked => change(field.key, checked ? fieldText(configuration.effective[field.key]) : undefined)} />Override for this server</label>
        {overridden && <Button variant="secondary" disabled={!editable} onClick={() => change(field.key)}>Reset {field.label.toLowerCase()} to template</Button>}
      </div>
      {field.kind === "text" ? <input id={id} value={text} disabled={!editable || managed || !overridden} aria-describedby={`${id}-hint`} onChange={event => change(field.key, event.target.value)} />
        : <textarea id={id} value={text} rows={field.kind === "script" ? 14 : 7} spellCheck={false}
          disabled={!editable || managed || !overridden} aria-describedby={`${id}-hint`} onChange={event => change(field.key, event.target.value)} />}
    </>;
    return field.kind === "script" ? <details key={field.key} className="server-configuration-field server-admin-advanced">
      <summary>Installation script{changed ? " · Unsaved" : ""}</summary>{controls}
    </details> : <div key={field.key} className="server-configuration-field">{controls}</div>;
  };
  return <form className="server-configuration-editor" onSubmit={async event => {
    event.preventDefault();
    if (!editable || !dirty) return;
    setError(""); setSuccess("");
    try {
      const body = configurationRequest(configuration, draft);
      setBusy(true);
      const response = await api(endpoint, { method: "PUT", body: JSON.stringify(body) });
      const next = unwrap(response);
      if (next?.revision) {
        setConfiguration(next);
        setDraft(configurationDraft(next));
      } else {
        query.reload();
      }
      setSuccess("Server overrides saved. Process changes apply on the next start. Installer changes apply on the next install or reinstall. Nothing was started or reinstalled.");
      onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }}>
    <Card><h3>Installation &amp; process</h3>
      <p>These overrides belong to this server. Inherited fields continue to follow the template <strong>{configuration.template.name}</strong>.</p>
      <div className="server-configuration-status"><span className="muted">Revision <code>{configuration.revision}</code></span>
        <Button variant="secondary" disabled={busy || query.loading} onClick={reloadCurrent}>Reload current settings</Button>
      </div>
      {!configuration.can_update && <p role="status" className="muted">{configuration.update_unavailable_reason || "Editing is unavailable. Stop the server, then reload configuration to check again."}</p>}
      <p className="muted">The server must be stopped to save. The backend checks its state and revision again when saving.</p>
      <ErrorBox>{error || query.error}</ErrorBox>
      {success && <p className="success" role="status">{success}</p>}
    </Card>
    <Card><h3>Process configuration</h3><p className="muted">Applies on the next start. Saving does not restart the running process.</p>
      {configurationFields.filter(field => field.group === "process").map(renderField)}
    </Card>
    <details className="card server-admin-advanced">
      <summary>Installation settings · Next install or reinstall only</summary>
      <p className="muted">Saving never runs the installer. Review changes before explicitly requesting a reinstall under Manage.</p>
      {configuration.managed && <p role="status" className="muted">This server uses a managed installer. Installer overrides are unavailable. Use its managed installation controls. Process overrides can still be edited when the server is stopped.</p>}
      {configurationFields.filter(field => field.group === "installation").map(renderField)}
    </details>
    <div className="actions"><Button type="submit" disabled={!editable || !dirty}>{busy ? "Saving server overrides..." : "Save server overrides"}</Button>
      <span className="muted" role="status">{dirty ? "Unsaved changes. Saving does not reinstall." : "No unsaved changes."}</span>
    </div>
  </form>;
}

