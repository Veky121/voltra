import './games-ui.css';
import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {Link, useParams} from 'react-router-dom';
import {api, Button, Card, ErrorBox, Input, Select, Textarea, unwrap, useAPI} from '../lib';
import {can, items, json, useServer} from './common';
import {safeFolderLink, stoppedServer, type QuickField, type QuickSetup, type QuickValue} from './gameSetupModel';
import {useGameRequest} from './useGameRequest';
import {useServerTelemetry} from './ServerDashboard';
import {GameSwitch} from './GameSwitch';
import {readableSettingName, settingsGroups} from './gameSettingsLayout';
import {StartupVariableField} from './ServerStartup';
import type {StartupVariable, VariableWrite} from './startupSettingsModel';
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
      <QuickSetupContent key={`${base}:${request.data.file}:${request.data.revision}:${refresh}`} data={request.data} search={search} folderRequest={folderRequest} serverID={id || server.identifier || server.uuid || ''} onSaved={() => {setRefresh(value => value + 1); request.reload();}} onDirty={value => {dirty.current = value;}}/>
    </>}
  </div>;
}

function QuickSetupContent({data, search, folderRequest, serverID, onSaved, onDirty}: {data: Settings; search: string; folderRequest: {data: {folders: Settings['folders']} | null; loading: boolean; error: string; reload: () => void}; serverID: string; onSaved: () => void; onDirty: (dirty: boolean) => void}) {
  const {permissions, base, server} = useServer();
  const telemetry = useServerTelemetry();
  const [draft, setDraft] = useState<Record<string, QuickValue>>({});
  const [error, setError] = useState(''), [success, setSuccess] = useState(''), [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(data);
  const [startupDirty, setStartupDirty] = useState(false);
  const submitting = useRef(false);
  const writable = can(permissions, 'file.update');
  const stopped = stoppedServer(telemetry.state, telemetry.updated, telemetry.error, server.status);
  const blocked = !writable || !!server.is_node_under_maintenance || !!server.status || (data.requires_stop && !stopped);
  const changes = Object.fromEntries(Object.entries(draft).filter(([key, value]) => String(value) !== String(saved.fields.find(field => field.key === key)?.value)));
  const dirty = Object.keys(changes).length > 0;
  useEffect(() => {onDirty(dirty || startupDirty);}, [dirty, startupDirty, onDirty]);
  useEffect(() => {if (!dirty && !startupDirty) return; const warn = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';}; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);}, [dirty, startupDirty]);
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
  const folders = [...new Map([...data.folders, ...(folderRequest.data?.folders || [])].map(folder => [folder.path, folder])).values()].map(folder => ({...folder, to: safeFolderLink(serverID, folder.path)})).filter(folder => folder.to);
  const groups = settingsGroups(saved.fields, data.game, saved.file);
  const visibleGroups = groups.map(group => ({...group, fields: group.fields.filter(field => `${field.key} ${readableSettingName(field)}`.toLowerCase().includes(search.trim().toLowerCase()))})).filter(group => group.fields.length);
  return <div className="game-quick-layout">
    <Card className="game-settings-card">
      {saved.fields.length ? <form onSubmit={save}>
        <fieldset className="steam-fields" disabled={blocked || busy}>{visibleGroups.map(group => <section key={group.id} className="game-settings-section" aria-label={group.label}><h4>{group.label}</h4><div className="game-properties-grid">{group.fields.map(field => <QuickSetting key={field.key} field={field} value={Object.hasOwn(draft, field.key) ? draft[field.key] : field.value} onChange={value => change(field.key, value)}/>)}</div></section>)}{!visibleGroups.length && <p className="muted">No matching settings.</p>}<div className="game-settings-save"><Button type="submit" disabled={blocked || !dirty || busy} aria-busy={busy}>{busy ? 'Saving...' : 'Save settings'}</Button>{dirty && <span className="muted">{Object.keys(changes).length} unsaved</span>}</div></fieldset>
        <ErrorBox>{error}</ErrorBox>{error && <Button variant="secondary" onClick={() => {if (!dirty || window.confirm('Discard your unsaved settings and reload?')) {onDirty(false); onSaved();}}}>Reload current settings</Button>}{success && <p role="status" className="success">{success}</p>}
      </form> : <p className="muted">No generated server configuration was found. Start the game once to create its settings.</p>}
      <GameStartupSettings onDirty={setStartupDirty}/>
    </Card>
    {can(permissions, 'file.read') && <Card className="game-folders"><div className="game-settings-heading"><h3>Game folders</h3><Link className="game-files-link" to={`/server/${encodeURIComponent(serverID)}/files`}>All files</Link></div>
      {folders.length ? <ul>{folders.map(folder => <li key={folder.path}><Link to={folder.to!}><span className="game-folder-identity"><span>{folder.label}</span><code>{folder.path}</code></span></Link></li>)}</ul> : <p className="muted">Folders appear after the game creates them.</p>}
      {folderRequest.loading && <p className="muted" role="status">Finding game folders...</p>}
      {folderRequest.error && <p className="muted">Folder lookup failed. <button type="button" className="text-button" onClick={folderRequest.reload}>Retry</button></p>}
    </Card>}
  </div>;
}

function QuickSetting({field, value, onChange}: {field: QuickField; value: QuickValue; onChange: (value: string | boolean) => void}) {
  const disabled = field.readonly || field.type === 'readonly';
  const label = readableSettingName(field);
  const id = `game-property-${encodeURIComponent(field.key)}`;
  return <div className={`game-setting-row${field.type === 'boolean' ? ' is-boolean' : ''}`}><div className="game-setting-identity"><label htmlFor={id} title={field.key}>{label}</label>{disabled && <span className="game-setting-managed" title={field.type === 'readonly' ? 'This structured value needs the file editor.' : 'Managed by the server or template.'}>{field.type === 'readonly' ? 'File editor' : 'Managed'}</span>}</div><div className="game-setting-control">
    {field.type === 'boolean' ? <GameSwitch id={id} aria-label={label} checked={value === true} disabled={disabled} onCheckedChange={checked => onChange(checked)}/>
      : field.type === 'list' ? <Textarea id={id} aria-label={label} title="JSON list" rows={2} value={String(value ?? '[]')} onChange={event => onChange(event.target.value)}/>
      : field.type === 'select' ? <Select id={id} aria-label={label} value={String(value ?? '')} disabled={disabled} onChange={event => onChange(event.target.value)}>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>
      : <Input id={id} aria-label={label} disabled={disabled} type={field.secret ? 'password' : field.type === 'number' ? 'number' : 'text'} autoComplete={field.secret ? 'new-password' : 'off'} step="any" placeholder={field.secret ? field.configured ? 'Configured' : 'Not configured' : undefined} value={value === null ? '' : String(value)} onChange={event => onChange(event.target.value)}/>}
    {field.secret && field.configured && <button type="button" className="game-setting-clear" disabled={disabled} onClick={() => onChange('')}>Clear</button>}
  </div></div>;
}

function GameStartupSettings({onDirty}: {onDirty: (dirty: boolean) => void}) {
  const {base, permissions} = useServer();
  const allowed = can(permissions, 'startup.read');
  const [opened, setOpened] = useState(false);
  const query = useAPI(allowed && opened ? `${base}/startup` : null);
  const [saved, setSaved] = useState<Record<string, StartupVariable>>({});
  const pending = useRef<Record<string, boolean>>({});
  const changed = useCallback((key: string, dirty: boolean) => {pending.current[key] = dirty; onDirty(Object.values(pending.current).some(Boolean));}, [onDirty]);
  const variables = query.data ? items(query.data) as StartupVariable[] : [];
  async function save(payload: VariableWrite) {const response = await api(`${base}/startup/variable`, json('PUT', payload)); const variable = unwrap(response) as StartupVariable; if (!variable || variable.env_variable !== payload.key) throw new Error('The server did not confirm this setting.'); setSaved(previous => ({...previous, [variable.env_variable]: variable})); return variable;}
  if (!allowed) return null;
  return <details className="game-startup-settings" onToggle={event => setOpened(event.currentTarget.open)}><summary>Startup options</summary><ErrorBox>{query.error}</ErrorBox>{query.loading && <p role="status">Loading startup options...</p>}{variables.map(variable => <StartupVariableField key={variable.env_variable} variable={saved[variable.env_variable] || variable} permitted={can(permissions, 'startup.update')} onSave={save} onDirty={changed}/>)}</details>;
}
