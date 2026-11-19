// First-run setup and the HTTPS check that follows it. Loaded on demand: a
// configured panel never shows either screen.
import {Feedback} from './notifications';
import {Checkbox} from './components/ui/checkbox';
import {Input as MiraInput} from './components/ui/input';
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Select, api, Button, ErrorBox, Field } from "./lib";
import { SetupFrame, errorText, sessionHeaders, type Session, type SetupStatus } from "./setup";

type Validation = { valid: boolean; checks: { name: string; status: "ok" | "error" | "pending"; detail: string }[]; restart_required: boolean; can_save?: boolean };
type Completion = { completed: boolean; restart_required: boolean; next_url: string; https_pending?: boolean };
type HTTPSVerification = Validation & { completed: boolean; https_pending: boolean; next_url: string };

export function PendingHTTPS({ session, restartRequired, onVerified }: { session: Session; restartRequired: boolean; onVerified: () => void }) {
  const [result, setResult] = useState<HTTPSVerification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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

export function SetupWizard({ status, session, onSaved, onFinished }: { status: SetupStatus; session: Session; onSaved: () => void; onFinished: () => void }) {
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
  const [error, setError] = useState('');
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
        <Field label="Username"><MiraInput required name="username" minLength={2} maxLength={64} pattern="[a-zA-Z0-9_.\-]+" title="Use letters, numbers, underscores, dots, or hyphens." autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} autoFocus /></Field>
        <Field label="Email"><MiraInput required name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
      </>}
      {step === 1 && <Field label="Password" hint="At least 12 characters."><MiraInput required name="password" type="password" minLength={12} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus /></Field>}
      {step === 2 && <>
        <div className="setup-choices" role="group" aria-label="Panel access"><Button variant="secondary" aria-pressed={accessMode === "local"} onClick={() => setAccessMode("local")}>Local</Button><Button variant="secondary" aria-pressed={accessMode === "public"} onClick={() => setAccessMode("public")}>Public</Button></div>
        <Field label={accessMode === "local" ? "Local panel URL" : "Public panel URL"} hint={accessMode === "local" ? "Use the address you open on this machine." : "Use your panel's HTTPS domain."}><MiraInput required name="public_url" type="url" autoComplete="url" value={publicURL} onChange={(event) => setPublicURL(event.target.value)} /></Field>
      </>}
      {step === 3 && <>
        <Field label="HTTPS mode"><Select name="tls_mode" value={tlsMode} onChange={(event) => setTLSMode(event.target.value as "proxy" | "automatic")}><option value="proxy">Existing reverse proxy</option><option value="automatic">Automatic certificates</option></Select></Field>
        {tlsMode === "automatic" ? <><Field label="Certificate email" hint="Point the domain to this server and allow port 443. Certificates need a successful HTTPS check."><MiraInput required type="email" name="acme_email" autoComplete="email" value={acmeEmail || email} onChange={(event) => setAcmeEmail(event.target.value)} /></Field><label className="setup-terms"><Checkbox required checked={acceptTerms} onCheckedChange={setAcceptTerms} /><span>I accept the <a href="https://letsencrypt.org/repository/" target="_blank" rel="noreferrer">certificate authority terms</a>.</span></label></> : <p className="muted">Your reverse proxy must already serve this panel over HTTPS.</p>}
      </>}
      {step === 4 && <>
        <p className="setup-address">{publicURL}</p>
        {busy === "check" && <p role="status" className="muted">Checking panel reachability and HTTPS...</p>}
        {validation && <SetupChecks validation={validation} />}
        {validation?.restart_required && <><Feedback tone="warning" message={<>A panel service restart is required to apply HTTPS.</>}/></>}
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
