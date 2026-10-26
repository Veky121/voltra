import "./minecraftSetup.css";
import {GameSwitch} from './GameSwitch';
import './games-ui.css';
import {useEffect, useRef, useState} from "react";
import type {FormEvent} from "react";
import {Link, useNavigate, useSearchParams} from "react-router-dom";
import {api, Button, Card, ErrorBox, Field, Input, rows, Select} from "../lib";
import {GameIcon} from "./GameIcon";
import {MinecraftLoaderIcon} from "./MinecraftLoaderIcon";
import {MinecraftCatalog, MinecraftPackIcon} from "./MinecraftCatalog";
import {gibToMiB, minecraftAPI, useMinecraftRequest} from "./MinecraftLibrary";
import type {MinecraftOptions, MinecraftPackSelection, MinecraftRuntime} from "./MinecraftLibrary";
import {MinecraftSegments} from "./MinecraftSegments";
import {GamePorts, useGamePortPlan, rememberInstallationPorts} from "./GamePorts";
import {gameNodeAvailable} from "./gamePortsModel";
import {GameNameField, GameNodeField} from "./GameSetupFields";
import {json, value} from "./common";

type LoaderVersions = {versions: {id: string; stable: boolean}[]; recommended?: string};
type SetupForm = {name: string; version: string; loader: string; loaderChoice: "stable" | "latest" | "other"; loaderVersion: string; runtime: string; memory: string; xms: string; xmx: string; autoHeap: boolean; extraArgs: string; players: string; gameMode: string; difficulty: string; node: string; eula: boolean};

export function MinecraftSetup() {
  const request = useMinecraftRequest<MinecraftOptions>(minecraftAPI);
  const [params, setParams] = useSearchParams();
  const [pack, setPack] = useState<MinecraftPackSelection | null>(null);
  const mode = params.get("setup") === "modpack" ? "modpack" : "custom";
  useEffect(() => {setPack(null);}, [mode]);
  const options = request.data ? {...request.data, loaders: request.data.loaders ?? [{id: "vanilla", name: "Vanilla"}]} : null;
  return <div className="page workspace-page mc-page games-ui">
    <header className="page-header mc-page-header"><div><Link className="mc-back" to="/game-library">← Game Library</Link><h1>{mode === "modpack" && !pack ? "Minecraft modpacks" : "Create a Minecraft server"}</h1></div>
      {!pack && <MinecraftSegments label="Minecraft setup" value={mode} options={[{id: "custom", name: "Custom setup"}, {id: "modpack", name: "Modpacks"}]} onChange={next => {setPack(null); setParams(previous => {previous.set("setup", next); return previous;});}}/>}
      {pack && <Button variant="secondary" onClick={() => setPack(null)}>← Browse modpacks</Button>}
    </header>
    <ErrorBox>{request.error}</ErrorBox>
    {request.error && <Button variant="secondary" onClick={request.reload}>Retry Minecraft options</Button>}
    {request.loading && <div className="mc-state" role="status"><span className="spinner"/>Loading Minecraft options...</div>}
    {options && (mode === "modpack" && !pack ? <MinecraftCatalog options={options} initialQuery={params.get("query") ?? ""} onSelect={selection => {setPack(selection);}}/> : <MinecraftSetupForm key={pack ? `${pack.provider}:${pack.project.id}:${pack.version.id}` : "custom"} options={options} pack={pack} onChangePack={() => setPack(null)}/>)}
  </div>;
}

function MinecraftSetupForm({options, pack, onChangePack}: {options: MinecraftOptions; pack: MinecraftPackSelection | null; onChangePack: () => void}) {
  const navigate = useNavigate();
  const [form, setForm] = useState<SetupForm>(() => ({name: pack?.project.name ?? "Minecraft Survival", version: pack?.version.game_versions[0] ?? options.latest, loader: pack?.version.loaders[0] ?? "vanilla", loaderChoice: "stable", loaderVersion: "", runtime: "auto", memory: pack ? "4" : "2", xms: "0.25", xmx: "1.75", autoHeap: true, extraArgs: "", players: "20", gameMode: "survival", difficulty: "normal", node: "", eula: false}));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const submitting = useRef(false);
  const active = useRef(true);
  const submission = useRef<{payload: string; id: string} | null>(null);
  useEffect(() => {active.current = true; return () => {active.current = false;};}, []);
  const set = <K extends keyof SetupForm>(key: K, val: SetupForm[K]) => {setForm(previous => ({...previous, [key]: val})); setError("");};
  const loaderRequest = useMinecraftRequest<LoaderVersions>(!pack && form.loader !== "vanilla" ? `${minecraftAPI}/loaders?${new URLSearchParams({loader: form.loader, version: form.version})}` : null);
  const runtimeRequest = useMinecraftRequest<any>(options.runtimes === undefined ? "/api/client/java/runtimes" : null);
  const runtimes: MinecraftRuntime[] = options.runtimes ?? (Array.isArray(runtimeRequest.data) ? runtimeRequest.data : runtimeRequest.data?.runtimes ?? rows(runtimeRequest.data));
  const enabledRuntimes = runtimes.filter(runtime => runtime.enabled !== false);
  const loaderVersions = loaderRequest.data?.versions ?? [];
  const recommended = loaderVersions.find(version => version.id === loaderRequest.data?.recommended && version.stable) ?? loaderVersions.find(version => version.stable);
  const selectedLoaderVersion = form.loaderChoice === "stable" ? recommended?.id ?? "" : form.loaderChoice === "latest" ? loaderVersions[0]?.id ?? "" : form.loaderVersion;
  const validLoaderVersion = !pack && form.loader !== "vanilla" ? loaderVersions.some(version => version.id === selectedLoaderVersion) : true;
  const memoryMiB = gibToMiB(form.memory), xmsMiB = gibToMiB(form.xms), xmxMiB = form.autoHeap ? 0 : gibToMiB(form.xmx);
  const heapBudget = memoryMiB === null ? 0 : memoryMiB - Math.max(128, Math.ceil(memoryMiB * 0.1));
  const effectiveHeap = form.autoHeap ? heapBudget : xmxMiB ?? 0;
  const validMemory = memoryMiB !== null && memoryMiB >= 512 && memoryMiB <= 1048576;
  const validHeap = xmsMiB !== null && xmsMiB > 0 && xmxMiB !== null && effectiveHeap > 0 && effectiveHeap <= heapBudget && xmsMiB <= effectiveHeap;
  const availableNodes = options.nodes.filter(gameNodeAvailable);
  const ports = useGamePortPlan(`${minecraftAPI}/ports`, form.node || String(availableNodes[0]?.id ?? ""));
  const validNode = form.node === "" ? availableNodes.length > 0 : availableNodes.some(node => String(node.id) === form.node);
  const validRuntime = form.runtime === "auto" || enabledRuntimes.some(runtime => String(runtime.id) === form.runtime);
  const loaders = options.loaders;
  const loaderName = loaders.find(loader => loader.id === form.loader)?.name ?? form.loader;
  const validation = !validMemory ? "Enter 0.5 to 1024 GiB of memory in whole MiB increments." : !validHeap ? "Java heap must use whole MiB, fit within the server memory reserve, and have an initial size no greater than its maximum." : !validRuntime ? "Choose an enabled Java runtime." : !validLoaderVersion ? "Choose an available loader version." : !validNode ? "Choose an available node." : "";
  const canSubmit = options.can_install && !!ports.data && !ports.loading && !ports.error && !validation && !loaderRequest.loading && !loaderRequest.error && (!pack || pack.version.server_supported === true);
  const versions = [...new Set([form.version, ...options.versions])].filter(Boolean);

  async function install(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (submitting.current || !canSubmit || !form.eula || !form.name.trim()) return;
    const body = {name: form.name.trim(), version: form.version, memory: memoryMiB, max_players: Number(form.players), game_mode: form.gameMode, difficulty: form.difficulty, node_id: form.node ? Number(form.node) : null, accept_eula: form.eula, loader: form.loader, loader_version: pack || form.loader === "vanilla" ? "" : selectedLoaderVersion, runtime_id: form.runtime, java_config: {enabled: true, runtime_id: form.runtime, xms_mib: xmsMiB, xmx_mib: xmxMiB, extra_args: form.extraArgs.trim()}, ...(pack ? {modpack: {provider: pack.provider, project_id: String(pack.project.id), version_id: String(pack.version.id)}} : {})};
    const payload = JSON.stringify(body);
    // Retry an unchanged request with the same key; changed settings get a new key.
    if (submission.current?.payload !== payload) submission.current = {payload, id: crypto.randomUUID()};
    submitting.current = true;
    setError(""); setBusy(true);
    try {
      const result = value(await api(`${minecraftAPI}/install`, json("POST", {...body, request_id: submission.current.id})));
      if (!result?.identifier) throw new Error("The install response did not include a server. Check Overview before retrying.");
      rememberInstallationPorts(result.identifier, result.ports);
      if (active.current) navigate(`/server/${encodeURIComponent(result.identifier)}/console`);
    } catch (error) {
      if (active.current) setError(error instanceof Error ? error.message : String(error));
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  }

  return <form className="mc-setup-layout" onSubmit={install}>
    <fieldset className="mc-form-fields" disabled={busy}>
      <Card className={`mc-setup-identity${pack ? ' is-modpack' : ''}`}>
        {pack && <div className="mc-selected-pack"><MinecraftPackIcon pack={pack.project}/><div><h2>{pack.project.name}</h2><p>{pack.version.name} · {pack.provider === "curseforge" ? "CurseForge" : "Modrinth"}</p></div><Button variant="secondary" onClick={onChangePack}>Change</Button></div>}
        <div className="mc-identity">{!pack && <GameIcon minecraft/>}<div><GameNameField value={form.name} onChange={name => set("name", name)}/></div></div>
      </Card>
      <Card className="mc-config-card"><div className="mc-section-heading"><span className="mc-section-number">1</span><h2>Game and loader</h2></div>
        {pack ? <><dl className="mc-version-detail"><div><dt>Minecraft</dt><dd>{pack.version.game_versions.join(", ") || "Determined by pack"}</dd></div><div><dt>Loader</dt><dd>{pack.version.loaders.map(loader => loaders.find(option => option.id === loader)?.name ?? loader).join(", ") || "Determined by pack"}</dd></div></dl><p className="muted mc-full">The pack supplies its game and loader versions.</p></> : <>
          <fieldset className="mc-loader-fieldset"><legend>Loader</legend><div className="mc-loaders">{loaders.map(loader => <label key={loader.id} className={`mc-loader ${form.loader === loader.id ? "is-selected" : ""}`}><input type="radio" name="minecraft-loader" value={loader.id} checked={form.loader === loader.id} onChange={() => setForm(previous => ({...previous, loader: loader.id, loaderChoice: "stable", loaderVersion: ""}))}/><MinecraftLoaderIcon id={loader.id} name={loader.name}/><span>{loader.name}</span></label>)}</div></fieldset>
          <Field label="Minecraft version"><Select value={form.version} onChange={e => setForm(previous => ({...previous, version: e.target.value, loaderChoice: "stable", loaderVersion: ""}))}>{versions.map(version => <option key={version} value={version}>{version}{version === options.latest ? " · Latest release" : ""}</option>)}</Select></Field>
          {form.loader !== "vanilla" && <div className="mc-loader-versions">
            <div className="mc-field-heading"><span>{loaderName} version</span><MinecraftSegments label="Loader version selection" value={form.loaderChoice} options={[{id: "stable", name: "Stable"}, {id: "latest", name: "Latest"}, {id: "other", name: "Other"}]} onChange={choice => setForm(previous => ({...previous, loaderChoice: choice, loaderVersion: choice === "other" ? selectedLoaderVersion || loaderVersions[0]?.id || "" : previous.loaderVersion}))}/></div>
            <ErrorBox>{loaderRequest.error}</ErrorBox>{loaderRequest.error && <Button variant="secondary" onClick={loaderRequest.reload}>Retry loader versions</Button>}
            {loaderRequest.loading ? <p className="muted" role="status">Loading {loaderName} versions...</p> : loaderRequest.data && (loaderVersions.length ? <Field label="Loader version"><Select value={selectedLoaderVersion} onChange={e => setForm(previous => ({...previous, loaderChoice: "other", loaderVersion: e.target.value}))}>
              {!selectedLoaderVersion && <option value="">No stable release. Choose Latest or Other.</option>}{loaderVersions.map(version => <option key={version.id} value={version.id}>{version.id}{version.stable ? " · Stable" : ""}{version.id === loaderRequest.data?.recommended ? " · Recommended" : ""}</option>)}
            </Select></Field> : <p className="mc-inline-empty">{loaderName} has no versions for Minecraft {form.version}. Choose another game version or loader.</p>)}
          </div>}
        </>}
      </Card>
      <Card className="mc-config-card"><div className="mc-section-heading"><span className="mc-section-number">2</span><h2>Java and memory</h2></div>
        <div className="form-grid"><Field label="Java runtime"><Select value={form.runtime} onChange={e => set("runtime", e.target.value)}><option value="auto">Automatic</option>{enabledRuntimes.map(runtime => <option key={runtime.id} value={String(runtime.id)}>{runtime.name} · Java {runtime.major}{runtime.distribution ? ` · ${runtime.distribution}` : ""}</option>)}</Select></Field>
          <Field label="Server memory" hint={memoryMiB !== null ? `${memoryMiB.toLocaleString()} MiB` : "Use whole MiB increments."}><div className="mc-unit-input"><Input type="number" required min="0.5" max="1024" step="any" inputMode="decimal" value={form.memory} onChange={e => set("memory", e.target.value)}/><span>GiB</span></div></Field></div>
        <p className="muted mc-help">Automatic selects the Java version required by the game and loader.</p>
        {runtimeRequest.loading && <p className="muted" role="status">Loading registered Java runtimes...</p>}
        <ErrorBox>{runtimeRequest.error}</ErrorBox>{runtimeRequest.error && <Button variant="secondary" onClick={runtimeRequest.reload}>Retry Java runtimes</Button>}
        {!runtimeRequest.loading && !runtimeRequest.error && enabledRuntimes.length === 0 && <p className="muted">No enabled Java runtimes. Ask an administrator to register one.</p>}
        <details className="mc-advanced"><summary>Advanced memory and Java arguments</summary>
          <div className="form-grid"><Field label="Initial Java heap" hint={xmsMiB !== null ? `${xmsMiB.toLocaleString()} MiB` : "Use whole MiB increments."}><div className="mc-unit-input"><Input type="number" required min="0.0009765625" step="any" value={form.xms} onChange={e => set("xms", e.target.value)}/><span>GiB</span></div></Field>
            <Field label="Maximum Java heap" hint={form.autoHeap ? `${Math.max(0, heapBudget).toLocaleString()} MiB after memory reserve` : xmxMiB !== null ? `${xmxMiB.toLocaleString()} MiB` : "Use whole MiB increments."}><div className="mc-unit-input"><Input type="number" required={!form.autoHeap} disabled={form.autoHeap} min="0.0009765625" step="any" value={form.autoHeap ? String(Math.max(0, heapBudget) / 1024) : form.xmx} onChange={e => set("xmx", e.target.value)}/><span>GiB</span></div></Field></div>
          <label className="check"><GameSwitch checked={form.autoHeap} onCheckedChange={checked => setForm(previous => ({...previous, autoHeap: checked, xmx: !checked ? String(Math.max(0, heapBudget) / 1024) : previous.xmx}))}/>Set maximum heap automatically</label>
          <Field label="Extra Java arguments" hint="Memory flags are managed by the heap controls."><Input placeholder="-XX:+UseG1GC" value={form.extraArgs} onChange={e => set("extraArgs", e.target.value)}/></Field>
        </details>
        {(!validMemory || !validHeap) && <ErrorBox>{validation}</ErrorBox>}
      </Card>
      <Card className="mc-config-card"><div className="mc-section-heading"><span className="mc-section-number">3</span><h2>Server settings</h2></div>
        <div className="form-grid"><GameNodeField value={form.node} onChange={node => set("node", node)} nodes={options.nodes} automatic/>
          <Field label="Maximum players"><Input type="number" required min="1" max="200" step="1" value={form.players} onChange={e => set("players", e.target.value)}/></Field>
          <Field label="Game mode"><Select value={form.gameMode} onChange={e => set("gameMode", e.target.value)}>{["survival", "creative", "adventure", "spectator"].map(mode => <option key={mode} value={mode}>{mode[0].toUpperCase() + mode.slice(1)}</option>)}</Select></Field>
          <Field label="Difficulty"><Select value={form.difficulty} onChange={e => set("difficulty", e.target.value)}>{["peaceful", "easy", "normal", "hard"].map(difficulty => <option key={difficulty} value={difficulty}>{difficulty[0].toUpperCase() + difficulty.slice(1)}</option>)}</Select></Field></div>
        <GamePorts plan={ports.data} loading={ports.loading} error={ports.error} retry={ports.reload}/>
      </Card>
    </fieldset>
    <aside className="mc-install-summary"><Card>
      <div className="mc-summary-heading">{pack ? <MinecraftPackIcon pack={pack.project}/> : <GameIcon minecraft/>}<div><h2>{pack?.project.name ?? "Minecraft"}</h2><p>{pack ? pack.version.name : "Java Edition"}</p></div></div>
      <dl><div><dt>Version</dt><dd>{form.version}</dd></div><div><dt>Loader</dt><dd>{loaderName}{!pack && selectedLoaderVersion ? ` ${selectedLoaderVersion}` : ""}</dd></div><div><dt>Java</dt><dd>{form.runtime === "auto" ? "Automatic" : enabledRuntimes.find(runtime => String(runtime.id) === form.runtime)?.name ?? "Unavailable"}</dd></div><div><dt>Memory</dt><dd>{form.memory || "0"} GiB</dd></div><div><dt>Storage</dt><dd>10 GiB</dd></div></dl>
      <label className="check mc-eula"><GameSwitch checked={form.eula} disabled={busy} required onCheckedChange={checked => set("eula", checked)}/><span>I agree to the <a href="https://www.minecraft.net/en-us/eula" target="_blank" rel="noreferrer">Minecraft EULA</a>.</span></label>
      <ErrorBox>{error || (submitted ? validation : "")}</ErrorBox>
      {!options.can_install && <p className="mc-inline-empty">An administrator must install new servers.</p>}
      {!validNode && <p className="mc-inline-empty">No available node. Connect a compatible node, then reload setup.</p>}
      <Button type="submit" disabled={busy || !canSubmit || !form.eula}>{busy ? "Creating server..." : pack ? "Install modpack" : "Install Minecraft"}</Button>
      <p className="muted mc-install-note">Follow installation progress in the console.</p>
    </Card></aside>
  </form>;
}

