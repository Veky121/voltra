import './games-ui.css';
import {useEffect, useRef, useState, type FormEvent} from 'react';
import {Link, useParams} from 'react-router-dom';
import {api, Button, Card, ErrorBox, Input, Select, unwrap} from '../lib';
import {can, json, useServer} from './common';
import {safeFolderLink, stoppedServer, type QuickSetup, type QuickValue} from './gameSetupModel';
import {useGameRequest} from './useGameRequest';
import {useServerTelemetry} from './ServerDashboard';
import {GameSettingsFields} from './GameSettingsFields';
import ServerStartup from './ServerStartup';
import './steamGames.css';

type Settings = QuickSetup & {file: string; documents: {path: string; label: string}[]};
export default function GameQuickSetup() {
  const {base, permissions, server} = useServer();
  const {id} = useParams();
  const [file, setFile] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState('');
  const dirty = useRef(false);
  const allowed = can(permissions, 'file.read-content');
  const request = useGameRequest<Settings>(base && allowed ? `${base}/game-settings${file ? `?file=${encodeURIComponent(file)}` : ''}` : null);
  const inventory = useGameRequest<Settings>(base && allowed && (server.game === 'minecraft' || request.data?.game === 'minecraft') ? `${base}/game-settings?inventory=all` : null);
  const folderRequest = useGameRequest<{folders: Settings['folders']}>(base && allowed && can(permissions, 'file.read') ? `${base}/game-settings/folders` : null);
  const documents = [...new Map([...(request.data?.documents || []), ...(inventory.data?.documents || [])].map(doc => [doc.path, doc])).values()];
  function discard() {return !dirty.current || window.confirm('Discard your unsaved settings?');}
  return <div className="game-quick-page games-ui">
    <header className="page-header game-settings-page-header"><h2>Game settings</h2>
      {!!documents.length && <Select className="game-settings-document" aria-label="Configuration" value={file || request.data?.file || ''} disabled={request.loading} onChange={event => {if (discard()) {dirty.current = false; setSearch(''); setFile(event.target.value);}}}>{documents.map(doc => <option key={doc.path} value={doc.path}>{doc.label}</option>)}</Select>}
      {request.data && request.data.fields.length > 12 && <Input className="game-settings-search" type="search" aria-label="Find a setting" placeholder="Find a setting..." value={search} onChange={event => setSearch(event.target.value)}/>}
      <Button className="game-settings-refresh" variant="secondary" onClick={() => {if (discard()) {dirty.current = false; setRefresh(value => value + 1); request.reload(); inventory.reload(); folderRequest.reload();}}} disabled={!allowed || request.loading}>Refresh</Button></header>
    <ErrorBox>{request.error}</ErrorBox>
    {inventory.error && <p className="muted">World settings lookup failed. <button type="button" className="text-button" onClick={inventory.reload}>Retry</button></p>}
    {request.loading && !request.data && <p role="status">Loading game settings...</p>}
    {!allowed ? <p className="muted">File content permission is required.</p> : request.data && <>
      <QuickSetupContent key={`${base}:${request.data.file}:${request.data.revision}:${refresh}`} data={request.data} search={search} onSaved={() => {setRefresh(value => value + 1); request.reload();}} onDirty={value => {dirty.current = value;}}/>
    </>}
    <ServerStartup section="game"/>
    {request.data && <GameFolders folders={request.data.folders} folderRequest={folderRequest} serverID={id || server.identifier || server.uuid || ''}/>}

  </div>;
}

function QuickSetupContent({data, search, onSaved, onDirty}: {data: Settings; search: string; onSaved: () => void; onDirty: (dirty: boolean) => void}) {
  const {permissions, base, server} = useServer();
  const telemetry = useServerTelemetry();
  const [draft, setDraft] = useState<Record<string, QuickValue>>({});
  const [error, setError] = useState(''), [success, setSuccess] = useState(''), [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(data);
  const submitting = useRef(false);
  const writable = can(permissions, 'file.update');
  const stopped = stoppedServer(telemetry.state, telemetry.updated, telemetry.error, server.status);
  const blocked = !writable || !!server.is_node_under_maintenance || !!server.status || (data.requires_stop && !stopped);
  const changes = Object.fromEntries(Object.entries(draft).filter(([key, value]) => String(value) !== String(saved.fields.find(field => field.key === key)?.value)));
  const dirty = Object.keys(changes).length > 0;
  useEffect(() => {onDirty(dirty);}, [dirty, onDirty]);
  useEffect(() => {if (!dirty) return; const warn = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';}; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);}, [dirty]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (blocked || !dirty || submitting.current) return;
    setError(''); setSuccess(''); submitting.current = true; setBusy(true);
    try {
      const settings = Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, typeof value === 'boolean' ? value : String(value ?? '')]));
      const next = unwrap(await api(`${base}/game-settings?file=${encodeURIComponent(saved.file)}`, json('PUT', {settings, revision: saved.revision}))) as Settings;
      setSaved(next); setDraft({}); onDirty(false);
      setSuccess('Saved. Applies on the next start.');
    } catch (error) {setError(error instanceof Error ? error.message : String(error));}
    finally {submitting.current = false; setBusy(false);}
  }
  function change(key: string, value: QuickValue) {setDraft(previous => ({...previous, [key]: value})); setSuccess('');}

  return <div className="game-quick-layout">
    <Card className="game-settings-card">
      {saved.fields.length ? <form onSubmit={save}>
        <fieldset className="steam-fields" disabled={blocked || busy}><GameSettingsFields fields={saved.fields} game={data.game} file={saved.file} search={search} draft={draft} onChange={change}/><div className="game-settings-save"><Button type="submit" disabled={blocked || !dirty || busy} aria-busy={busy}>{busy ? 'Saving...' : 'Save settings'}</Button>{dirty && <span className="muted">{Object.keys(changes).length} unsaved</span>}</div></fieldset>
        <ErrorBox>{error}</ErrorBox>{error && <Button variant="secondary" onClick={() => {if (!dirty || window.confirm('Discard your unsaved settings and reload?')) {onDirty(false); onSaved();}}}>Reload current settings</Button>}{success && <p role="status" className="success">{success}</p>}
      </form> : <p className="muted">No generated server configuration was found. Start the game once to create its settings.</p>}
    </Card>

  </div>;
}

function GameFolders({folders: nativeFolders, folderRequest, serverID}: {folders: Settings['folders']; folderRequest: {data: {folders: Settings['folders']} | null; loading: boolean; error: string; reload: () => void}; serverID: string}) {
  const {permissions} = useServer();
  const folders = [...new Map([...nativeFolders, ...(folderRequest.data?.folders || [])].map(folder => [folder.path, folder])).values()].map(folder => ({...folder, to: safeFolderLink(serverID, folder.path)})).filter(folder => folder.to);
  return <>
    {can(permissions, 'file.read') && <Card className="game-folders"><div className="game-settings-heading"><h3>Game folders</h3><Link className="game-files-link" to={`/server/${encodeURIComponent(serverID)}/files`}>All files</Link></div>
      {folders.length ? <ul>{folders.map(folder => <li key={folder.path}><Link to={folder.to!}><span className="game-folder-identity"><span>{folder.label}</span><code>{folder.path}</code></span></Link></li>)}</ul> : <p className="muted">Folders appear after the game creates them.</p>}
      {folderRequest.loading && <p className="muted" role="status">Finding game folders...</p>}
      {folderRequest.error && <p className="muted">Folder lookup failed. <button type="button" className="text-button" onClick={folderRequest.reload}>Retry</button></p>}
    </Card>}
  </>;
}
