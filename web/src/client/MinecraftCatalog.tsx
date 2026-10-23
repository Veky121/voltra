import {useEffect, useState} from "react";
import {Button, ErrorBox, Field, Input, Select} from "../lib";
import {MinecraftDialog} from "./MinecraftDialog";
import {MinecraftSegments} from "./MinecraftSegments";
import {minecraftAPI, useMinecraftRequest} from "./MinecraftLibrary";
import type {MinecraftOptions, MinecraftPack, MinecraftPackSelection, MinecraftPackVersion, PackProvider} from "./MinecraftLibrary";

type Catalog = {projects: MinecraftPack[]; total: number; offset: number; limit: number; provider: PackProvider};

export function MinecraftPackIcon({pack}: {pack: MinecraftPack}) {
  const [failed, setFailed] = useState(false);
  return <span className="mc-pack-icon" aria-hidden="true">{pack.icon_url && !failed ? <img src={pack.icon_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/> : <span>{pack.name.slice(0, 1).toUpperCase()}</span>}</span>;
}

export function MinecraftCatalog({options, initialQuery, onSelect}: {options: MinecraftOptions; initialQuery: string; onSelect: (pack: MinecraftPackSelection) => void}) {
  const [provider, setProvider] = useState<PackProvider>("curseforge");
  const [search, setSearch] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery.trim());
  const [version, setVersion] = useState("");
  const [loader, setLoader] = useState("");
  const [offset, setOffset] = useState(0);
  const [project, setProject] = useState<MinecraftPack | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {setQuery(search.trim()); setOffset(0);}, 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams({provider, query, offset: String(offset), version, loader});
  const request = useMinecraftRequest<Catalog>(`${minecraftAPI}/modpacks?${params}`);
  const pendingSearch = query !== search.trim();
  const data = request.data;
  const changeProvider = (next: PackProvider) => {setProvider(next); setOffset(0); setProject(null);};
  return <section className="mc-catalog" aria-label="Modpack catalog">
    <div className="mc-catalog-top"><h2>Modpacks</h2><MinecraftSegments label="Modpack provider" value={provider} options={[{id: "curseforge", name: "CurseForge"}, {id: "modrinth", name: "Modrinth"}]} onChange={changeProvider}/></div>
    <form className="mc-catalog-filters" role="search" onSubmit={e => {e.preventDefault(); setQuery(search.trim()); setOffset(0);}}>
      <Field label="Search"><Input type="search" placeholder={`Search ${provider === "curseforge" ? "CurseForge" : "Modrinth"} modpacks`} value={search} onChange={e => setSearch(e.target.value)}/></Field>
      <Field label="Minecraft version"><Select value={version} onChange={e => {setVersion(e.target.value); setOffset(0);}}><option value="">All versions</option>{options.versions.map(item => <option key={item} value={item}>{item}</option>)}</Select></Field>
      <Field label="Loader"><Select value={loader} onChange={e => {setLoader(e.target.value); setOffset(0);}}><option value="">All loaders</option>{options.loaders.filter(item => !["vanilla", "paper"].includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
    </form>
    <div aria-live="polite" className="mc-catalog-count">{request.loading || pendingSearch ? "Searching modpacks..." : data ? `${data.total.toLocaleString()} ${data.total === 1 ? "modpack" : "modpacks"}` : ""}</div>
    <ErrorBox>{request.error}</ErrorBox>
    {request.error && <Button variant="secondary" onClick={request.reload}>Retry catalog</Button>}
    {request.loading || pendingSearch ? <div className="mc-state" role="status"><span className="spinner"/>Loading modpacks...</div> : data && <>
      {data.projects.length === 0 ? <div className="mc-state">No modpacks match these filters. Try another search or version.</div> : <div className="mc-pack-grid">{data.projects.map(pack => <article key={`${provider}:${pack.id}`} className="mc-pack-card">
        <div className="mc-pack-heading"><MinecraftPackIcon pack={pack}/><div><h3>{pack.name}</h3>{pack.author && <p>by {pack.author}</p>}</div></div>
        <p className="mc-pack-description">{pack.summary || "No description provided."}</p>
        <footer><span className="muted">{typeof pack.downloads === "number" ? `${new Intl.NumberFormat(undefined, {notation: "compact", maximumFractionDigits: 1}).format(pack.downloads)} downloads` : ""}</span><Button variant="secondary" onClick={() => setProject(pack)} aria-label={`Choose version for ${pack.name}`}>Choose version</Button></footer>
      </article>)}</div>}
      {data.total > data.limit && <nav className="mc-pagination" aria-label="Catalog pages"><Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - (data.limit || 20)))}>Previous</Button><span>{offset + 1}–{Math.min(offset + data.projects.length, data.total)} of {data.total.toLocaleString()}</span><Button variant="secondary" disabled={offset + (data.limit || 20) >= data.total} onClick={() => setOffset(offset + (data.limit || 20))}>Next</Button></nav>}
    </>}
    {project && <PackVersions key={`${provider}:${project.id}`} provider={provider} project={project} filterVersion={version} filterLoader={loader} onClose={() => setProject(null)} onSelect={onSelect}/>}
  </section>;
}

function PackVersions({provider, project, filterVersion, filterLoader, onClose, onSelect}: {provider: PackProvider; project: MinecraftPack; filterVersion: string; filterLoader: string; onClose: () => void; onSelect: (pack: MinecraftPackSelection) => void}) {
  const request = useMinecraftRequest<{versions: MinecraftPackVersion[]}>(`${minecraftAPI}/modpacks/${provider}/${encodeURIComponent(project.id)}/versions`);
  const [selected, setSelected] = useState("");
  const [compatibleOnly, setCompatibleOnly] = useState(true);
  const allVersions = request.data?.versions ?? [];
  const filtered = allVersions.filter(version => !compatibleOnly || (!filterVersion || version.game_versions.includes(filterVersion)) && (!filterLoader || version.loaders.includes(filterLoader)));
  const selectedVersion = filtered.find(version => String(version.id) === selected && version.server_supported === true) ?? filtered.find(version => version.server_supported === true);
  return <MinecraftDialog title={project.name} onClose={onClose}>
    <div className="mc-pack-detail"><MinecraftPackIcon pack={project}/><p className="muted">{project.summary}</p></div>
    <ErrorBox>{request.error}</ErrorBox>
    {request.error && <Button variant="secondary" onClick={request.reload}>Retry versions</Button>}
    {request.loading ? <div className="mc-state" role="status">Loading pack versions...</div> : request.data && <>
      {(filterVersion || filterLoader) && <label className="check mc-pack-filter"><input type="checkbox" checked={compatibleOnly} onChange={e => {setCompatibleOnly(e.target.checked); setSelected("");}}/>Match catalog filters</label>}
      {filtered.length ? <Field label="Pack version"><Select value={selectedVersion ? String(selectedVersion.id) : ""} onChange={e => setSelected(e.target.value)} disabled={!filtered.some(version => version.server_supported === true)}>
        {!selectedVersion && <option value="">No server version available</option>}
        {filtered.map(version => <option key={version.id} value={String(version.id)} disabled={version.server_supported !== true}>{version.name}{version.server_supported !== true ? " · Client only" : ""}</option>)}
      </Select></Field> : <p className="mc-state">{allVersions.length ? "No pack versions match these filters." : "No pack versions are available."}</p>}
      {selectedVersion && <dl className="mc-version-detail"><div><dt>Minecraft</dt><dd>{selectedVersion.game_versions.join(", ") || "Determined by pack"}</dd></div><div><dt>Loader</dt><dd>{selectedVersion.loaders.join(", ") || "Determined by pack"}</dd></div></dl>}
      {!selectedVersion && filtered.length > 0 && <p className="muted">This pack has no supported server download.</p>}
      <div className="mc-dialog-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!selectedVersion} onClick={() => {if (selectedVersion?.server_supported === true) onSelect({provider, project, version: selectedVersion});}}>Continue to setup</Button></div>
    </>}
  </MinecraftDialog>;
}
