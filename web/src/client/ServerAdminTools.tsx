import {Feedback} from '../notifications';
import {usePendingSetting} from './PendingSettings';
import {Input as MiraInput} from '../components/ui/input';
import {Textarea as MiraTextarea} from '../components/ui/textarea';
import './gameSwitch.css';
import { useEffect, useState } from "react";
import { api, Button, Card, ErrorBox, unwrap, useAPI } from "../lib";
import {SettingsSkeleton} from '../ui/SettingsSkeleton';
import {ServerPageSkeleton} from '../ui/ServerPageSkeleton';
import {
  Build, DeleteServer, Details, ServerLifecycle, Transfer, ServerMounts,
  ServerSettingsTabs, RuntimeAssignment, Startup,
} from "../admin/servers";
import {useLocation,useSearchParams} from 'react-router-dom';
import {settingsTab,settingsTabSearch} from './settingsNavigation';
import {Settings,Network} from './Operations';
import ServerStartup from "./ServerStartup";
import { can, useServer } from "./common";
import {Switch,SettingsRow,SettingsSection,SettingsLayout} from '../ui/Settings';
import "./serverAdminTools.css";

const tabs = [
  ["general", "General"], ["network", "Network"], ["runtime", "Startup"], ["limits", "Resources"], ["mounts", "Mounts"],
  ["configuration", "Advanced"], ["manage", "Transfer"],
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
  const location = useLocation();
  const account = useAPI("/api/client/account");
  if (account.loading && !account.data) return <ServerPageSkeleton path={location.pathname+location.search}/>;
  if (account.error) return <Card><ErrorBox>{account.error}</ErrorBox><Button variant="secondary" onClick={account.reload}>Retry administrator check</Button></Card>;
  // Ownership and wildcard server permissions do not grant panel administration.
  // Each application/admin/configuration endpoint also enforces backend admin auth.
  if (unwrap(account.data)?.root_admin !== true) return <SettingsLayout><ClientRuntimeTools/></SettingsLayout>;
  const id = serverAdminID(server.internal_id);
  if (id === null) return <ErrorBox>This server's internal ID is unavailable. Reload the server before opening resource controls.</ErrorBox>;
  return <SettingsLayout><AuthorizedServerTools key={id} serverID={id} /></SettingsLayout>;
}

function ClientRuntimeTools() {
  const {permissions} = useServer();
  const [search,setSearch] = useSearchParams();
  const clientTabs: [string,string][]=[['general','General'],...(can(permissions,'allocation.read')?[["network","Network"] as [string,string]]:[]),...(can(permissions,'startup.read')?[["runtime","Startup"] as [string,string]]:[])];
  const allowed=clientTabs.map(([id])=>id);
  const active=settingsTab(search,allowed);
  return <section className="server-admin-tools settings-responsive" aria-label="Server settings">
    <ServerSettingsTabs scope="client-runtime" tabs={clientTabs} active={active} onChange={tab=>{if(tab!==active)setSearch(settingsTabSearch(search,tab),{preventScrollReset:true})}}/>
    <section role="tabpanel" id={`client-runtime-panel-${active}`} aria-labelledby={`client-runtime-tab-${active}`} tabIndex={0}>
      {active === 'general' ? <Settings/> : active === 'network' ? <Network/> : <ServerStartup section="runtime"/>}
    </section>
  </section>;
}

function AuthorizedServerTools({ serverID }: { serverID: number }) {
  const { reload, permissions } = useServer();
  const [search,setSearch] = useSearchParams();
  const visibleTabs=tabs.filter(([id])=>id!=='network'||can(permissions,'allocation.read'));
  const active=settingsTab(search,visibleTabs.map(([id])=>id));
  const query = useAPI(active==='network'?null:`/api/application/servers/${serverID}?include=allocations,variables,user,node,egg`);
  const record = query.data ? unwrap(query.data) : null;
  const scope = `server-admin-${serverID}`;
  const saved = () => { query.reload(); reload(); };
  return <section className="server-admin-tools settings-responsive" aria-label="Server settings">
    <ErrorBox>{query.error}</ErrorBox>
    {query.error && <Button variant="secondary" onClick={()=>{query.reload();reload();}}>Retry</Button>}
    <ServerSettingsTabs scope={scope} tabs={visibleTabs} active={active} onChange={tab => {
      // The shared route blocker handles dirty drafts for clicks and Back/Forward.
      if(tab!==active)setSearch(settingsTabSearch(search,tab),{preventScrollReset:true});
    }} />
    {active==='network' ? <section key={active} role="tabpanel" id={`${scope}-panel-${active}`} aria-labelledby={`${scope}-tab-${active}`} tabIndex={0}><Network/></section> : query.loading && !record ? <SettingsSkeleton variant={active==='general'?'general':'rows'} /> : query.error ? null : record && serverAdminID(record.id) !== serverID
      ? <ErrorBox>The returned server does not match this workspace. Reload before making changes.</ErrorBox>
      : record && <section key={active} role="tabpanel" id={`${scope}-panel-${active}`} aria-labelledby={`${scope}-tab-${active}`} tabIndex={0}>
        {active === "general" && <>
          <Settings details={<Details record={record} onSaved={saved}/>} showReinstall={false}/>
          <ServerLifecycle record={record} onSaved={saved}/>
          <DeleteServer record={record} returnTo="/"/>
        </>}
        {active === "limits" && <Build record={record} onSaved={saved} />}
        {active === "runtime" && <ServerStartup section="runtime" administrator showCommandPreview={false} runtimeCommand={<RuntimeAssignment record={record} onSaved={saved}/>}/>}
        {active === "mounts" && <ServerMounts record={record} contextual />}
        {active === "configuration" && <><Startup record={record} onSaved={saved} contextual restrictedOnly/><ServerConfigurationEditor serverID={serverID} onSaved={saved} /></>}
        {active === "manage" && <Transfer record={record} onSaved={saved}/>}
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
  const [error, setError] = useState('');
  const [success, setSuccess] = useState("");
  const dirty = configuration !== null && JSON.stringify(draft) !== JSON.stringify(configurationDraft(configuration));
  useEffect(() => {
    if (!query.data || dirty) return;
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

  async function saveConfiguration(){
    if (!configuration || !configuration.can_update || busy || !dirty) return;
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

    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));throw error;
    } finally {
      setBusy(false);
    }
  }
  usePendingSetting(`configuration:${serverID}`,dirty,{blocked:!configuration?.can_update||busy||query.loading||!!query.error,save:saveConfiguration,afterSave:onSaved,discard:()=>{if(configuration)setDraft(configurationDraft(configuration));setError('')}});
  if (!configuration) return <Card><h3>Installation &amp; process</h3><ErrorBox>{query.error}</ErrorBox>
    {query.loading ? <SettingsSkeleton /> : <Button variant="secondary" onClick={query.reload}>Retry configuration</Button>}
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
    return <SettingsRow key={field.key} className={`server-configuration-option server-configuration-${field.kind}`}
      label={<><label htmlFor={id}>{field.label}</label><span className="server-configuration-state">{changed ? "Unsaved" : overridden ? "Server override" : "Template default"}</span></>}
      description={<span id={`${id}-hint`}>{field.hint}</span>}
      control={<div className="server-configuration-inheritance">
        <span className="muted">Override</span>
        <Switch aria-label={`Override ${field.label}`} checked={overridden} disabled={!editable || managed && !overridden}
          onCheckedChange={checked => change(field.key, checked ? fieldText(configuration.effective[field.key]) : undefined)} />
        {overridden && <Button variant="secondary" disabled={!editable} onClick={() => change(field.key)}>Use template</Button>}
      </div>}>
      {field.kind === "text" ? <MiraInput id={id} value={text} disabled={!editable || managed || !overridden} aria-describedby={`${id}-hint`} onChange={event => change(field.key, event.target.value)} />
        : <MiraTextarea id={id} value={text} rows={field.kind === "script" ? 10 : 5} spellCheck={false}
          disabled={!editable || managed || !overridden} aria-describedby={`${id}-hint`} onChange={event => change(field.key, event.target.value)} />}
    </SettingsRow>;
  };
  return <form className="server-configuration-editor" onSubmit={event=>{event.preventDefault();void saveConfiguration().catch(()=>{})}}>
    <div className="server-configuration-notice">
      {!configuration.can_update && <><Feedback tone="error" message={<>{configuration.update_unavailable_reason || "Stop the server, then reopen this tab to edit."}</>}/></>}
      <ErrorBox>{error || query.error}</ErrorBox>
      {success && <Feedback tone="success" message={<>{success}</>}/>}
    </div>
    <SettingsSection title="Process configuration" className="server-configuration-section"><div className="server-configuration-grid">
      {configurationFields.filter(field => field.group === "process").map(renderField)}
    </div></SettingsSection>
    <SettingsSection title="Installation settings" className="server-configuration-section">
      <p className="settings-section-note">Applies on the next install or reinstall.</p>
      {configuration.managed && <p role="status" className="settings-section-note">Managed installer. Use the game's installation controls to change it.</p>}
      <div className="server-configuration-grid">
      {configurationFields.filter(field => field.group === "installation").map(renderField)}
    </div></SettingsSection>

  </form>;
}

