import {useRef, useState, type FormEvent} from 'react';
import {Link, useParams} from 'react-router-dom';
import {api, Button, Card, ErrorBox, Field, Input, Select, unwrap} from '../lib';
import {can, json, useServer} from './common';
import {GameHelpLinks} from './SteamGames';
import {quickSettings, safeFolderLink, stoppedServer, type QuickField, type QuickSetup, type QuickValue} from './gameSetupModel';
import {useGameRequest} from './useGameRequest';
import {useServerTelemetry} from './ServerDashboard';
import './steamGames.css';

export default function GameQuickSetup() {
  const {base, permissions, server} = useServer();
  const {id} = useParams();
  const allowed = can(permissions, 'file.read-content');
  const request = useGameRequest<QuickSetup>(base && allowed ? `${base}/quick-setup` : null);
  return <div className="game-quick-page">
    <header className="page-header"><div><h2>Quick setup</h2><p className="muted">Common game settings and folders for {server.name || 'this server'}.</p></div><Button variant="secondary" onClick={request.reload} disabled={!allowed || request.loading}>Refresh settings</Button></header>
    {!base ? <ErrorBox>Select a server to open Quick setup.</ErrorBox> : !allowed ? <p className="muted">You need permission to read file contents to view game settings.</p> : <>
      <ErrorBox>{request.error}</ErrorBox>
      {request.error && <p className="muted">Settings may be unavailable until installation and the first game start finish. Refresh to try again.</p>}
      {request.loading && !request.data && <p role="status">Loading game settings...</p>}
      {request.data && <QuickSetupContent key={`${base}:${request.data.revision}`} data={request.data} serverID={id || server.identifier || server.uuid || ''} onSaved={request.reload}/>}
    </>}
  </div>;
}

function QuickSetupContent({data, serverID, onSaved}: {data: QuickSetup; serverID: string; onSaved: () => void}) {
  const {permissions, base, server} = useServer();
  const telemetry = useServerTelemetry();
  const [draft, setDraft] = useState<Record<string, QuickValue>>(() => Object.fromEntries(data.fields.map(field => [field.key, field.value])));
  const [error, setError] = useState(''), [success, setSuccess] = useState(''), [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(data);
  const submitting = useRef(false);
  const writable = can(permissions, 'file.update');
  const stopped = stoppedServer(telemetry.state, telemetry.updated, telemetry.error, server.status);
  const blocked = !writable || !!server.is_node_under_maintenance || !!server.status || (data.requires_stop && !stopped);
  const dirty = saved.fields.some(field => String(draft[field.key]) !== String(field.value));
  async function save(event: FormEvent) {
    event.preventDefault();
    if (blocked || !dirty || submitting.current) return;
    setError(''); setSuccess('');
    try {
      const settings = quickSettings(saved.fields, draft);
      submitting.current = true; setBusy(true);
      const next = unwrap(await api(`${base}/quick-setup`, json('PUT', {settings, revision: saved.revision}))) as QuickSetup;
      setSaved(next); setDraft(Object.fromEntries(next.fields.map(field => [field.key, field.value])));
      setSuccess('Settings saved. They apply the next time the server starts.');
    } catch (error) {setError(error instanceof Error ? error.message : String(error));}
    finally {submitting.current = false; setBusy(false);}
  }
  const folders = data.folders.map(folder => ({...folder, to: safeFolderLink(serverID, folder.path)})).filter(folder => folder.to);
  return <div className="game-quick-layout">
    <Card className="game-settings-card"><h3>Game settings</h3>
      {data.fields.length ? <form onSubmit={save}>
        {!writable ? <p className="muted">These settings are read-only. File update permission is required to save.</p> : data.requires_stop && !stopped ? <p className="game-stop-note">Stop the server before saving settings. Its stopped state must be confirmed by the node.</p> : <p className="muted">Changes apply on the next start.</p>}
        <fieldset className="steam-fields" disabled={blocked || busy}><div className="steam-form-grid">{saved.fields.map(field => <QuickSetting key={field.key} field={field} value={draft[field.key] ?? field.value} onChange={value => {setDraft(previous => ({...previous, [field.key]: value})); setSuccess('');}}/>)}</div><Button type="submit" disabled={blocked || !dirty || busy} aria-busy={busy}>{busy ? 'Saving...' : 'Save settings'}</Button></fieldset>
        <ErrorBox>{error}</ErrorBox>{error && <Button variant="secondary" onClick={onSaved}>Reload current settings</Button>}{success && <p role="status" className="success">{success}</p>}
      </form> : <p className="muted">{data.game === 'satisfactory' ? 'Claim this server, set passwords and manage sessions in Satisfactory’s built-in Server Manager.' : 'No basic settings are available yet. Start the game once, then refresh this page.'}</p>}
      <GameHelpLinks help={data.help ?? []}/>
    </Card>
    <Card className="game-folders"><h3>Game folders</h3><p className="muted">Open a folder in Files to upload or manage its contents. Stop the server before replacing saves.</p>
      {!can(permissions, 'file.read') ? <p className="muted">File list permission is required to open folders.</p> : <>
        {folders.length ? <ul>{folders.map(folder => <li key={folder.path}><Link to={folder.to!}>{folder.label} <span aria-hidden="true">↗</span></Link><code>{folder.path}</code>{folder.description && <p className="muted">{folder.description}</p>}</li>)}</ul> : <p className="muted">No game folders were found yet. Start the game or create a session, then refresh. Only existing folders appear here.</p>}
        <Link className="game-files-link" to={`/server/${encodeURIComponent(serverID)}/files`}>Open Files</Link>
      </>}
    </Card>
  </div>;
}

function QuickSetting({field, value, onChange}: {field: QuickField; value: QuickValue; onChange: (value: string | boolean) => void}) {
  if (field.type === 'boolean') return <label className="game-boolean"><input type="checkbox" ref={node => {if (node) node.indeterminate = value === null;}} checked={value === true} onChange={event => onChange(event.target.checked)}/><span>{field.label}{value === null && <small className="muted"> · Game default</small>}</span></label>;
  return <Field label={field.label}>{field.type === 'select' ? <Select value={value === null ? '' : String(value)} onChange={event => onChange(event.target.value)}>{value === null && <option value="" disabled>Game default</option>}{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select> : <Input type={field.secret ? 'password' : field.type === 'number' ? 'number' : 'text'} autoComplete={field.secret ? 'new-password' : 'off'} min={field.min} max={field.max} step={field.type === 'number' ? 'any' : undefined} required={field.type === 'number' && value !== null} placeholder={value === null ? 'Game default' : undefined} value={value === null ? '' : String(value)} onChange={event => onChange(event.target.value)}/>}</Field>;
}
