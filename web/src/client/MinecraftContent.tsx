import {SectionTabs} from "../ui/SectionTabs";
import './games-ui.css';
import { useState } from "react";
import { Link } from "react-router-dom";
import { GameSwitch } from "./GameSwitch";
import { api, Button, Card, ErrorBox, Field, Input, Modal, Select, unwrap, useAPI } from "../lib";
import "./minecraftContent.css";

type Project = { id: string; name: string; summary: string; icon_url: string; author: string; project_url?: string; compatibility?: string };
type Installed = { file: string; size: number };
type Catalog = {
  supported: boolean; reason: string; provider: string; minecraft_version: string;
  loader: string; loader_version: string; content_type: "mod" | "plugin";
  projects: Project[]; installed: Installed[]; can_install: boolean; can_remove: boolean;
  provider_available: boolean; provider_message: string;
  compatibility?: string; include_unverified?: boolean;
  server_compatibility_unknown?: boolean;
};
type Release = { id: string; name: string; filename: string; size: number; blocked_reason?: string };
type Versions = { versions: Release[]; server_compatibility_unknown: boolean; provider_message?: string };

export function MinecraftContent({ server }: { server: string }) {
  return <MinecraftContentView key={server} server={server} />;
}
export default MinecraftContent;

function MinecraftContentView({ server }: { server: string }) {
  const base = `/api/client/servers/${encodeURIComponent(server)}/minecraft/content`;
  const [provider, setProvider] = useState("curseforge");
  const [tab, setTab] = useState("curseforge");
  const [installedSearch, setInstalledSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [compatibility, setCompatibility] = useState("server");
  const [includeUnverified, setIncludeUnverified] = useState(false);
  const [selected, setSelected] = useState<Project | null>(null);
  const [removing, setRemoving] = useState<Installed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const catalog = useAPI(`${base}?${new URLSearchParams({ provider, query, compatibility, include_unverified:String(includeUnverified) })}`);
  const data = unwrap(catalog.data) as Catalog | null;
  const isCurrent = !catalog.loading && data?.provider === provider && (data.compatibility??"server") === compatibility && !!data.include_unverified === includeUnverified;
  const noun = data?.content_type === "plugin" ? "plugins" : "mods";
  const tabs = [["curseforge", "CurseForge"], ["modrinth", "Modrinth"], ["installed", "Installed"]];
  function changeTab(id: string) {
    if (busy) return;
    setTab(id); setSelected(null); setError(""); setNotice("");
    if (id !== "installed") {setProvider(id); setCompatibility("server"); setIncludeUnverified(false);}
  }

  async function remove() {
    if (!removing || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`${base}/file`, { method: "DELETE", body: JSON.stringify({ file: removing.file }) });
      setNotice(`Removed ${removing.file}.`);
      setRemoving(null); catalog.reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return <div className="minecraft-content games-ui">
    <header className="page-header mc-content-header"><h2>{noun === "plugins" ? "Plugins" : "Mods"}</h2>{data?.supported && <div className="mc-content-context"><span className="badge">Minecraft {data.minecraft_version}</span><span className="badge">{data.loader}{data.loader_version ? ` ${data.loader_version}` : ""}</span></div>}<Button variant="secondary" disabled={catalog.loading || busy} onClick={catalog.reload}>Refresh</Button></header>
    <ErrorBox>{catalog.error || error}</ErrorBox>
    {notice && <p className="success" role="status">{notice}</p>}
    {!data && catalog.loading && <p role="status">Loading server content...</p>}
    {data && !data.supported && <Card><h2>Catalog unavailable</h2><p>{data.reason}</p></Card>}
    {data?.supported && <>
      <SectionTabs label="Minecraft content" className="mc-content-tabs" scope="mc-content" active={tab} onChange={changeTab} disabled={busy} items={tabs.map(([id,name])=>({id,label:<>{name}{id==='installed'&&<span className="mc-content-count">{data.installed.length}</span>}</>,controls:'mc-content-panel'}))}/>
      <section id="mc-content-panel" role="tabpanel" aria-labelledby={`mc-content-tab-${tab}`} className="mc-content-panel">
        {tab === "installed" ? <>
          <div className="mc-installed-toolbar"><Input type="search" aria-label={`Filter installed ${noun}`} placeholder={`Filter installed ${noun}...`} value={installedSearch} onChange={event => setInstalledSearch(event.target.value)}/><Link to={`/server/${encodeURIComponent(server)}/files?directory=%2F${noun}`}>Open folder</Link></div>
          {data.installed.length === 0 ? <p className="mc-content-empty">No {noun} installed.</p> : <ul className="mc-installed">{data.installed.filter(file => file.file.toLowerCase().includes(installedSearch.toLowerCase())).map(file => <li key={file.file}><div><strong>{file.file}</strong><small className="muted">{formatSize(file.size)}</small></div><Button variant="danger" disabled={!data.can_remove || busy || catalog.loading} onClick={() => {setError("");setRemoving(file);}}>Remove</Button></li>)}</ul>}
          {data.installed.length > 0 && !data.installed.some(file => file.file.toLowerCase().includes(installedSearch.toLowerCase())) && <p className="mc-content-empty">No matching files.</p>}
          {!data.can_remove && <p className="muted mc-content-note">Read-only. File delete permission is required to remove content.</p>}
        </> : <>
          <form className="mc-content-search" onSubmit={event => {event.preventDefault();setQuery(draft.trim());if (query === draft.trim()) catalog.reload();}}><Input aria-label={`Search ${provider === "modrinth" ? "Modrinth" : "CurseForge"}`} value={draft} maxLength={150} placeholder={`Search ${noun}...`} onChange={event => setDraft(event.target.value)}/>{provider === "modrinth" && data.content_type === "mod" && <Select aria-label="Compatibility" value={compatibility} disabled={busy} onChange={event => {setCompatibility(event.target.value);setSelected(null);}}><option value="server">Server compatible</option><option value="server_only">No client mod required</option></Select>}<Button type="submit" disabled={catalog.loading || busy}>Search</Button></form>
          {provider === "curseforge" && data.server_compatibility_unknown && data.provider_available && <div className="mc-content-filters"><label className="mc-content-ack"><GameSwitch checked={includeUnverified} disabled={busy} onCheckedChange={checked => {setIncludeUnverified(checked);setSelected(null);}}/><span>Show unverified {noun}</span></label><span className="muted">Server compatibility unknown</span></div>}
          {isCurrent && !data.provider_available && data.provider_message && <p className="mc-content-provider-status" role="status">{data.provider_message}</p>}
          {!data.can_install && <p className="muted mc-content-note">Read-only. File create permission is required to install content.</p>}
          {catalog.loading ? <p className="mc-content-empty" role="status">Searching...</p> : isCurrent && data.provider_available && <>
            {data.projects.length === 0 ? <p className="mc-content-empty">{provider === "curseforge" && data.server_compatibility_unknown && !includeUnverified ? `Enable unverified results to browse ${noun}.` : `No matching ${noun}. Try another search.`}</p> : <div className="mc-content-projects">{data.projects.map(project => <Card key={project.id} className="mc-content-project"><div className="mc-project-heading">{project.icon_url && <img src={project.icon_url} alt="" width={36} height={36} loading="lazy" referrerPolicy="no-referrer"/>}<div><h3>{project.name}</h3><small className="muted">{project.author}</small></div></div><p title={project.summary}>{project.summary}</p><footer><span className="badge">{compatibilityLabel(project.compatibility)}</span><Button variant="secondary" disabled={busy} onClick={() => {setSelected(project);setError("");}}>Versions</Button></footer></Card>)}</div>}
          </>}
        </>}
        <p className="muted mc-content-note">Stop the server before installing or removing content.</p>
      </section>
    </>}
    {selected && data?.supported && <ContentVersions key={`${server}:${provider}:${compatibility}:${selected.id}`} base={base} provider={provider} compatibility={compatibility} includeUnverified={includeUnverified} project={selected} canInstall={data.can_install} onClose={() => setSelected(null)} onInstalled={message => { setNotice(message); setSelected(null); catalog.reload(); }} />}
    {removing && <Modal title="Remove content" onClose={() => { if (!busy) setRemoving(null); }}><p>Remove <strong>{removing.file}</strong> from this server? Its configuration files will stay in place.</p><ErrorBox>{error}</ErrorBox><div className="actions"><Button variant="secondary" disabled={busy} onClick={() => setRemoving(null)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={remove}>{busy ? "Removing..." : "Remove file"}</Button></div></Modal>}
  </div>;
}

function ContentVersions({ base, provider, compatibility, includeUnverified, project, canInstall, onClose, onInstalled }: { base: string; provider: string; compatibility:string; includeUnverified:boolean; project: Project; canInstall: boolean; onClose: () => void; onInstalled: (message: string) => void }) {
  const result = useAPI(`${base}/${provider}/${encodeURIComponent(project.id)}/versions?${new URLSearchParams({compatibility,include_unverified:String(includeUnverified)})}`);
  const data = unwrap(result.data) as Versions | null;
  const [version, setVersion] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen = data?.versions.find(v => v.id === version);
  async function install() {
    if (!chosen || busy) return;
    setBusy(true); setError("");
    try {
      const response = unwrap(await api(`${base}/install?${new URLSearchParams({compatibility,include_unverified:String(includeUnverified)})}`, { method: "POST", body: JSON.stringify({ provider, project_id: project.id, version_id: chosen.id, confirm_server_compatibility: confirmed }) }));
      if (!Array.isArray(response?.files) || response.files.length === 0) throw new Error("The server did not confirm installed files.");
      onInstalled(`${project.name} installed. Applies on the next start.`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <Modal title={project.name} onClose={() => { if (!busy) onClose(); }}>
    <ErrorBox>{result.error || error}</ErrorBox>
    {result.loading && <p role="status">Loading compatible versions...</p>}
    {data && <>
      {data.versions.length === 0 ? <p>No downloadable versions match this Minecraft version and loader.</p> : <>
        <Field label="Version"><Select value={version} disabled={busy} onChange={e => { setVersion(e.target.value); setConfirmed(false); }}><option value="">Select a version</option>{data.versions.map(v => <option key={v.id} value={v.id}>{v.name}{v.blocked_reason ? " - unavailable" : ""}</option>)}</Select></Field>
        {chosen && <p className="muted">{chosen.filename} · {formatSize(chosen.size)}</p>}
        {chosen?.blocked_reason && <ErrorBox>{chosen.blocked_reason}</ErrorBox>}
        {project.project_url && <p><a href={project.project_url} target="_blank" rel="noopener noreferrer">Read the author's instructions</a></p>}
        <p className="muted">Includes required dependencies. Existing files are preserved.</p>
        {data.server_compatibility_unknown && <div className="mc-content-warning"><p>{data.provider_message || "Server compatibility is unverified. Check the author's instructions."}</p><label className="mc-content-ack"><GameSwitch checked={confirmed} disabled={busy} onCheckedChange={checked => setConfirmed(checked)}/><span>I checked that this release supports my server.</span></label></div>}
        <div className="actions"><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy || !canInstall || !chosen || !!chosen.blocked_reason || (data.server_compatibility_unknown && !confirmed)} onClick={install}>{busy ? "Installing and checking dependencies..." : "Install"}</Button></div>
      </>}
    </>}
  </Modal>;
}

function formatSize(bytes: number) { return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MiB` : `${Math.ceil(bytes / 1024)} KiB`; }
function compatibilityLabel(compatibility?:string){return ({server_only:"No client mod required",client_and_server:"Also required on clients",server_optional:"Client required · Server optional",unknown:"Server support unverified",server_compatible:"Server compatible"} as Record<string,string>)[compatibility??""]??"Server compatible"}

