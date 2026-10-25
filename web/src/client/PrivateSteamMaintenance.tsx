import {GameSwitch} from './GameSwitch';
import './games-ui.css';
import {useEffect, useRef, useState, type FormEvent} from 'react';
import {api, Button, Card, ErrorBox, Field, Input, Select, rows, unwrap} from '../lib';
import {can, date, json, useServer} from './common';
import {activeSteamJob, stoppedServer, type SteamJob} from './gameSetupModel';
import {useGameRequest} from './useGameRequest';
import {useServerTelemetry} from './ServerDashboard';
import {privateOriginalLabel, validatePrivateOriginal, type SteamOriginalControls} from './privateSteamTemplateModel';
import {privateAuthorizationBody, privateGuardReply, privateGuardUsable, type PrivateGuard} from './privateSteamModel';

export type PrivateSteamStatus = {original_controls?: SteamOriginalControls; supported: boolean; ready: boolean; reason: string; app_id: number; branch: string; private_content: boolean; recovery_ready?: boolean; recovery_reason?: string; recovery_job_id?: string};
type Authorization = {id: string; saved_password: boolean; revoked: boolean; created_at: string};
type PrivateJob = SteamJob & {guard?: PrivateGuard};

export default function PrivateSteamMaintenance({status, unavailable, reload}: {status: PrivateSteamStatus; unavailable: boolean; reload: () => void}) {
  const {base, permissions, server} = useServer();
  const writable = can(permissions, 'startup.update');
  const telemetry = useServerTelemetry();
  const stopped = stoppedServer(telemetry.state, telemetry.updated, telemetry.error, server.status);
  const endpoint = `${base}/steam/private`;
  const profiles = useGameRequest<{data: unknown[]}>(writable ? `${endpoint}/authorizations` : null, 5000);
  const jobs = useGameRequest<{data: unknown[]}>(writable ? `${endpoint}/jobs` : null, 2000);
  const authorizations = rows(profiles.data) as Authorization[];
  const history = rows(jobs.data) as PrivateJob[];
  const active = history.find(activeSteamJob);
  const current = useGameRequest<PrivateJob>(active ? `${endpoint}/jobs/${encodeURIComponent(active.id)}` : null, 1000);
  const guard = current.data?.guard;
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [savePassword, setSavePassword] = useState(false);
  const [profileAction, setProfileAction] = useState('create'), [now, setNow] = useState(Date.now());
  const [authorization, setAuthorization] = useState(''), [jobPassword, setJobPassword] = useState('');
  const [branch, setBranch] = useState(status.branch || 'public'), [betaPassword, setBetaPassword] = useState('');
  const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const submitting = useRef(false);
  const recovery = useRef<AbortController | null>(null);
  const [recovering, setRecovering] = useState(false);
  const selected = authorizations.find(item => item.id === authorization && !item.revoked);
  const blocked = !writable || unavailable || !status.ready || !!server.status || !!server.is_node_under_maintenance || !!active || busy || !profiles.data || !jobs.data || !!profiles.error || !!jobs.error;
  const profileBlocked = !writable || unavailable || busy || !profiles.data || !!profiles.error || (profileAction === 'create' ? blocked : !selected);
  const recoveryBlocked = !writable || unavailable || !status.recovery_ready || !status.recovery_job_id || !!server.status || !!server.is_node_under_maintenance || !!active || busy || !stopped || !jobs.data || !!jobs.error;
  useEffect(() => {setUsername(''); setPassword(''); setJobPassword(''); setBetaPassword(''); setCode(''); return () => {recovery.current?.abort();};}, [endpoint]);
  useEffect(() => {setCode('');}, [guard?.challenge_id]);
  useEffect(() => {if (!guard) return; setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer);}, [guard?.challenge_id, guard?.expires_at]);
  useEffect(() => {setUsername(''); setPassword(''); setJobPassword(''); setBetaPassword('');}, [authorization]);
  useEffect(() => {
    if (!authorizations.some(item => item.id === authorization && !item.revoked)) setAuthorization(authorizations.find(item => !item.revoked)?.id || '');
  }, [profiles.data, authorization]);
  async function mutate(action: () => Promise<unknown>, success: string) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setMessage('');
    try {await action(); setMessage(success); profiles.reload(); jobs.reload(); current.reload(); reload();}
    catch (error) {if (error instanceof Error && error.name === 'AbortError') setMessage('Download check cancelled.'); else setError(error instanceof Error ? error.message : String(error));}
    finally {setPassword(''); setJobPassword(''); setBetaPassword(''); setCode(''); submitting.current = false; setBusy(false);}
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (profileBlocked || !username) return;
    await mutate(async () => {
      const updating = profileAction === 'update';
      const result = unwrap(await api(`${endpoint}/authorizations${updating ? `/${encodeURIComponent(authorization)}` : ''}`, json(updating ? 'PUT' : 'POST', privateAuthorizationBody(username, savePassword, password, status.original_controls)))) as Authorization;
      setAuthorization(result.id); setUsername(''); setSavePassword(false);
    }, profileAction === 'update' ? 'Authorization updated. Earlier jobs using it are cancelled.' : 'Account authorization added.');
  }
  async function run(operation: 'install' | 'update' | 'verify') {
    if (blocked || !selected || !stopped) return;
    await mutate(() => {if (!selected.saved_password) validatePrivateOriginal(jobPassword, status.original_controls?.password); validatePrivateOriginal(branch, status.original_controls?.branch); validatePrivateOriginal(betaPassword, status.original_controls?.beta_password); return api(`${endpoint}/jobs`, json('POST', {authorization_id: selected.id, operation, branch, ...(selected.saved_password ? {} : {password: jobPassword}), ...(betaPassword ? {beta_password: betaPassword} : {})}));}, 'Private Steam job queued.');
  }
  async function recover() {
    if (recoveryBlocked || submitting.current) return;
    const controller = new AbortController(); recovery.current = controller; setRecovering(true);
    try {await mutate(() => api(`${endpoint}/jobs/${encodeURIComponent(status.recovery_job_id!)}/recover`, {...json('POST', {}), signal: controller.signal}), 'Download result recovered. The server remains stopped.');}
    finally {if (recovery.current === controller) recovery.current = null; setRecovering(false);}
  }
  return <Card className="games-ui steam-private-content">
    <h3>Steam account content</h3>
    <p className="muted">Use your Steam account for game files that require ownership. Authorizations belong to your panel account. A completed download does not start the server.</p>
    {!status.ready && <p role="status">{status.reason}</p>}
    <ErrorBox>{error || profiles.error || jobs.error || current.error}</ErrorBox>
    {message && <p className="success" role="status">{message}</p>}
    {status.recovery_job_id && <div className="steam-job">
      <p>Recover the result of a finished download after a connection interruption, without signing in again.</p>
      {!status.recovery_ready && <p className="muted">{status.recovery_reason || 'Download recovery is not enabled on this node.'}</p>}
      {!stopped && <p className="game-stop-note">Stop the server before checking its downloaded files.</p>}
      <Button variant="secondary" disabled={recoveryBlocked} onClick={() => void recover()}>{recovering ? 'Checking downloaded files…' : 'Recover download result'}</Button>
      {recovering && <Button variant="secondary" onClick={() => recovery.current?.abort()}>Cancel check</Button>}
    </div>}
    {authorizations.length > 0 && <div className="steam-fields">
      <Field label="Your account authorization"><Select value={authorization} onChange={event => setAuthorization(event.target.value)} disabled={busy}>{authorizations.filter(item => !item.revoked).map((item, index) => <option key={item.id} value={item.id}>Account {index + 1} · {date(item.created_at)}{item.saved_password ? ' · password saved' : ''}</option>)}</Select></Field>
      {selected && <Button variant="danger" disabled={busy} onClick={() => void mutate(() => api(`${endpoint}/authorizations/${encodeURIComponent(selected.id)}`, {method: 'DELETE'}), 'Authorization revoked and its active jobs cancelled.')}>Revoke authorization</Button>}
      {!selected?.saved_password && <Field label={privateOriginalLabel(status.original_controls?.password, 'Password for this job')}><Input type="password" autoComplete="off" value={jobPassword} onChange={event => setJobPassword(event.target.value)} disabled={blocked}/></Field>}
      <Field label={privateOriginalLabel(status.original_controls?.branch, 'Branch')}><Input value={branch} onChange={event => setBranch(event.target.value)} disabled={blocked}/></Field>
      <Field label={privateOriginalLabel(status.original_controls?.beta_password, 'Branch password, if required')}><Input type="password" autoComplete="off" value={betaPassword} onChange={event => setBetaPassword(event.target.value)} disabled={blocked}/></Field>
      <div className="actions"><Button disabled={blocked || !selected || !stopped} onClick={() => void run('install')}>Install</Button><Button variant="secondary" disabled={blocked || !selected || !stopped} onClick={() => void run('update')}>Update</Button><Button variant="secondary" disabled={blocked || !selected || !stopped} onClick={() => void run('verify')}>Verify</Button></div>
      {!stopped && <p className="game-stop-note">Stop the server before installing or maintaining private game files.</p>}
    </div>}
    <details className="steam-advanced steam-authorization"><summary>Add or update Steam account authorization</summary><form onSubmit={create}>
      <Field label="Authorization action"><Select value={profileAction} onChange={event => {setProfileAction(event.target.value); setUsername(''); setPassword(''); setSavePassword(false);}} disabled={busy}><option value="create">Add account</option><option value="update" disabled={!selected}>Update selected authorization</option></Select></Field>
      {profileAction === 'update' && <p className="muted">Re-enter the same account name to keep its content ownership. Updating cancels its earlier jobs. Clearing the save option removes its stored password. Changing accounts requires a separate content migration.</p>}
      <fieldset className="steam-fields" disabled={profileBlocked}>
      <Field label={privateOriginalLabel(status.original_controls?.username, 'Steam account name')}><Input autoComplete="off" required value={username} onChange={event => setUsername(event.target.value)}/></Field>
      <label className="steam-save-password"><GameSwitch checked={savePassword} onCheckedChange={checked => setSavePassword(checked)}/> Save an encrypted password for future jobs</label>
      {savePassword && <Field label={privateOriginalLabel(status.original_controls?.password, 'Steam password')}><Input type="password" autoComplete="new-password" required value={password} onChange={event => setPassword(event.target.value)}/></Field>}
      <Button type="submit" disabled={profileBlocked}>{profileAction === 'update' ? 'Update authorization' : 'Add authorization'}</Button>
    </fieldset></form></details>
    {active && <div className="steam-job"><p role="status">{active.operation} · {active.status} · {current.data?.detail || active.detail}</p>
      {guard && privateGuardUsable(guard, now) && <form onSubmit={event => {event.preventDefault(); if (busy) return; void mutate(() => api(`${endpoint}/jobs/${encodeURIComponent(active.id)}/guard`, json('POST', privateGuardReply(guard, guard.kind === 'device_confirmation' ? {accepted: true} : {code}))), 'Guard response sent.');}}>
        <p>Steam Guard · expires {date(guard.expires_at)}</p>
        {guard.kind === 'device_confirmation' ? <p>Approve the sign-in in your Steam app, then confirm here.</p> : <Field label={privateOriginalLabel(guard.code_controls, 'Steam Guard code')}><Input autoComplete="one-time-code" required value={code} onChange={event => setCode(event.target.value)} disabled={busy}/></Field>}
        <Button type="submit" disabled={busy}>{guard.kind === 'device_confirmation' ? 'I approved the sign-in' : 'Send code'}</Button>
        {guard.kind === 'device_confirmation' && <Button variant="danger" disabled={busy} onClick={() => void mutate(() => api(`${endpoint}/jobs/${encodeURIComponent(active.id)}/guard`, json('POST', privateGuardReply(guard, {accepted: false}))), 'Sign-in declined.')}>Decline sign-in</Button>}
      </form>}
      {guard && !privateGuardUsable(guard, now) && <p role="status">This Steam Guard challenge expired. Wait for a new challenge or cancel and create a new job.</p>}
      <Button variant="danger" disabled={busy} onClick={() => void mutate(() => api(`${endpoint}/jobs/${encodeURIComponent(active.id)}/cancel`, json('POST', {})), 'Cancellation requested.')}>Cancel job</Button>
    </div>}
    {history.length > 0 && <details className="steam-history"><summary>Private Steam jobs</summary><ul>{history.map(job => <li key={job.id}><strong>{job.operation} · {job.status.replaceAll('_', ' ')}</strong><p>{job.detail || job.stage}</p><small>{date(job.completed_at || job.created_at)}</small>{job.error && <ErrorBox>{job.error}</ErrorBox>}</li>)}</ul></details>}
  </Card>;
}

