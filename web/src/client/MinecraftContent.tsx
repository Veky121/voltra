import { useState } from "react";
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
  const [provider, setProvider] = useState("modrinth");
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

  async function remove() {
    if (!removing || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`${base}/file`, { method: "DELETE", body: JSON.stringify({ file: removing.file }) });
      setNotice(`Removed ${removing.file}. The change takes effect on the next server start.`);
      setRemoving(null); catalog.reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return <div className="minecraft-content page">
    <header className="page-header"><div><h1>Minecraft content</h1><p className="muted">Browse and install mods or plugins for this server.</p></div><Button variant="secondary" disabled={catalog.loading || busy} onClick={catalog.reload}>Refresh</Button></header>
    <ErrorBox>{catalog.error || error}</ErrorBox>
    {notice && <p className="success" role="status">{notice}</p>}
    {!data && catalog.loading && <p role="status">Loading server content...</p>}
    {data && !data.supported && <Card><h2>Catalog unavailable</h2><p>{data.reason}</p></Card>}
    {data?.supported && <>
      <div className="mc-content-context"><span className="badge">Minecraft {data.minecraft_version}</span><span className="badge">{data.loader}{data.loader_version ? ` ${data.loader_version}` : ""}</span><span className="muted">Stop the server before installing or removing files. Changes apply on the next start.</span></div>
      <section aria-labelledby="mc-installed-title"><h2 id="mc-installed-title">Installed {noun}</h2>
        <p className="muted">JAR files in /{noun}. Other files and configuration stay in Files.</p>
        {data.installed.length === 0 ? <p>No {noun} installed.</p> : <ul className="mc-installed">{data.installed.map(file => <li key={file.file}><div><strong>{file.file}</strong><small className="muted">{formatSize(file.size)}</small></div><Button variant="danger" disabled={!data.can_remove || busy || catalog.loading} onClick={() => { setError(""); setRemoving(file); }}>Remove</Button></li>)}</ul>}
        {!data.can_remove && <p className="muted">File delete permission is required to remove content.</p>}
      </section>
      <section aria-labelledby="mc-browse-title"><h2 id="mc-browse-title">Find {noun}</h2>
        <div className="tabs" role="tablist" aria-label="Content provider">{[["modrinth", "Modrinth"], ["curseforge", "CurseForge"]].map(([id, name]) => <button key={id} type="button" role="tab" aria-selected={provider === id} className={provider === id ? "active" : ""} disabled={busy} onClick={() => { setProvider(id); setCompatibility("server"); setIncludeUnverified(false); setSelected(null); setError(""); }}>{name}</button>)}</div>
        {(data.content_type === "mod" || (provider === "curseforge" && data.server_compatibility_unknown)) && <div className="mc-content-filters">
          {provider === "modrinth" ? <Field label="Compatibility"><Select value={compatibility} disabled={busy} onChange={e=>{setCompatibility(e.target.value);setSelected(null)}}><option value="server">All server-compatible mods</option><option value="server_only">Works without client mods</option></Select></Field> : <label className="mc-content-ack"><input type="checkbox" checked={includeUnverified} disabled={busy} onChange={e=>{setIncludeUnverified(e.target.checked);setSelected(null)}}/><span>Show unverified CurseForge {noun}</span></label>}
          <p className="muted">{provider === "modrinth" ? "Client-only and singleplayer-only projects are excluded. " : data.content_type === "plugin" ? "Check the author's explicit support for this server before installing. " : "Unverified results may contain client-only mods. "}Minecraft version and loader are matched automatically.</p>
        </div>}
        <form className="mc-content-search" onSubmit={e => { e.preventDefault(); setQuery(draft.trim()); if (query === draft.trim()) catalog.reload(); }}><Field label={`Search ${provider === "modrinth" ? "Modrinth" : "CurseForge"}`}><Input value={draft} maxLength={150} placeholder={`Search ${noun}`} onChange={e => setDraft(e.target.value)} /></Field><Button type="submit" disabled={catalog.loading || busy}>Search</Button></form>
        {isCurrent && data.provider_message && <p className="mc-content-warning" role="status">{data.provider_message}</p>}
        {!data.can_install && <p className="muted">File create permission is required to install content.</p>}
        {catalog.loading ? <p role="status">Searching {provider === "modrinth" ? "Modrinth" : "CurseForge"}...</p> : isCurrent && data.provider_available && <>
          <p className="muted">Results match Minecraft {data.minecraft_version} and {data.loader}. Required dependencies are checked before installation.</p>
          {data.projects.length === 0 ? <p>{provider === "curseforge" && data.server_compatibility_unknown && !includeUnverified ? `Enable unverified results to browse CurseForge ${noun}.` : `No matching ${noun} found. Try another search.`}</p> : <div className="mc-content-projects">{data.projects.map(project => <Card key={project.id} className="mc-content-project">
            <div className="mc-project-heading">{project.icon_url && <img src={project.icon_url} alt="" width={48} height={48} loading="lazy" referrerPolicy="no-referrer" />}<div><h3>{project.name}</h3><small className="muted">{project.author}</small></div></div><span className="badge">{compatibilityLabel(project.compatibility)}</span><p>{project.summary}</p><Button variant="secondary" disabled={busy} onClick={() => { setSelected(project); setError(""); }}>View versions</Button>
          </Card>)}</div>}
        </>}
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
      onInstalled(`Installed ${response.files.join(", ")}. Changes take effect on the next server start.`);
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
        <p>Compatible required dependencies will be installed too. Existing files are preserved. Conflicting or unresolved dependencies block the install.</p>
        {data.server_compatibility_unknown && <div className="mc-content-warning"><p>{data.provider_message || "CurseForge does not report dedicated server support. A matching Minecraft version and loader do not guarantee server compatibility."}</p><label className="mc-content-ack"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /><span>I checked the author's instructions for this content and its dependencies and want to install it on this server.</span></label></div>}
        <div className="actions"><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy || !canInstall || !chosen || !!chosen.blocked_reason || (data.server_compatibility_unknown && !confirmed)} onClick={install}>{busy ? "Installing and checking dependencies..." : "Install"}</Button></div>
      </>}
    </>}
  </Modal>;
}

function formatSize(bytes: number) { return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MiB` : `${Math.ceil(bytes / 1024)} KiB`; }
function compatibilityLabel(compatibility?:string){return ({server_only:"No client mod required",client_and_server:"Also required on clients",server_optional:"Client required · Server optional",unknown:"Server support unverified",server_compatible:"Server compatible"} as Record<string,string>)[compatibility??""]??"Server compatible"}
