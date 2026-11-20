import {TerminalSpinner} from '../../ui/TerminalProgress';
import {Feedback} from '../../notifications';
import {Input as MiraInput} from '../../components/ui/input';
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {createPortal} from 'react-dom';
import {Link, useLocation, useNavigate} from 'react-router-dom';
import {api, Button, Card, ErrorBox, Field, Loading, queryCacheSessionIdentity} from '../../lib';
import {invalidateQueryCache} from '../../hooks/queryCache';
import './setup.css';
import BrandMark from '../../BrandMark';
import RouteRecovery from '../../RouteRecovery';
import {forgetSignedInAccount} from '../../signedOut';
import {onFocusRevalidate} from '../../hooks/focusRevalidation';
import {DesktopRecoveryActions} from '../desktop/desktop';

export type SetupStatus = {
  needs_setup: boolean;
  setup_allowed: boolean;
  auth_enabled: boolean;
  public_url: string;
  access_mode: 'local' | 'public';
  tls_mode: 'proxy' | 'automatic';
  restart_required: boolean;
  dev_mode: boolean;
  https_pending?: boolean;
};
export type {Session} from '../../types/api';
import type {Session} from '../../types/api';
async function logoutSession(session: Session) {
  const result = await api<{redirect_url?: string}>('/api/auth/logout', {
    method: 'POST',
    headers: sessionHeaders(session),
  });
  if (result.redirect_url === '/cdn-cgi/access/logout') {
    window.location.assign(result.redirect_url);
    return false;
  }
  return true;
}
export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
export const sessionHeaders = (session: Session) =>
  session.csrf_token ? {'X-CSRF-Token': session.csrf_token} : undefined;
export const AccountSessionContext = createContext({canSignOut: false, signOut: async () => {}});

// A configured panel never shows these two screens, so they load on demand.
const SetupWizard = lazy(() => import('./setupWizard').then(module => ({default: module.SetupWizard})));
const PendingHTTPS = lazy(() => import('./setupWizard').then(module => ({default: module.PendingHTTPS})));

export function SetupFrame({title, children}: {title: string; children: ReactNode}) {
  return (
    <main className="setup-screen">
      <Card className="setup-card">
        <div className="setup-brand">
          <BrandMark />
          <span>Voltra</span>
        </div>
        <h1>{title}</h1>
        {children}
      </Card>
    </main>
  );
}

// Root wraps the application in this gate inside BrowserRouter. Neither setup
// nor authentication stores credentials outside the mounted form.
export default function SetupGate({children}: {children: ReactNode}) {
  const location = useLocation();
  const navigate = useNavigate();
  const explicitSetup = location.pathname.replace(/\/+$/, '') === '/setup';
  const [state, setState] = useState<{status: SetupStatus; session: Session} | null>(null);
  const [error, setError] = useState('');
  const checking = useRef(false);
  const authEpoch = useRef(0);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  // Another tab signed in or out. The page stays mounted, so unsaved drafts
  // survive, but it is covered and inert until the session has been read
  // again: a different account remounts everything, the same one carries on.
  const [suspended, setSuspended] = useState(false);
  const suspendedRef = useRef(false);
  // Who the mounted page belongs to, to tell a confirmed session from a new one.
  const identityRef = useRef<string | undefined>(undefined);
  identityRef.current = state ? queryCacheSessionIdentity(state.session) : undefined;
  useEffect(() => {
    let disposed = false;
    const epoch = authEpoch.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    checking.current = true;
    setError('');
    void Promise.allSettled([
      api<SetupStatus>('/api/setup/status', {signal: controller.signal, cache: 'no-store'}),
      api<Session>('/api/auth/session', {signal: controller.signal, cache: 'no-store'}).then(session => {
        if (!disposed && epoch === authEpoch.current)
          setState(previous => (previous ? {...previous, session} : previous));
        return session;
      }),
    ])
      .then(([statusResult, sessionResult]) => {
        if (disposed) return;
        // Session identity must be applied even when the setup endpoint fails.
        setState(previous => {
          const status = statusResult.status === 'fulfilled' ? statusResult.value : previous?.status;
          const session =
            sessionResult.status === 'fulfilled' && epoch === authEpoch.current
              ? sessionResult.value
              : previous?.session;
          return status && session ? {status, session} : previous;
        });
        if (suspendedRef.current && sessionResult.status === 'fulfilled' && epoch === authEpoch.current) {
          suspendedRef.current = false;
          setSuspended(false);
          // Still the same account: paused work resumes and what is on screen is
          // fetched again with the current session. A different account has
          // purged the cache and remounts the app instead; nothing resumes.
          if (identityRef.current === queryCacheSessionIdentity(sessionResult.value)) {
            window.dispatchEvent(new Event('panel-session-confirmed'));
            invalidateQueryCache();
          }
        }
        const failure = [statusResult, sessionResult].find(result => result.status === 'rejected');
        if (failure?.status === 'rejected')
          setError(
            controller.signal.aborted
              ? 'The panel took too long to respond. Check the service, then retry.'
              : errorText(failure.reason)
          );
      })
      .finally(() => {
        clearTimeout(timeout);
        if (!disposed) checking.current = false;
      });
    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [revision, explicitSetup]);
  useEffect(() => {
    const rejected = () => {
      authEpoch.current++;
      setState(previous => (previous ? {...previous, session: {authenticated: false}} : null));
      if (!checking.current) reload();
    };
    const changed = () => {
      authEpoch.current++;
      setState(null);
      reload();
    };
    const elsewhere = () => {
      authEpoch.current++;
      suspendedRef.current = true;
      setSuspended(true);
      reload();
    };
    // Always checked on return; the shared handler only collapses repeated events.
    const stopFocus = onFocusRevalidate(() => false, reload);
    window.addEventListener('panel-auth-changed', changed);
    // Another tab signed in or out: the page waits for the session read.
    window.addEventListener('panel-session-elsewhere', elsewhere);
    window.addEventListener('desktop-session-rejected', rejected);
    const timer = setInterval(reload, 60000);
    return () => {
      stopFocus();
      window.removeEventListener('panel-auth-changed', changed);
      window.removeEventListener('panel-session-elsewhere', elsewhere);
      window.removeEventListener('desktop-session-rejected', rejected);
      clearInterval(timer);
    };
  }, [reload]);
  // A session that ended without a sign-out, such as one that expired, must
  // not leave the previous account's saved pages behind in this browser.
  const signedOut = !!state && !state.session.authenticated && !(state.status.dev_mode && !state.status.auth_enabled);
  useEffect(() => {
    if (signedOut) forgetSignedInAccount();
  }, [signedOut]);
  if (error && !state)
    return (
      <SetupFrame title="Panel unavailable">
        <ErrorBox>{error}</ErrorBox>
        <div className="actions">
          <Button onClick={reload}>Retry</Button>
          <DesktopRecoveryActions />
        </div>
      </SetupFrame>
    );
  if (!state)
    return (
      <SetupFrame title="Opening panel">
        <Loading />
      </SetupFrame>
    );
  const {status, session} = state;
  // A failed download of either screen shows the reload recovery, like any route.
  const onDemand = (screen: ReactNode) => (
    <RouteRecovery>
      <Suspense
        fallback={
          <SetupFrame title="Opening panel">
            <Loading />
          </SetupFrame>
        }
      >
        {screen}
      </Suspense>
    </RouteRecovery>
  );
  const development = status.dev_mode && !status.auth_enabled;
  if (status.needs_setup && (explicitSetup || !development)) {
    if (!status.setup_allowed)
      return (
        <SetupFrame title="Set up locally">
          <p className="muted">Open this panel on the server using its loopback address to create the administrator.</p>
          <Button variant="secondary" onClick={reload}>
            Check again
          </Button>
        </SetupFrame>
      );
    return onDemand(
      <SetupWizard
        status={status}
        session={session}
        onSaved={reload}
        onFinished={() => {
          reload();
          navigate('/admin/nodes', {replace: true});
        }}
      />
    );
  }
  if (status.auth_enabled && !session.authenticated)
    return (
      <Login
        session={session}
        onAuthenticated={() => {
          reload();
        }}
      />
    );
  const controls =
    status.auth_enabled && session.authenticated ? <SessionControls session={session} onSignedOut={reload} /> : null;
  if (status.auth_enabled && status.https_pending && session.authenticated)
    return (
      <>
        {onDemand(
          <PendingHTTPS
            session={session}
            restartRequired={status.restart_required}
            onVerified={() => {
              reload();
              navigate('/admin/nodes', {replace: true});
            }}
          />
        )}
        {controls}
      </>
    );
  if (explicitSetup) {
    if (status.needs_setup && status.setup_allowed)
      return onDemand(
        <SetupWizard
          status={status}
          session={session}
          onSaved={reload}
          onFinished={() => {
            reload();
            navigate('/admin/nodes', {replace: true});
          }}
        />
      );
    return (
      <>
        <SetupFrame title={status.restart_required ? 'Restart required' : 'Panel configured'}>
          <p className="muted">
            {status.restart_required
              ? 'Restart the panel service, then check HTTPS before opening public access.'
              : 'Administrator and panel address are configured.'}
          </p>
          <div className="actions">
            <Link className="button" to="/admin/nodes">
              Open panel
            </Link>
            <Button variant="secondary" onClick={reload}>
              Check again
            </Button>
          </div>
        </SetupFrame>
        {controls}
      </>
    );
  }
  // Only the server's explicit development mode preserves the existing local
  // workflow. Production never falls through to the application anonymously.
  if (!session.authenticated && !development) return <Login session={session} onAuthenticated={reload} />;
  return (
    <AccountSessionContext.Provider
      key={queryCacheSessionIdentity(session)}
      value={{
        canSignOut: session.authenticated && (status.auth_enabled || import.meta.env.VITE_DESKTOP === 'true'),
        signOut: async () => {
          if (await logoutSession(session)) reload();
        },
      }}
    >
      {children}
      {suspended && <SessionCheck error={error} onRetry={reload} />}
      {error && !suspended && (
        <>
          <Feedback tone="error" message={<>Session check unavailable. Your current page is still open. </>} />
          <Button onClick={reload}>Retry session check</Button>
        </>
      )}
      {development && (
        <Link className="setup-entry" to="/setup">
          Setup
        </Link>
      )}
    </AccountSessionContext.Provider>
  );
}

/**
 * Covers the page while the session is read again after another tab signed in
 * or out. Everything else in the document, dialogs included, is inert until it
 * is gone, so nothing can be submitted under a session nobody has checked.
 */
function SessionCheck({error, onRetry}: {error: string; onRetry: () => void}) {
  const overlay = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Focus moves into the cover and comes back to the same control afterwards.
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const made: Element[] = [];
    for (const element of Array.from(document.body.children))
      // The notification island stays usable: a failed check is reported there.
      if (element !== overlay.current && !element.matches('.notification-layer') && !element.hasAttribute('inert')) {
        element.setAttribute('inert', '');
        made.push(element);
      }
    overlay.current?.focus();
    return () => {
      made.forEach(element => element.removeAttribute('inert'));
      if (previous?.isConnected) previous.focus({preventScroll: true});
    };
  }, []);
  return createPortal(
    <div
      ref={overlay}
      className="session-check"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-check-title"
      tabIndex={-1}
    >
      <Card>
        <p id="session-check-title" role="status">
          <TerminalSpinner /> Checking who is signed in…
        </p>
        {error ? (
          <>
            <ErrorBox>{error}</ErrorBox>
            <Button onClick={onRetry}>Retry</Button>
          </>
        ) : (
          <Loading />
        )}
      </Card>
    </div>,
    document.body
  );
}

function SessionControls({session, onSignedOut}: {session: Session; onSignedOut: () => void}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="setup-session-controls">
      {error && <Feedback tone="error" message={<>{error}</>} />}
      {session.user?.root_admin && <Link to="/setup">Setup</Link>}
      <Button
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            if (await logoutSession(session)) onSignedOut();
          } catch (failure) {
            setError(errorText(failure));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <TerminalSpinner />}
        {busy ? 'Signing out...' : 'Sign out'}
      </Button>
    </div>
  );
}

function Login({session, onAuthenticated}: {session: Session; onAuthenticated: () => void}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setBusy(true);
    setError('');
    try {
      const result = await api<Session>('/api/auth/login', {
        method: 'POST',
        signal: controller.signal,
        headers: sessionHeaders(session),
        body: JSON.stringify({username: username.trim(), password}),
      });
      if (!result.authenticated) throw new Error('Sign-in was not completed. Try again.');
      setPassword('');
      onAuthenticated();
    } catch (failure) {
      setError(
        controller.signal.aborted ? 'Sign-in took too long. Check the panel service and retry.' : errorText(failure)
      );
    } finally {
      clearTimeout(timeout);
      active.current = null;
      setBusy(false);
    }
  }
  return (
    <SetupFrame title="Sign in">
      <form onSubmit={submit}>
        <Field label="Username">
          <MiraInput
            required
            name="username"
            autoComplete="username"
            value={username}
            onChange={event => setUsername(event.target.value)}
            disabled={busy}
            autoFocus
          />
        </Field>
        <Field label="Password">
          <MiraInput
            required
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            disabled={busy}
          />
        </Field>
        <ErrorBox>{error}</ErrorBox>
        <Button type="submit" disabled={busy}>
          {busy && <TerminalSpinner />}
          {busy ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>
    </SetupFrame>
  );
}
