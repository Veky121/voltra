import { createContext, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {Select,  api, Button, Card, ErrorBox, Field, Loading } from "./lib";
import "./setup.css";
import BrandMark from "./BrandMark";

type SetupStatus = {
  needs_setup: boolean;
  setup_allowed: boolean;
  auth_enabled: boolean;
  public_url: string;
  access_mode: "local" | "public";
  tls_mode: "proxy" | "automatic";
  restart_required: boolean;
  dev_mode: boolean;
  https_pending?: boolean;
};
type Session = { authenticated: boolean; csrf_token?: string; user?: { root_admin: boolean } };
type Validation = { valid: boolean; checks: { name: string; status: "ok" | "error" | "pending"; detail: string }[]; restart_required: boolean; can_save?: boolean };
type Completion = { completed: boolean; restart_required: boolean; next_url: string; https_pending?: boolean };
type HTTPSVerification = Validation & { completed: boolean; https_pending: boolean; next_url: string };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const sessionHeaders = (session: Session) => session.csrf_token ? { "X-CSRF-Token": session.csrf_token } : undefined;
export const AccountSessionContext=createContext({canSignOut:false,signOut:async()=>{}});

function SetupFrame({ title, children }: { title: string; children: ReactNode }) {
  return <main className="setup-screen"><Card className="setup-card"><div className="setup-brand"><BrandMark/><span>Voltra</span></div><h1>{title}</h1>{children}</Card></main>;
}

// Root wraps the application in this gate inside BrowserRouter. Neither setup
// nor authentication stores credentials outside the mounted form.
export default function SetupGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<{ status: SetupStatus; session: Session } | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    setError("");
    void Promise.all([
      api<SetupStatus>("/api/setup/status", { signal: controller.signal, cache: "no-store" }),
      api<Session>("/api/auth/session", { signal: controller.signal, cache: "no-store" }),
    ]).then(([status, session]) => {
      if (!controller.signal.aborted) setState({ status, session });
    }).catch((failure) => {
      if (!disposed) setError(controller.signal.aborted ? "The panel took too long to respond. Check the service, then retry." : errorText(failure));
    }).finally(() => clearTimeout(timeout));
    return () => { disposed = true; clearTimeout(timeout); controller.abort(); };
  }, [revision, location.pathname]);
  useEffect(() => {
    window.addEventListener("focus", reload);
    window.addEventListener("panel-auth-changed", reload);
    const timer = setInterval(reload, 60000);
    return () => { window.removeEventListener("focus", reload); window.removeEventListener("panel-auth-changed", reload); clearInterval(timer); };
  }, [reload]);
  if (error) return <SetupFrame title="Panel unavailable"><ErrorBox>{error}</ErrorBox><Button onClick={reload}>Retry</Button></SetupFrame>;
  if (!state) return <SetupFrame title="Opening panel"><Loading /></SetupFrame>;
  const { status, session } = state;
  const explicitSetup = location.pathname.replace(/\/+$/, "") === "/setup";
  const development = status.dev_mode && !status.auth_enabled;
  if (status.needs_setup && (explicitSetup || !development)) {
    if (!status.setup_allowed) return <SetupFrame title="Set up locally"><p className="muted">Open this panel on the server using its loopback address to create the administrator.</p><Button variant="secondary" onClick={reload}>Check again</Button></SetupFrame>;
    return <SetupWizard status={status} session={session} onSaved={reload} onFinished={() => { reload(); navigate("/admin/nodes", { replace: true }); }} />;
  }
  if (status.auth_enabled && !session.authenticated) return <Login session={session} onAuthenticated={() => { reload(); }} />;
  const controls = status.auth_enabled && session.authenticated ? <SessionControls session={session} onSignedOut={reload} /> : null;
  if (status.auth_enabled && status.https_pending && session.authenticated) return <><PendingHTTPS session={session} restartRequired={status.restart_required} onVerified={() => { reload(); navigate("/admin/nodes", { replace: true }); }} />{controls}</>;
  if (explicitSetup) {
    if (status.needs_setup && status.setup_allowed) return <SetupWizard status={status} session={session} onSaved={reload} onFinished={() => { reload(); navigate("/admin/nodes", { replace: true }); }} />;
    return <><SetupFrame title={status.restart_required ? "Restart required" : "Panel configured"}><p className="muted">{status.restart_required ? "Restart the panel service, then check HTTPS before opening public access." : "Administrator and panel address are configured."}</p><div className="actions"><Link className="button" to="/admin/nodes">Open panel</Link><Button variant="secondary" onClick={reload}>Check again</Button></div></SetupFrame>{controls}</>;
  }
  // Only the server's explicit development mode preserves the existing local
  // workflow. Production never falls through to the application anonymously.
  if (!session.authenticated && !development) return <Login session={session} onAuthenticated={reload} />;
  return <AccountSessionContext.Provider value={{canSignOut:session.authenticated&&(status.auth_enabled||import.meta.env.VITE_DESKTOP==='true'),signOut:async()=>{await api('/api/auth/logout',{method:'POST',headers:sessionHeaders(session)});reload();}}}>{children}{development && <Link className="setup-entry" to="/setup">Setup</Link>}</AccountSessionContext.Provider>;
}

function SessionControls({ session, onSignedOut }: { session: Session; onSignedOut: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="setup-session-controls">
    {error && <span role="alert">{error}</span>}
    {session.user?.root_admin && <Link to="/setup">Setup</Link>}
    <Button variant="secondary" disabled={busy} onClick={async () => {
      if (busy) return;
      setBusy(true); setError("");
      try { await api("/api/auth/logout", { method: "POST", headers: sessionHeaders(session) }); onSignedOut(); }
      catch (failure) { setError(errorText(failure)); }
      finally { setBusy(false); }
    }}>{busy ? "Signing out..." : "Sign out"}</Button>
  </div>;
}

function PendingHTTPS({ session, restartRequired, onVerified }: { session: Session; restartRequired: boolean; onVerified: () => void }) {
  const [result, setResult] = useState<HTTPSVerification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  return <SetupFrame title="HTTPS pending">
    <p className="muted">Point your domain to this server and allow port 443. Public HTTPS stays pending until the panel verifies its certificate and address.</p>
    {(result?.restart_required ?? restartRequired) && <p className="muted">The panel reports a restart is required. Restart its service, then check again.</p>}
    {result && <SetupChecks validation={result} />}
    <ErrorBox>{error}</ErrorBox>
    <div className="actions"><Button disabled={busy} onClick={async () => {
      if (active.current) return;
      const controller = new AbortController(); active.current = controller;
      const timeout = setTimeout(() => controller.abort(), 30000);
      setBusy(true); setError(""); setResult(null);
      try {
        const value = await api<HTTPSVerification>("/api/setup/https", { method: "POST", signal: controller.signal, headers: sessionHeaders(session) });
        setResult(value);
        if (value.valid === true && value.completed === true && value.https_pending === false && value.checks.length > 0 && value.checks.every((check) => check.status === "ok")) onVerified();
      } catch (failure) { setError(controller.signal.aborted ? "The HTTPS check took too long. Check DNS and port 443, then retry." : errorText(failure)); }
      finally { clearTimeout(timeout); active.current = null; setBusy(false); }
    }}>{busy ? "Checking HTTPS..." : "Check again"}</Button></div>
  </SetupFrame>;
}

function SetupChecks({ validation }: { validation: Validation }) {
  return <ul className="setup-checks" aria-label="Setup checks">{validation.checks.map((check, index) => <li key={`${check.name}-${index}`} className={`setup-check-${check.status}`}><div><strong>{check.name}</strong><span>{check.status === "ok" ? "Passed" : check.status === "pending" ? "Pending" : "Needs attention"}</span></div><p>{check.detail}</p></li>)}</ul>;
}

function Login({ session, onAuthenticated }: { session: Session; onAuthenticated: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setBusy(true); setError("");
    try {
      const result = await api<Session>("/api/auth/login", { method: "POST", signal: controller.signal, headers: sessionHeaders(session), body: JSON.stringify({ username: username.trim(), password }) });
      if (!result.authenticated) throw new Error("Sign-in was not completed. Try again.");
      setPassword(""); onAuthenticated();
    } catch (failure) { setError(controller.signal.aborted ? "Sign-in took too long. Check the panel service and retry." : errorText(failure)); }
    finally { clearTimeout(timeout); active.current = null; setBusy(false); }
  }
  return <SetupFrame title="Sign in"><form onSubmit={submit}>
    <Field label="Username"><input required name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} disabled={busy} autoFocus /></Field>
    <Field label="Password"><input required name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /></Field>
    <ErrorBox>{error}</ErrorBox><Button type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</Button>
  </form></SetupFrame>;
}

function SetupWizard({ status, session, onSaved, onFinished }: { status: SetupStatus; session: Session; onSaved: () => void; onFinished: () => void }) {
  const [step, setStep] = useState(0);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accessMode, setAccessMode] = useState(status.access_mode || "local");
  const [publicURL, setPublicURL] = useState(status.public_url || window.location.origin);
  const [tlsMode, setTLSMode] = useState(status.tls_mode || "proxy");
  const [acmeEmail, setAcmeEmail] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => { setValidation(null); setError(""); }, [accessMode, publicURL, tlsMode, acmeEmail, acceptTerms]);
  const settings = { public_url: publicURL.trim(), access_mode: accessMode, tls_mode: accessMode === "local" ? "proxy" : tlsMode, ...(accessMode === "public" && tlsMode === "automatic" ? { acme_email: acmeEmail.trim() || email.trim(), accept_acme_terms: acceptTerms } : {}) };
  async function run<T>(name: string, path: string, body: unknown) {
    if (active.current) return null;
    const controller = new AbortController();
    active.current = controller; setBusy(name); setError("");
    const timeout = setTimeout(() => controller.abort(), 30000);
    try { return await api<T>(path, { method: "POST", signal: controller.signal, headers: sessionHeaders(session), body: JSON.stringify(body) }); }
    catch (failure) { setError(controller.signal.aborted ? "The check took too long. Check the panel service and retry." : errorText(failure)); return null; }
    finally { clearTimeout(timeout); active.current = null; setBusy(""); }
  }
  async function validate() {
    setValidation(null);
    const result = await run<Validation>("check", "/api/setup/validate", settings);
    if (result) setValidation(result);
  }
  const checksOK = validation?.valid === true && validation.checks.length > 0 && validation.checks.every((check) => check.status === "ok");
  const canStage = accessMode === "public" && tlsMode === "automatic" && validation?.can_save === true && validation.checks.length > 0 && validation.checks.every((check) => check.status === "ok" || check.status === "pending");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (step < 2) { setStep(step + 1); return; }
    if (step === 2 && accessMode === "public") { setStep(3); return; }
    if (step < 4) { setStep(4); await validate(); return; }
    if (!checksOK && !canStage) return;
    const result = await run<Completion>("save", "/api/setup/complete", { ...settings, username: username.trim(), email: email.trim(), password });
    if (!result) return;
    if (result.completed || result.restart_required) {
      setPassword("");
      if (result.restart_required || result.https_pending || !checksOK) { setCompletion(result); onSaved(); }
      else onFinished();
    } else setError("Setup is not complete. Check the results and retry.");
  }
  if (completion) return <PendingHTTPS session={session} restartRequired={completion.restart_required} onVerified={onFinished} />;
  const titles = ["Create administrator", "Set a password", "Panel address", "HTTPS", "Check setup"];
  return <SetupFrame title="Set up your panel"><p className="setup-progress muted">{step < 2 ? "Administrator" : step < 4 ? "Address" : "Checks"}</p><h2 ref={heading} tabIndex={-1}>{titles[step]}</h2><form onSubmit={submit}>
    <fieldset disabled={!!busy} className="setup-fields">
      {step === 0 && <>
        <Field label="Username"><input required name="username" minLength={2} maxLength={64} pattern="[a-zA-Z0-9_.\-]+" title="Use letters, numbers, underscores, dots, or hyphens." autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} autoFocus /></Field>
        <Field label="Email"><input required name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
      </>}
      {step === 1 && <Field label="Password" hint="At least 12 characters."><input required name="password" type="password" minLength={12} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus /></Field>}
      {step === 2 && <>
        <div className="setup-choices" role="group" aria-label="Panel access"><Button variant="secondary" aria-pressed={accessMode === "local"} onClick={() => setAccessMode("local")}>Local</Button><Button variant="secondary" aria-pressed={accessMode === "public"} onClick={() => setAccessMode("public")}>Public</Button></div>
        <Field label={accessMode === "local" ? "Local panel URL" : "Public panel URL"} hint={accessMode === "local" ? "Use the address you open on this machine." : "Use your panel's HTTPS domain."}><input required name="public_url" type="url" autoComplete="url" value={publicURL} onChange={(event) => setPublicURL(event.target.value)} /></Field>
      </>}
      {step === 3 && <>
        <Field label="HTTPS mode"><Select name="tls_mode" value={tlsMode} onChange={(event) => setTLSMode(event.target.value as "proxy" | "automatic")}><option value="proxy">Existing reverse proxy</option><option value="automatic">Automatic certificates</option></Select></Field>
        {tlsMode === "automatic" ? <><Field label="Certificate email" hint="Point the domain to this server and allow port 443. Certificates need a successful HTTPS check."><input required type="email" name="acme_email" autoComplete="email" value={acmeEmail || email} onChange={(event) => setAcmeEmail(event.target.value)} /></Field><label className="setup-terms"><input required type="checkbox" checked={acceptTerms} onChange={(event) => setAcceptTerms(event.target.checked)} /><span>I accept the <a href="https://letsencrypt.org/repository/" target="_blank" rel="noreferrer">certificate authority terms</a>.</span></label></> : <p className="muted">Your reverse proxy must already serve this panel over HTTPS.</p>}
      </>}
      {step === 4 && <>
        <p className="setup-address">{publicURL}</p>
        {busy === "check" && <p role="status" className="muted">Checking panel reachability and HTTPS...</p>}
        {validation && <SetupChecks validation={validation} />}
        {validation?.restart_required && <p role="status" className="muted">A panel service restart is required to apply HTTPS.</p>}
        {canStage && !checksOK && <p className="muted">Save to request certificates. HTTPS remains pending until the backend verifies it.</p>}
      </>}
    </fieldset>
    <ErrorBox>{error}</ErrorBox>
    <div className="setup-actions">
      {step > 0 && <Button variant="secondary" disabled={!!busy} onClick={() => { setStep(step === 4 && accessMode === "local" ? 2 : step - 1); setError(""); }}>Back</Button>}
      {step === 4 && <Button variant="secondary" disabled={!!busy} onClick={validate}>{busy === "check" ? "Checking..." : "Check again"}</Button>}
      <Button type="submit" disabled={!!busy || (step === 4 && !checksOK && !canStage)}>{busy === "save" ? "Saving..." : step < 4 ? "Continue" : checksOK ? "Finish setup" : "Save pending setup"}</Button>
    </div>
    {status.dev_mode && <Link className="setup-cancel" to="/">Back to panel</Link>}
  </form></SetupFrame>;
}
