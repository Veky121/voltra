import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {Select,  Button, Field, Loading, Modal } from "../lib";
import { Icon } from "../Icons";
import { DataTable, ErrorMessage, Heading, Panel, api, rows, useAPI } from "./shared";
import "./node-pairing.css";
import "./infrastructure-ui.css";

type Enrollment = {
  id: string;
  expires_at: string;
  max_nodes: number;
  approved_count: number;
  closed: boolean;
  recovery_node_id?: number | null;
  recovery_node_name?: string;
};
type CreatedEnrollment = Enrollment & {
  connection_strings: { local: string; external: string };
  install_command: string;
  install_commands?: { local: string; external: string };
  release_url?: string;
};
type NodeRequest = {
  id: string;
  session_id: string;
  hostname: string;
  platform: string;
  architecture: string;
  memory_mib: number;
  disk_mib: number;
  verification_code: string;
  remote_ip: string;
  status: string;
  node_id?: number | null;
  connected: boolean;
  stage?: ConnectionStage;
  ready?: boolean;
  detail?: string;
  recovery_node_id?: number | null;
  recovery_node_name?: string;
  created_at: string;
};
type EnrollmentSnapshot = { sessions: Enrollment[]; requests: NodeRequest[] };
type ConnectionStage = "disconnected" | "starting" | "checking" | "ready" | "error";
type Health = { stage?: ConnectionStage; ready?: boolean; detail?: string };
type Connection = Health & { mode: "outbound" | "direct"; connected: boolean; revoked?: boolean; checked_at?: string };
const enrollmentsPath = "/api/admin/node-enrollments";

function healthLabel(health: Health) {
  if (health.ready === true && health.stage === "ready") return "Ready";
  if (health.stage === "error") return "Needs attention";
  if (health.stage === "starting") return "Starting services";
  if (health.stage === "disconnected") return "Disconnected";
  return "Checking Wings";
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// Each refresh completes before scheduling the next one. Abort both the fetch
// and the scheduled refresh when the wizard/connection view leaves the page.
function usePolling<T>(path: string, interval: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    let disposed = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    async function refresh() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15000);
      try {
        const result = await api<T>(path, { signal: controller.signal });
        if (!disposed) {
          setData(result);
          setError("");
          setUpdatedAt(Date.now());
        }
      } catch (error) {
        if (!disposed)
          setError(controller.signal.aborted ? "The panel took too long to respond. Retrying automatically." : message(error));
      } finally {
        clearTimeout(timeout);
        if (!disposed) {
          setLoading(false);
          next = setTimeout(refresh, interval);
        }
      }
    }
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(next);
      controller?.abort();
    };
  }, [path, interval, version]);
  return { data, error, loading, updatedAt, reload };
}

// Independent mutations let an operator review several incoming nodes without
// locking the whole enrollment. Requests cannot outlive their mounted view.
function useMutation() {
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => () => active.current?.abort(), []);
  async function run<T>(label: string, path: string, body?: unknown): Promise<{ value: T } | null> {
    if (active.current) return null;
    const controller = new AbortController();
    active.current = controller;
    setBusy(label);
    setError("");
    try {
      const value = await api<T>(path, {
        method: "POST",
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return controller.signal.aborted ? null : { value };
    } catch (error) {
      if (!controller.signal.aborted) setError(message(error));
      return null;
    } finally {
      if (!controller.signal.aborted) setBusy("");
      if (active.current === controller) active.current = null;
    }
  }
  return { run, busy, error };
}

function capacity(mib: number) {
  return mib >= 1024 ? `${(mib / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} GiB` : `${mib.toLocaleString()} MiB`;
}
function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
function enrollmentState(session: Enrollment, now: number) {
  if (new Date(session.expires_at).getTime() <= now) return "Expired";
  if (session.max_nodes > 0 && session.approved_count >= session.max_nodes) return "Limit reached";
  if (session.closed) return "Closed";
  return "Open";
}

export function NodeList() {
  const nodes = useAPI("/api/application/nodes?per_page=100");
  const [open, setOpen] = useState(false);
  const list = nodes.data ? rows(nodes.data) : [];
  return (
    <div className="admin-infrastructure infrastructure-nodes">
      <Heading title="Nodes">
        <Button onClick={() => setOpen(true)}><Icon name="nodes" />Add nodes</Button>
        <Link className="button secondary" to="/admin/nodes/new">Advanced manual setup</Link>
        <Button variant="secondary" onClick={nodes.reload}>Refresh</Button>
      </Heading>
      <ErrorMessage error={nodes.error} />
      {nodes.loading && !nodes.data ? <Loading /> : (
        <Panel>
          {!list.length && !nodes.error ? (
            <div className="node-pairing-empty">
              <Icon name="nodes" width={32} height={32} />
              <h2>Add your first node</h2>
              <p className="muted">Install the node agent on a Linux machine, paste a connection string, and approve it here. Credentials and Wings configuration are created automatically.</p>
              <Button onClick={() => setOpen(true)}>Add nodes</Button>
              <p className="muted">Node management connects outbound to this panel. Game ports and optional SFTP access need their own network configuration.</p>
            </div>
          ) : (
            <DataTable data={list} empty={nodes.error ? "The node list could not be loaded. Use Refresh to try again." : "No nodes match your search."} columns={[
              { label: "Node", render: (node) => <Link to={`/admin/nodes/${node.id}`}>{node.name}</Link> },
              { label: "Address", render: (node) => node.fqdn },
              { label: "Memory", render: (node) => capacity(Number(node.memory ?? 0)) },
              { label: "Disk", render: (node) => capacity(Number(node.disk ?? 0)) },
              { label: "Connection", render: (node) => <NodeConnection key={node.id} nodeId={node.id} compact /> },
              { label: "Maintenance", render: (node) => node.maintenance_mode ? "Enabled" : "Off" },
              { label: "Actions", render: (node) => <ReconnectNode nodeId={node.id} nodeName={node.name} onChanged={nodes.reload} /> },
            ]} />
          )}
        </Panel>
      )}
      {open && <NodePairingWizard onClose={() => { setOpen(false); nodes.reload(); }} onNodesChanged={nodes.reload} />}
    </div>
  );
}

export function NodeConnection({ nodeId, nodeName, compact = false }: { nodeId: number; nodeName?: string; compact?: boolean }) {
  const connection = usePolling<Connection>(`/api/admin/nodes/${nodeId}/connection`, compact ? 10000 : 5000);
  const mutation = useMutation();
  const [revoked, setRevoked] = useState(false);
  const data = connection.data;
  const status = !data ? "Checking Wings" : healthLabel(data);
  const ready = data?.ready === true && data.stage === "ready" && !connection.error && !mutation.error && !revoked;
  const badge = <span role="status" className={`badge node-pairing-status ${ready ? "is-connected" : ""}`}>{connection.error || mutation.error ? "Check unavailable" : revoked ? "Disconnected" : status}</span>;
  if (compact) return <span title={connection.error || data?.detail}>{badge}</span>;
  return (
    <Panel title="Node connection">
      <div className="actions">{badge}<Button variant="secondary" disabled={!!mutation.busy} onClick={async () => {
        if (await mutation.run("check", `/api/admin/nodes/${nodeId}/check`)) connection.reload();
      }}>{mutation.busy === "check" ? "Checking..." : "Check again"}</Button><ReconnectNode nodeId={nodeId} nodeName={nodeName || `node #${nodeId}`} onChanged={() => { setRevoked(false); connection.reload(); }} /></div>
      <ErrorMessage error={connection.error} />
      {!ready && data?.detail && <p className="muted node-pairing-note">{data.detail}</p>}
      {connection.error && connection.updatedAt && <p className="muted">Last checked {new Date(connection.updatedAt).toLocaleTimeString()}. Retrying automatically.</p>}
      {data?.mode === "direct" && <p className="muted node-pairing-note">This node uses direct Wings access. Check its connection in node diagnostics below.</p>}
      {data?.mode === "outbound" && (
        <>
          <p className="muted node-pairing-note">Reconnect to restore this node. Its servers and allocations stay in place.</p>
          <details className="node-pairing-node-details"><summary>Advanced</summary>
          <Button variant="danger" disabled={!!mutation.busy || revoked} onClick={async () => {
            if (!window.confirm("Revoke management credentials and enable maintenance mode? Running game servers will keep running. Use Reconnect to restore access.")) return;
            if (await mutation.run("disconnect", `/api/admin/nodes/${nodeId}/disconnect`)) {
              setRevoked(true);
              connection.reload();
            }
          }}>{mutation.busy === "disconnect" ? "Disconnecting..." : revoked ? "Credential revoked" : "Disconnect and revoke"}</Button></details>
        </>
      )}
      <ErrorMessage error={mutation.error} />
      {revoked && <p className="muted" role="status">Credentials revoked. Choose Reconnect to restore this node.</p>}
    </Panel>
  );
}

function ReconnectNode({ nodeId, nodeName, onChanged }: { nodeId: number; nodeName: string; onChanged: () => void }) {
  const mutation = useMutation();
  const [enrollment, setEnrollment] = useState<CreatedEnrollment | null>(null);
  return <>
    <Button variant="secondary" disabled={!!mutation.busy} aria-label={`Reconnect ${nodeName}`} onClick={async () => {
      const result = await mutation.run<CreatedEnrollment>("reconnect", `/api/admin/nodes/${nodeId}/reconnect`);
      if (result) setEnrollment({ ...result.value, recovery_node_id: nodeId, recovery_node_name: nodeName });
    }}>{mutation.busy ? "Opening..." : "Reconnect"}</Button>
    <ErrorMessage error={mutation.error} />
    {enrollment && <NodePairingWizard initialEnrollment={enrollment} onClose={() => { setEnrollment(null); onChanged(); }} onNodesChanged={onChanged} />}
  </>;
}

function NodePairingWizard({ onClose, onNodesChanged, initialEnrollment }: { onClose: () => void; onNodesChanged: () => void; initialEnrollment?: CreatedEnrollment }) {
  const snapshot = usePolling<EnrollmentSnapshot>(enrollmentsPath, 2000);
  const locations = useAPI("/api/application/locations?per_page=100");
  const mutation = useMutation();
  const [mode, setMode] = useState<"local" | "external">("local");
  const [secrets, setSecrets] = useState<Record<string, CreatedEnrollment>>(initialEnrollment ? { [initialEnrollment.id]: initialEnrollment } : {});
  const [activeId, setActiveId] = useState<string | null>(initialEnrollment?.id ?? null);
  const [maxNodes, setMaxNodes] = useState("0");
  const [expiresMinutes, setExpiresMinutes] = useState("30");
  const [locationId, setLocationId] = useState("");
  const [now, setNow] = useState(Date.now());
  const [search, setSearch] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current?.closest<HTMLElement>("[role=dialog]");
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? []).filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    function trap(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    }
    document.addEventListener("keydown", trap);
    return () => { document.removeEventListener("keydown", trap); previous?.focus(); };
  }, []);
  const sessions = snapshot.data?.sessions ?? [];
  const created = activeId === null ? undefined : secrets[activeId];
  const latestSession = sessions.find((item) => item.id === activeId) ?? created;
  const session = latestSession ? { ...created, ...latestSession, closed: latestSession.closed || !!created?.closed } : null;
  const recovery = !!session?.recovery_node_id;
  const requests = (snapshot.data?.requests ?? []).filter((request) => request.session_id === activeId);
  const pendingCount = requests.filter((request) => request.status === "pending").length;
  const visible = requests.filter((request) => [request.hostname, request.remote_ip, request.verification_code, request.status].join(" ").toLowerCase().includes(search.toLowerCase()));
  const sorted = [...visible].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const state = session ? enrollmentState(session, now) : "";
  async function createEnrollment(event: FormEvent) {
    event.preventDefault();
    const result = await mutation.run<CreatedEnrollment>("create", enrollmentsPath, {
      max_nodes: Number(maxNodes), expires_minutes: Number(expiresMinutes),
      ...(locationId ? { location_id: Number(locationId) } : {}),
    });
    if (result) {
      setNow(Date.now());
      setSecrets((current) => ({ ...current, [result.value.id]: result.value }));
      setActiveId(result.value.id);
      setSearch("");
      snapshot.reload();
    }
  }
  const advanced = (
    <details className="node-pairing-advanced" key={session ? "active" : "new"}>
      <summary>Advanced</summary>
      {session ? (
        <>
          <dl className="node-pairing-settings">
            <dt>Enrollment</dt><dd><code>{session.id}</code></dd>
            <dt>Status</dt><dd>{state}</dd>
            <dt>Approved</dt><dd>{session.approved_count} / {session.max_nodes || "unlimited"}</dd>
            <dt>Expires</dt><dd><time dateTime={session.expires_at}>{date(session.expires_at)}</time></dd>
          </dl>
          <div className="actions">
            {!initialEnrollment && <Button variant="secondary" onClick={() => { setActiveId(null); setSearch(""); }}>New enrollment</Button>}
            {!session.closed && <Button variant="danger" disabled={!!mutation.busy} onClick={async () => {
              if (!window.confirm("Close this enrollment? Pending requests will expire. Approved nodes remain paired.")) return;
              if (await mutation.run("close", `${enrollmentsPath}/${session.id}/close`)) {
                setSecrets((current) => current[session.id] ? { ...current, [session.id]: { ...current[session.id], closed: true } } : current);
                snapshot.reload();
              }
            }}>{mutation.busy === "close" ? "Closing..." : "Close enrollment"}</Button>}
          </div>
        </>
      ) : (
        <>
          <div className="form-grid">
            <Field label="Maximum approved nodes" hint="0 means unlimited."><input form="node-pairing-create" required type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" value={maxNodes} onChange={(event) => setMaxNodes(event.target.value)} /></Field>
            <Field label="Expires after, in minutes"><input form="node-pairing-create" required type="number" min="1" max="1440" step="1" value={expiresMinutes} onChange={(event) => setExpiresMinutes(event.target.value)} /></Field>
          </div>
          <Field label="Group"><Select form="node-pairing-create" value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">Automatic group</option>{(locations.data ? rows(locations.data) : []).map((location) => <option key={location.id} value={location.id}>{location.short}{location.long ? ` · ${location.long}` : ""}</option>)}</Select></Field>
          <ErrorMessage error={locations.error} />
        </>
      )}
      {!initialEnrollment && sessions.length > 0 && <div className="node-pairing-history">
        <label className="field"><span>Enrollment history</span><Select value={activeId ?? ""} onChange={(event) => { if (event.target.value) { setActiveId(event.target.value); setSearch(""); } }}>
          <option value="">Select enrollment</option>
          {sessions.map((item) => <option key={item.id} value={item.id}>{item.recovery_node_id ? `Reconnect ${item.recovery_node_name || `node #${item.recovery_node_id}`}` : `#${item.id.slice(0, 8)}`} · {enrollmentState(item, now)} · {item.approved_count} approved</option>)}
        </Select></label>
      </div>}
      <p className="muted">Only approve codes you recognize. Game ports and optional SFTP need separate network access.</p>
      <p className="muted">Connection strings disappear when this window closes. Enrollment requests remain available here.</p>
    </details>
  );
  return (
    <Modal title={recovery ? `Reconnect ${session?.recovery_node_name || `node #${session?.recovery_node_id}`}` : "Add nodes"} onClose={onClose}>
      <div className="node-pairing" ref={dialogRef}>
        <div className="node-pairing-mode" role="group" aria-label="Connection address">
          <Button variant="secondary" aria-pressed={mode === "local"} onClick={() => setMode("local")}>Local</Button>
          <Button variant="secondary" aria-pressed={mode === "external"} onClick={() => setMode("external")}>External</Button>
        </div>
        {recovery && <p className="muted node-pairing-intro">Restore this node on its original machine. Servers and allocations stay in place.</p>}
        <ErrorMessage error={mutation.error} />
        {snapshot.error && <div className="node-pairing-error" role="alert"><span>{snapshot.error} Retrying...</span><Button variant="secondary" onClick={snapshot.reload}>Retry</Button></div>}
        {!session ? (
          <>
            <p className="muted node-pairing-intro">Install on each Linux machine, then approve it here.</p>
            <form id="node-pairing-create" onSubmit={createEnrollment}>
              <Button type="submit" disabled={!!mutation.busy}>{mutation.busy === "create" ? "Getting started..." : "Get started"}</Button>
            </form>
            {advanced}
          </>
        ) : (
          <>
            {created ? <InstallInstructions key={session.id} enrollment={created} mode={mode} inactive={state !== "Open"} /> : <p className="muted node-pairing-intro">This enrollment's connection string is no longer available. Start a new one in Advanced.</p>}
            <section className="node-pairing-incoming" aria-label="Incoming nodes">
              <div className="node-pairing-waiting">
                <span role="status">{state === "Open" ? <><span className="spinner" aria-hidden="true" />Waiting for nodes{pendingCount ? ` · ${pendingCount} pending` : ""}</> : state}</span>
                <Button variant="secondary" aria-label="Refresh requests" onClick={snapshot.reload}><Icon name="restart" width={16} height={16} /></Button>
              </div>
              {requests.length > 5 && <input className="node-pairing-search" aria-label="Search incoming nodes" placeholder="Search nodes or codes" value={search} onChange={(event) => setSearch(event.target.value)} />}
              <div className="node-pairing-requests">{sorted.map((request) => <IncomingNode key={request.id} request={request} session={session} now={now} healthAvailable={!snapshot.error} onChanged={() => { snapshot.reload(); onNodesChanged(); }} />)}</div>
              {!!requests.length && !visible.length && <p className="muted">No matching nodes.</p>}
            </section>
            {advanced}
          </>
        )}
      </div>
    </Modal>
  );
}

function InstallInstructions({ enrollment, mode, inactive }: { enrollment: CreatedEnrollment; mode: "local" | "external"; inactive: boolean }) {
  const [local, setLocal] = useState(enrollment.connection_strings.local);
  const [external, setExternal] = useState(enrollment.connection_strings.external);
  const selected = mode === "local" ? local : external;
  const installer = installCommand(enrollment, mode, selected);
  const installerBase = installer.error ? "" : new URL(selected.slice(0, selected.lastIndexOf("#")).trim()).origin;
  const latest = useAPI(!enrollment.recovery_node_id && installerBase ? `/api/admin/node-installer?panel_url=${encodeURIComponent(installerBase)}` : null);
  const candidate = latest.data as {version:string; source:string; channel:string; panel_url:string; release_url:string; installer_url:string; install_command:string} | null;
  const release = candidate?.panel_url === installerBase ? candidate : null;
  const command = enrollment.recovery_node_id ? installer.command : release?.install_command ?? "";
  const unavailable = !!installer.error || (!enrollment.recovery_node_id && (latest.loading || !!latest.error || !release));
  return (
    <><ol className="node-pairing-commands">
      <li>{latest.loading && <p role="status">Finding the latest Linux node installer...</p>}<CopyValue label="Run installer" value={command} disabled={unavailable} /><small className="muted">{enrollment.recovery_node_id ? "Recovery setup opens automatically using the installed connector." : "Paste this command into the Linux terminal. It installs matching Wings and connector binaries, verifies checksums, and opens setup. Requires systemd, Docker, curl and sha256sum."}</small>{release && <small className="muted">{release.source === "pinned" ? "Configured release" : `Latest complete ${release.channel} release`}: {release.version} · Linux amd64 / arm64</small>}{release && <a className="node-pairing-release" href={release.installer_url} target="_blank" rel="noreferrer">Download Linux installer</a>}{latest.error && <><ErrorMessage error={latest.error}/><Button variant="secondary" onClick={latest.reload}>Check release again</Button></>}</li>
      <li><CopyValue label="Paste connection string" value={selected} onChange={mode === "local" ? setLocal : setExternal} disabled={inactive || !!installer.error} sensitive /></li>
    </ol>{!enrollment.recovery_node_id && <p className="muted">Setup opens automatically. Approve the matching code here to create and enable the node services. After approval, check <code>sudo systemctl status voltra-wings voltra-node</code>. Enable boot startup with <code>sudo systemctl enable voltra-wings voltra-node</code>.</p>}<ErrorMessage error={installer.error} /></>
  );
}

// The editable address is never allowed to carry the enrollment fragment into
// a shell command. Keep the server's command for its original local address;
// use mode-specific commands when available. The hidden connection string
// determines the enrollment address; downloads always use the pinned release.
function installCommand(enrollment: CreatedEnrollment, mode: "local" | "external", connection: string) {
  try {
    const raw = connection.slice(0, connection.lastIndexOf("#")).trim();
    const url = new URL(raw);
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || !(url.protocol === "https:" || (url.protocol === "http:" && loopback))) throw new Error("invalid address");
    const base = url.origin;
    const original = enrollment.connection_strings[mode];
    if (connection === original && enrollment.install_commands?.[mode]) return { command: enrollment.install_commands[mode], error: "" };
    const originalLocal = enrollment.connection_strings.local.split("#")[0].replace(/\/+$/, "");
    if (base === originalLocal) return { command: enrollment.install_command, error: "" };
    return { command: enrollment.install_command, error: "" };
  } catch {
    return { command: "", error: "Use an HTTPS panel address without a path or credentials. Loopback HTTP is allowed for development." };
  }
}

function CopyValue({ label, value, onChange, disabled = false, sensitive = false }: { label: string; value: string; onChange?: (value: string) => void; disabled?: boolean; sensitive?: boolean }) {
  const [feedback, setFeedback] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const fragment = value.lastIndexOf("#");
  const hiddenToken = sensitive && fragment >= 0;
  const displayed = hiddenToken ? value.slice(0, fragment) : value;
  useEffect(() => setFeedback(""), [value]);
  return (
    <div className="node-pairing-copy">
      <label><span>{label}</span><span className={hiddenToken ? "node-pairing-secret" : undefined}><input ref={input} aria-label={label} title={hiddenToken ? "Edit the panel address. Copy includes the private pairing token." : undefined} value={displayed} readOnly={!onChange} spellCheck={false} autoComplete="off" onChange={(event) => onChange?.(hiddenToken ? event.target.value.split("#")[0] + value.slice(fragment) : event.target.value)} onFocus={(event) => { if (!onChange) event.target.select(); }} />{hiddenToken && <span aria-hidden="true">#••••••••</span>}</span></label>
      <Button variant="secondary" disabled={disabled || !value} aria-label={`Copy ${label.toLowerCase()}`} onClick={async () => {
        try {
          if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
          await navigator.clipboard.writeText(value);
          setFeedback("Copied");
        } catch {
          if (sensitive) {
            const field = document.createElement("textarea");
            field.value = value;
            field.style.position = "fixed";
            field.style.opacity = "0";
            document.body.appendChild(field);
            field.select();
            let copied = false;
            try { copied = document.execCommand("copy"); } catch { /* Report blocked clipboard below. */ }
            finally { field.remove(); input.current?.focus(); }
            setFeedback(copied ? "Copied" : "Clipboard blocked. Allow clipboard access, then retry.");
          } else {
            input.current?.focus(); input.current?.select();
            setFeedback("Select and copy with your keyboard.");
          }
        }
      }}><Icon name="copy" width={16} height={16} /><span className="node-pairing-copy-label">Copy</span></Button>
      {feedback && <small className="muted" role="status">{feedback}</small>}
    </div>
  );
}

function IncomingNode({ request, session, now, healthAvailable, onChanged }: { request: NodeRequest; session: Enrollment; now: number; healthAvailable: boolean; onChanged: () => void }) {
  const mutation = useMutation();
  const [name, setName] = useState(request.hostname);
  const [completed, setCompleted] = useState("");
  const [approvedNodeId, setApprovedNodeId] = useState<number | null>(null);
  const status = request.status === "pending" ? completed || request.status : request.status;
  const pending = status === "pending";
  const paired = status === "approved" || status === "completed";
  const nodeId = request.node_id ?? approvedNodeId ?? request.recovery_node_id ?? session.recovery_node_id;
  const recovery = !!(request.recovery_node_id || session.recovery_node_id);
  const title = recovery ? `Reconnect ${request.recovery_node_name || session.recovery_node_name || `node #${nodeId}`}` : request.hostname || "Unnamed machine";
  const ready = healthAvailable && request.ready === true && request.stage === "ready" && !mutation.error;
  const canApprove = enrollmentState(session, now) === "Open";
  return (
    <article className="node-pairing-request" aria-label={recovery ? title : `Request from ${request.hostname}`}>
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (!pending || !canApprove) return;
        const result = await mutation.run<{ node_id: number }>("approve", `/api/admin/node-requests/${request.id}/approve`, !recovery && name.trim() ? { name: name.trim() } : {});
        if (result) { setApprovedNodeId(result.value.node_id); setCompleted("approved"); onChanged(); }
      }}>
        <div className="node-pairing-request-row">
          <strong title={title}>{title}</strong>
          <code aria-label="Verification code">{request.verification_code}</code>
          <div className="actions">
            {pending ? <>
              <Button type="submit" disabled={!!mutation.busy || !canApprove}>{mutation.busy === "approve" ? "Approving..." : "Approve"}</Button>
              <Button variant="secondary" disabled={!!mutation.busy} onClick={async () => {
                if (await mutation.run("reject", `/api/admin/node-requests/${request.id}/reject`)) { setCompleted("rejected"); onChanged(); }
              }}>{mutation.busy === "reject" ? "Rejecting..." : "Reject"}</Button>
            </> : <><span role="status" className={`badge node-pairing-status ${paired && ready ? "is-connected" : ""}`}>{paired ? !healthAvailable || mutation.error ? "Check unavailable" : healthLabel({ ...request, stage: request.stage || "starting" }) : status[0]?.toUpperCase() + status.slice(1)}</span>
              {paired && !ready && nodeId && <Button variant="secondary" disabled={!!mutation.busy} onClick={async () => {
                if (await mutation.run("check", `/api/admin/nodes/${nodeId}/check`)) onChanged();
              }}>{mutation.busy === "check" ? "Checking..." : "Check again"}</Button>}</>}
          </div>
        </div>
        {paired && !ready && request.detail && <p className="muted node-pairing-detail">{request.detail}</p>}
        <details className="node-pairing-node-details">
          <summary>Details</summary>
          <p className="muted">{request.platform} / {request.architecture} · {capacity(request.memory_mib)} RAM · {capacity(request.disk_mib)} disk</p>
          <p className="muted">{request.remote_ip || "IP unavailable"} · {date(request.created_at)} · {status}</p>
          {pending && !recovery && <Field label="Node name"><input aria-label={`Node name for ${request.hostname}`} maxLength={253} value={name} placeholder={request.hostname} onChange={(event) => setName(event.target.value)} disabled={!!mutation.busy} /></Field>}
          {nodeId && <Link to={`/admin/nodes/${nodeId}`}>Manage node #{nodeId}</Link>}
          {status === "revoked" && <p className="muted">Choose Reconnect on the existing node to restore access.</p>}
        </details>
        <ErrorMessage error={mutation.error} />
      </form>
    </article>
  );
}
