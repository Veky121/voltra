import {Feedback} from '../notifications';
import {SettingsSkeleton} from '../ui/SettingsSkeleton';
import {Disclosure,DisclosureTrigger} from '../ui/Disclosure';
import './games-ui.css';
import {useEffect, useRef, useState} from 'react';
import {Link, useParams} from 'react-router-dom';
import {api, Button, Card, ErrorBox, Field, Input, Select} from '../lib';
import {can, date, json, useServer} from './common';
import {activeSteamJob, checkDue, steamJobLabel, stoppedServer, type SteamJob, type SteamStatus} from './gameSetupModel';
import {useGameRequest} from './useGameRequest';
import {useServerTelemetry} from './ServerDashboard';
import './steamGames.css';
import PrivateSteamMaintenance, {type PrivateSteamStatus} from './PrivateSteamMaintenance';
import {usePendingSetting} from './PendingSettings';
import {SettingsRow,SettingsSection} from '../ui/Settings';
import {ButtonFeedback} from '../ui/ButtonFeedback';
import {useTransientMessage} from '../hooks/useTransientMessage';
import {RefreshCw,Download,Wrench} from 'lucide-react';
import {isLivePathFresh} from '../hooks/liveEvents';

export default function SteamMaintenance() {
  const {base, permissions, server, reload: reloadServer} = useServer();
  const {id} = useParams();
  const readable = can(permissions, 'startup.read');
  const request = useGameRequest<SteamStatus>(base && readable ? `${base}/steam` : null, 3000);
  const privateStatus = useGameRequest<PrivateSteamStatus>(base && can(permissions, 'startup.update') ? `${base}/steam/private` : null, 3000);
  useEffect(() => {
    if (!server.is_installing || server.status === 'install_failed' || server.status === 'reinstall_failed') return;
    const timer = setInterval(()=>{if(!document.hidden&&!isLivePathFresh(base))reloadServer()},3000);
    return () => clearInterval(timer);
  }, [base,server.is_installing, server.status, reloadServer]);
  return <div className="steam-maintenance-page games-ui"><header className="page-header"><div><h2>Updates & repair</h2><p className="muted">Manage game files, update checks and repairs.</p></div>{id && can(permissions, 'file.read-content') && <Link to={`/server/${encodeURIComponent(id)}/settings`}>Game Config →</Link>}</header>
    {!base ? <ErrorBox>Select a server to view Updates & repair.</ErrorBox> : !readable ? <p className="muted">Startup read permission is required to view Updates & repair.</p> : <>
      <ErrorBox>{request.error}</ErrorBox>{request.error && <Button variant="secondary" onClick={request.reload}>Retry Steam status</Button>}
      {request.loading && !request.data && <SettingsSkeleton label="Loading Steam status"/>}
      {privateStatus.error && <ErrorBox>{privateStatus.error}</ErrorBox>}
      {request.data && (request.data.supported ? <SteamControls key={base} status={request.data} unavailable={!!request.error || !!privateStatus.error || (can(permissions, 'startup.update') && !privateStatus.data)} privateContent={!!privateStatus.data?.private_content} reload={request.reload}/> : <Card><p>Updates & repair is not configured for {server.name || 'this server'}.</p></Card>)}
      {privateStatus.data?.supported && <PrivateSteamMaintenance key={`private-${base}`} status={privateStatus.data} unavailable={!!privateStatus.error} reload={privateStatus.reload}/>}
    </>}
  </div>;
}

function SteamControls({status, unavailable, privateContent, reload}: {status: SteamStatus; unavailable: boolean; privateContent: boolean; reload: () => void}) {
  const {base, permissions, server} = useServer();
  const telemetry = useServerTelemetry();
  const writable = can(permissions, 'startup.update');
  const [mode, setMode] = useState(status.mode), [minutes, setMinutes] = useState(String(status.check_interval_seconds / 60));
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [success, setSuccess] = useTransientMessage(2000);
  const [editing, setEditing] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {if (!editing) {setMode(status.mode); setMinutes(String(status.check_interval_seconds / 60));}}, [status.mode, status.check_interval_seconds]);
  const job = activeSteamJob(status.current_job) ? status.current_job : status.jobs.find(activeSteamJob);
  const stopped = stoppedServer(telemetry.state, telemetry.updated, telemetry.error, server.status);
  const blocked = !writable || unavailable || privateContent || !status.node_available || !!server.status || !!server.is_node_under_maintenance || !!job || !!busy;
  async function run(operation: 'check' | 'update' | 'verify') {
    if (blocked || (operation !== 'check' && !stopped) || submitting.current) return;
    submitting.current = true; setBusy(operation); setError(''); setSuccess('');
    try {await api(`${base}/steam/${operation}`, json('POST', {})); setSuccess(operation); reload();}
    catch (error) {setError(error instanceof Error ? error.message : String(error));}
    finally {submitting.current = false; setBusy('');}
  }
  const seconds=Number(minutes)*60;
  const validInterval=Number.isInteger(Number(minutes))&&seconds>=300&&seconds<=86400;
  const dirty=editing&&(mode!==status.mode||seconds!==status.check_interval_seconds);
  async function save() {
    if (!writable || unavailable || privateContent || submitting.current || !validInterval) throw new Error('Maintenance settings are unavailable.');
    submitting.current=true;setBusy('settings');setError('');
    try {await api(`${base}/steam`,json('PATCH',{mode,check_interval_seconds:seconds}));setEditing(false);}
    catch(error){setError(error instanceof Error?error.message:String(error));throw error;}
    finally{submitting.current=false;setBusy('');}
  }
  usePendingSetting(`steam-maintenance:${base}`,dirty,{summary:'Automatic updates',applies:'After saving',blocked:!writable||unavailable||privateContent||!!busy||!validInterval,save,afterSave:reload,discard:()=>{setMode(status.mode);setMinutes(String(status.check_interval_seconds/60));setEditing(false);setError('')}});
  return <div className="steam-maintenance-layout">
    <Card><div className="steam-card-heading"><h3>Game files</h3><span className="badge">{status.needs_repair ? 'Repair required' : status.update_available ? 'Update available' : status.last_checked_at ? 'Last check complete' : 'Not checked'}</span></div>
      {privateContent && <p role="status">This server uses private Steam content. Use Steam account content below for file maintenance.</p>}
      <dl className="steam-builds"><div><dt>Installed build</dt><dd>{status.installed_build || 'Not installed'}</dd></div><div><dt>Latest build</dt><dd>{status.latest_build || 'Not checked'}</dd></div><div><dt>Last successful check</dt><dd>{date(status.last_checked_at)}</dd></div><div><dt>Last attempt</dt><dd>{date(status.last_attempt_at)}</dd></div></dl>
      <p className="muted">Steam app {status.app_id} · {status.branch || 'public'} branch</p>
      {!status.node_available && <ErrorBox>The Steam node is disconnected or needs an upgrade. Maintenance is unavailable.</ErrorBox>}
      {status.needs_repair && <ErrorBox>{status.installed_build ? 'Game files need repair. Stop the server, then verify and repair files before starting.' : 'The initial installation is incomplete. Wait for the install job, or retry maintenance while stopped if it failed.'}</ErrorBox>}
      {job && <SteamJobProgress job={job}/>}
      {writable ? <><div className="actions steam-maintenance-actions">{([['check','Check',RefreshCw],['update','Update',Download],['verify','Repair',Wrench]] as const).map(([action,label,Icon])=><Button key={action} className="maintenance-action" variant={action==='update'?undefined:'secondary'} disabled={blocked||action!=='check'&&!stopped} aria-busy={busy===action} onClick={()=>void run(action)}><ButtonFeedback state={busy===action?'pending':success===action?'success':'idle'}><Icon/></ButtonFeedback>{label}<span className="button-feedback-sr" role="status">{success===action?'Request accepted':busy===action?'Sending request':''}</span></Button>)}</div><p className="muted">Check now bypasses the check cooldown. Update and repair require a stopped server. Verify can also update game files. Saves and configuration are preserved.</p>{!stopped && <p className="muted">Stop the server before updating or repairing. This page never stops players automatically.</p>}</> : <p className="muted">Startup update permission is required to run maintenance or change automatic settings.</p>}
      <ErrorBox>{error}</ErrorBox>
      {status.jobs.length > 0 && <Disclosure className="steam-history"><DisclosureTrigger>Recent jobs</DisclosureTrigger><ul>{status.jobs.map(item => <li key={item.id}><div><strong>{item.operation}</strong><span className="badge">{item.status.replaceAll('_', ' ')}</span></div><p>{item.detail || item.stage}</p><small className="muted">{date(item.completed_at || item.started_at || item.created_at)}</small>{item.error && <ErrorBox>{item.error}</ErrorBox>}<SteamJobLog job={item}/></li>)}</ul></Disclosure>}
    </Card>
    <SettingsSection title="Automatic updates">
      {privateContent ? <p className="server-proxy-note">Use Steam account content below.</p> : <>
      <SettingsRow label="Mode" control={<Select aria-label="Automatic update mode" disabled={!writable||!!busy||unavailable} value={mode} onChange={event=>{setMode(event.target.value as SteamStatus['mode']);setEditing(true)}}><option value="on_start">Check only</option><option value="scheduled">Update when stopped</option><option value="off">Off</option></Select>}/>
      <SettingsRow label="Interval (minutes)" description={editing&&!validInterval?'Enter 5 to 1,440 minutes.':undefined} control={<Input aria-label="Check interval in minutes" aria-invalid={editing&&!validInterval} type="number" min={5} max={1440} step={1} disabled={!writable||!!busy||unavailable} value={minutes} onChange={event=>{setMinutes(event.target.value);setEditing(true)}}/>}/>
      <p className="server-proxy-note">{checkDue(status)}</p>
      <Disclosure className="steam-maintenance-details"><DisclosureTrigger>Details</DisclosureTrigger><p>Intervals are in minutes. Updates run only while stopped. Starting uses installed files; active maintenance finishes first. Game and mod updates are separate.</p></Disclosure>
      </>}
    </SettingsSection>
  </div>;
}

function SteamJobProgress({job}: {job: SteamJob}) {
  return <div className="steam-job"><div role="status" aria-live="polite"><strong>{steamJobLabel(job)}</strong><span className="badge">{job.status.replaceAll('_', ' ')}</span></div><progress aria-label="Steam job progress"/><p>{job.stage?.replaceAll('_', ' ')}{job.detail ? ` · ${job.detail}` : ''}</p><SteamJobLog job={job}/></div>;
}

function SteamJobLog({job}: {job: SteamJob}) {
  const logs = job.logs?.slice(-50) ?? [];
  if (!logs.length) return null;
  return <Disclosure className="steam-job-log"><DisclosureTrigger>Job log <span className="muted">({logs.length})</span></DisclosureTrigger><ol>{logs.map((entry, index) => <li key={`${entry.created_at}-${index}`}><time dateTime={entry.created_at}>{date(entry.created_at)}</time><strong>{entry.stage.replaceAll('_', ' ')}</strong><p>{entry.detail}</p></li>)}</ol></Disclosure>;
}
