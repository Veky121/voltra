import {confirmAction} from '../ui/ConfirmAction';
import {useErrorState} from '../notifications/useErrorState';
import {ActionButton as MiraAction} from '../ui/ActionButton';
import {PendingSettings, usePendingSetting} from './PendingSettings';
import './games-ui.css';
import {useEffect, useRef, useState} from 'react';
import {Link, useParams, useSearchParams} from 'react-router-dom';
import {SettingsSkeleton} from '../ui/SettingsSkeleton';
import {api, Button, Card, ErrorBox, Input, Select, unwrap} from '../lib';
import {can, json, useServer} from './common';
import {safeFolderLink, stoppedServer, type QuickSetup, type QuickValue} from './gameSetupModel';
import {useGameRequest} from './useGameRequest';
import {useServerTelemetry} from './ServerDashboard';
import {GameSettingsFields} from './GameSettingsFields';
import ServerStartup from './ServerStartup';
import {SettingsSection} from '../ui/Settings';
import './steamGames.css';

type Settings = QuickSetup & {file: string; documents: {path: string; label: string}[]};
export default function GameQuickSetup() {return <PendingSettings><GameQuickSetupContent/></PendingSettings>;}
function GameQuickSetupContent() {
  const {base, permissions, server} = useServer();
  const {id} = useParams();
  const [params,setParams]=useSearchParams();
  const file=params.get('file')||'';
  const [search, setSearch] = useState('');
  const dirty = useRef(false);
  const allowed = can(permissions, 'file.read-content');
  const request = useGameRequest<Settings>(base && allowed ? `${base}/game-settings${file ? `?file=${encodeURIComponent(file)}` : ''}` : null);
  const inventory = useGameRequest<Settings>(base && allowed && (server.game === 'minecraft' || request.data?.game === 'minecraft') ? `${base}/game-settings?inventory=all` : null);
  const folderRequest = useGameRequest<{folders: Settings['folders']}>(base && can(permissions, 'file.read') ? `${base}/game-settings/folders` : null);
  const documents = [...new Map([...(request.data?.documents || []), ...(inventory.data?.documents || [])].map(doc => [doc.path, doc])).values()];
  // Revalidate on return without polling or replacing an in-progress draft.
  useEffect(()=>{
    let checkedAt=Date.now();
    const refreshClean=()=>{if(document.hidden||dirty.current||Date.now()-checkedAt<30000)return;checkedAt=Date.now();request.reload();};
    window.addEventListener('focus',refreshClean);document.addEventListener('visibilitychange',refreshClean);
    return()=>{window.removeEventListener('focus',refreshClean);document.removeEventListener('visibilitychange',refreshClean)};
  },[base,file,request.reload]);
  return <div className="game-quick-page games-ui settings-responsive">
    <header className="page-header game-settings-page-header" aria-label="Game Config controls">
      {!!documents.length && <Select className="game-settings-document" aria-label="Configuration" value={file || request.data?.file || ''} disabled={request.loading} onChange={event => {const next=new URLSearchParams(params);next.set('file',event.target.value);setParams(next,{preventScrollReset:true});}}>{documents.map(doc => <option key={doc.path} value={doc.path}>{doc.label}</option>)}</Select>}
      {request.data && request.data.fields.length > 12 && <Input className="game-settings-search" type="search" aria-label="Find a setting" placeholder="Find a setting..." value={search} onChange={event => setSearch(event.target.value)}/>}
      </header>
    <ErrorBox>{request.error}</ErrorBox>
    {request.error&&<MiraAction type="button" onClick={request.reload}>Retry</MiraAction>}
    {inventory.error && <p className="muted">World settings lookup failed. <MiraAction type="button" className="text-button" onClick={inventory.reload}>Retry</MiraAction></p>}
    {request.loading && !request.data && <SettingsSkeleton/>}
    {!allowed ? <p className="muted">File content permission is required.</p> : request.data && <>
      <QuickSetupContent key={`${base}:${request.data.file}`} data={request.data} search={search} onSaved={request.reload} onDirty={value => {dirty.current = value;}}/>
    </>}
    <ServerStartup section="game"/>
    <GameFolders folders={request.data?.folders || []} folderRequest={folderRequest} serverID={id || server.identifier || server.uuid || ''}/>

  </div>;
}

function QuickSetupContent({data, search, onSaved, onDirty}: {data: Settings; search: string; onSaved: () => void; onDirty: (dirty: boolean) => void}) {
  const {permissions, base, server} = useServer();
  const telemetry = useServerTelemetry();
  const [draft, setDraft] = useState<Record<string, QuickValue>>({});
  const [error, setError] = useErrorState('client/GameQuickSetup.tsx'), [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(data);
  const submitting = useRef(false);
  const writable = can(permissions, 'file.update');
  const stopped = stoppedServer(telemetry.state, telemetry.updated, telemetry.error, server.status);
  const blocked = !writable || !!server.is_node_under_maintenance || !!server.status || (data.requires_stop && !stopped);
  const changes = Object.fromEntries(Object.entries(draft).filter(([key, value]) => String(value) !== String(saved.fields.find(field => field.key === key)?.value)));
  const dirty = Object.keys(changes).length > 0;
  useEffect(()=>{if(!dirty)setSaved(data)},[data]);
  useEffect(() => {onDirty(dirty);}, [dirty, onDirty]);
  useEffect(() => {if (!dirty) return; const warn = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';}; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);}, [dirty]);
  async function save() {
    if (blocked || !dirty || submitting.current) return;
    setError(''); submitting.current = true; setBusy(true);
    try {
      const settings = Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, typeof value === 'boolean' ? value : String(value ?? '')]));
      const next = unwrap(await api(`${base}/game-settings?file=${encodeURIComponent(saved.file)}`, json('PUT', {settings, revision: saved.revision}))) as Settings;
      setSaved(next); setDraft({}); onDirty(false);
    } catch (error) {setError(error instanceof Error ? error.message : String(error)); throw error;}
    finally {submitting.current = false; setBusy(false);}
  }
  function change(key: string, value: QuickValue) {setDraft(previous => ({...previous, [key]: value}));}

  usePendingSetting(`native:${base}:${saved.file}`, dirty, {summary:Object.keys(changes).map(key=>saved.fields.find(field=>field.key===key)?.label||key).join(', '),applies:'Next start',blocked: !!blocked || busy, save, afterSave:onSaved, discard: () => {setDraft({}); setError('');}});
  if (!saved.fields.length) return null;
  return <div className="game-quick-layout">
    <Card className="game-settings-card">
      <div>
        <fieldset className="steam-fields" disabled={blocked || busy}><GameSettingsFields fields={saved.fields} game={data.game} file={saved.file} search={search} draft={draft} onChange={change}/></fieldset>
        <ErrorBox>{error}</ErrorBox>{error && <Button variant="secondary" onClick={async () => {if (!dirty || await confirmAction({title:"Discard changes?",description:'Discard your unsaved settings and reload?',confirmLabel:"Discard changes",danger:false})) {setDraft({});setError('');onDirty(false); onSaved();}}}>Reload current settings</Button>}
      </div>
    </Card>

  </div>;
}

function GameFolders({folders: nativeFolders, folderRequest, serverID}: {folders: Settings['folders']; folderRequest: {data: {folders: Settings['folders']} | null; loading: boolean; error: string; reload: () => void}; serverID: string}) {
  const {permissions} = useServer();
  const folders = [...new Map([...nativeFolders, ...(folderRequest.data?.folders || [])].map(folder => [folder.path, folder])).values()].map(folder => ({...folder, to: safeFolderLink(serverID, folder.path)})).filter(folder => folder.to);
  return <>
    {can(permissions, 'file.read') && <SettingsSection className="game-folders" title="Game folders" action={<Link className="game-files-link" to={`/server/${encodeURIComponent(serverID)}/files`}>All files</Link>}>
      {folders.length ? <ul>{folders.map(folder => <li key={folder.path}><Link to={folder.to!}><span className="game-folder-identity"><span>{folder.label}</span><code>{folder.path}</code></span></Link></li>)}</ul> : <p className="muted">Folders appear after the game creates them.</p>}
      {folderRequest.loading && <p className="muted" role="status">Finding game folders...</p>}
      {folderRequest.error && <p className="muted">Folder lookup failed. <MiraAction type="button" className="text-button" onClick={folderRequest.reload}>Retry</MiraAction></p>}
    </SettingsSection>}
  </>;
}
