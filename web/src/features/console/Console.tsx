import {observeLivePath, isLivePathFresh} from '../../hooks/liveEvents';
import {useEffect, useRef, useState} from 'react';
import {api, Button, Input, Select, Field, Modal} from '../../lib';
import {useServerTelemetry} from '../servers/ServerDashboard';
import Terminal from './Terminal';
import {consoleOutput} from './consoleOutput';
import {consoleClock, consoleStateLine} from './consoleLifecycle';
import {requestServerPower, consolePowerEvent, type ConsolePowerEvent} from '../servers/serverPower';
import {appendConsoleHistory, emptyConsoleHistory} from './consoleHistory';
import {ConsoleLineQueue, CONSOLE_QUEUE_FRAME_MS} from './consoleQueue';
import {ConsoleReplayOverlap} from './consoleReplay';
import {consoleRunChanged, consoleRunID} from './consoleRun';
import {acquireServerSocket, type WingsConnection} from '../servers/serverSocket';
import './console.css';
import {can, json, Notice, PageError, useAction, useServer} from '../shared/common';
import type {ConsoleHistoryPage} from '../../types/api';
import type {StartupResponse} from '../server-settings/startupSettingsModel';

const featureErrors: Record<string, string[]> = {
  eula: ['you need to agree to the eula in order to run the server'],
  java_version: [
    'minecraft 1.17 requires running the server with java 16 or above',
    'minecraft 1.18 requires running the server with java 17 or above',
    'java.lang.unsupportedclassversionerror',
    'unsupported major.minor version',
    'has been compiled by a more recent version of the java runtime',
  ],
  gsl_token: ['(gsl token expired)', '(account not found)'],
  pid_limit: [
    'pthread_create failed',
    'failed to create thread',
    'unable to create thread',
    'unable to create native thread',
    'unable to create new native thread',
    'exception in thread "craft async scheduler management thread"',
  ],
  steam_disk_space: ['steamcmd needs 250mb of free disk space to update', '0x202 after update job'],
};
export default function Console() {
  const {base, server, permissions} = useServer();
  const a = useAction();
  const featureAction = useAction();
  const telemetry = useServerTelemetry();
  const installing = useRef(false);
  installing.current = !!server.is_installing || server.status === 'installing';
  const [history, setHistory] = useState(emptyConsoleHistory),
    [status, setStatus] = useState('unknown'),
    [connection, setConnection] = useState('Connecting'),
    [socketError, setSocketError] = useState(''),
    [historyError, setHistoryError] = useState(''),
    [feature, setFeature] = useState(''),
    [oauth, setOAuth] = useState(''),
    [token, setToken] = useState(''),
    [image, setImage] = useState(''),
    [images, setImages] = useState<Record<string, string>>({});
  useEffect(() => {
    if (telemetry.state !== 'unknown') setStatus(telemetry.state);
  }, [telemetry.state]);
  const socket = useRef<WebSocket | null>(null),
    pendingLines = useRef(new ConsoleLineQueue()),
    statusRef = useRef(status),
    features = useRef<string[]>([]);
  statusRef.current = status;
  features.current = (server.egg_features || []).map((s: string) => s.toLowerCase());
  useEffect(() => {
    pendingLines.current.clear();
    setHistory(emptyConsoleHistory());
    let active = true;
    // The page's shared Wings socket; transfer tracking listens on it too.
    const held = acquireServerSocket(base),
      wings = held.socket;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const scheduleDrain = () => {
      if (!active || drainTimer !== undefined || !pendingLines.current.size) return;
      drainTimer = setTimeout(drain, document.hidden || reducedMotion.matches ? 0 : CONSOLE_QUEUE_FRAME_MS);
    };
    const drain = () => {
      drainTimer = undefined;
      if (!active) return;
      const incoming = pendingLines.current.take(performance.now(), document.hidden || reducedMotion.matches);
      if (incoming.length) setHistory(old => (active ? appendConsoleHistory(old, incoming) : old));
      scheduleDrain();
    };
    const queueLines = (...lines: string[]) => {
      pendingLines.current.enqueue(lines);
      scheduleDrain();
    };
    const visibilityChanged = () => {
      clearTimeout(drainTimer);
      drainTimer = undefined;
      scheduleDrain();
      clearTimeout(replayTimer);
      if (!document.hidden) void replay();
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    let observedState = 'unknown';
    let historyMode: 'loading' | 'persistent' | 'live' | 'legacy' = 'loading';
    let replayTimer: ReturnType<typeof setTimeout>;
    const replayAbort = new AbortController();
    const overlap = new ConsoleReplayOverlap();
    const savedOverlap = new ConsoleReplayOverlap();
    let cursor = '0',
      socketReady = false,
      replayedSaved = false,
      requestedLiveLogs = false;
    let runStart: string | undefined,
      replaceRun = false;
    const showingLive = () => historyMode === 'live' || historyMode === 'legacy';
    const requestLiveLogs = () => {
      if (!installing.current && socketReady && historyMode === 'legacy' && !requestedLiveLogs) {
        wings.requestLogs('display');
        requestedLiveLogs = true;
      }
    };
    // Modern fallback keeps polling from the last successful saved cursor.
    // Only legacy servers request the unnumbered Wings log snapshot.
    const startLiveFallback = () => {
      historyMode = 'live';
      requestLiveLogs();
    };
    const historyPath = `${base}/console-history`;
    let replayPending = false;
    const consumeSaved = (saved: ConsoleHistoryPage) => {
      if (consoleRunChanged(runStart, saved.run_start)) {
        runStart = consoleRunID(saved.run_start)!;
        cursor = '0';
        replayedSaved = false;
        replaceRun = true;
        pendingLines.current.clear();
        overlap.clear();
        savedOverlap.clear();
        return false; // Reload the retained previous tail and new run together.
      }
      const nextRun = consoleRunID(saved.run_start);
      if (nextRun !== null) runStart = nextRun;
      if (replaceRun) {
        setHistory(emptyConsoleHistory());
        replaceRun = false;
      }
      historyMode = saved.capture?.connected ? 'persistent' : 'live';
      if (historyMode === 'persistent') {
        savedOverlap.clear();
        // The console no longer shows socket output: an operation-report replay
        // the transfer dock asked for while it loaded can be sent now.
        wings.outputChanged();
      }
      if (saved.reset) {
        overlap.clear();
        savedOverlap.clear();
        pendingLines.current.clear();
        setHistory(emptyConsoleHistory());
      }
      if (saved.truncated)
        queueLines(
          '\x1b[0m\x1b[93m[Voltra]: Older output expired from the saved buffer while this console was disconnected.\x1b[0m'
        );
      const restored: string[] = [];
      for (const entry of saved.data ?? []) {
        const text = consoleOutput(String(entry.line ?? ''), entry.event, true);
        if (!text) continue;
        const at = new Date(entry.created_at);
        const stamp =
          (entry.event === 'panel message' || entry.event === 'steam output') && !Number.isNaN(at.getTime())
            ? `[${consoleClock(at)}] `
            : '';
        for (const line of text.split(/\r?\n/)) {
          if (overlap.consume(entry.event, line)) continue;
          if (historyMode === 'live') savedOverlap.record(entry.event, line);
          if (!replayedSaved) restored.push(stamp + line);
          else queueLines(stamp + line);
        }
      }
      if (restored.length) setHistory(old => (active ? appendConsoleHistory(old, restored) : old));
      replayedSaved = true;
      cursor = saved.cursor;
      setHistoryError('');
      return true;
    };
    const replay = async (recover = false) => {
      if (!active || replayPending) return;
      clearTimeout(replayTimer);
      if (document.hidden && replayedSaved) return;
      if (!recover && replayedSaved && isLivePathFresh(historyPath)) {
        replayTimer = setTimeout(replay, 1000);
        return;
      }
      replayPending = true;
      let delay = 1000;
      try {
        const saved = await api<ConsoleHistoryPage>(`${historyPath}?after=${cursor}`, {signal: replayAbort.signal});
        if (!active) return;
        if (!consumeSaved(saved) || saved.more) delay = 10;
      } catch (error) {
        if (!active || replayAbort.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        if (historyMode === 'loading' && message.trim() === '404 page not found') {
          historyMode = 'legacy';
          requestLiveLogs();
          return;
        }
        if (historyMode !== 'legacy') startLiveFallback();
        setHistoryError('Saved history is unavailable. Showing live output and retrying.');
        delay = 3000;
      } finally {
        replayPending = false;
      }
      if (active) replayTimer = setTimeout(() => replay(delay === 10), delay);
    };
    const stopHistory = observeLivePath<ConsoleHistoryPage | null>(historyPath, sample => {
      if (!active || sample.status !== 200 || !sample.data || replayPending || !replayedSaved) return;
      const saved = sample.data;
      // Sequence IDs are global, not contiguous per server. The batch's starting
      // cursor detects missed frames without mistaking another server's IDs for gaps.
      if (
        saved.reset ||
        BigInt(saved.after ?? '0') > BigInt(cursor) ||
        BigInt(saved.head ?? saved.cursor) < BigInt(cursor)
      ) {
        void replay(true);
        return;
      }
      if (BigInt(saved.cursor) < BigInt(cursor)) return;
      if (!consumeSaved({...saved, data: (saved.data ?? []).filter(entry => BigInt(entry.id) > BigInt(cursor))}))
        void replay(true);
    });
    void replay();
    const observeState = (next: string) => {
      const line = consoleStateLine(observedState, next);
      if (line) {
        if (historyMode === 'legacy') queueLines(line);
        observedState = next;
      }
      statusRef.current = next;
      setStatus(next);
    };
    const powerMessage = (event: Event) => {
      const detail = (event as CustomEvent<ConsolePowerEvent>).detail;
      if (detail?.base === base && historyMode === 'legacy') queueLines(detail.line);
    };
    window.addEventListener(consolePowerEvent, powerMessage);
    const append = (s: string, event: string) => {
      const clean = consoleOutput(s, event);
      if (!clean) return;
      const colored = consoleOutput(s, event, true);
      if (showingLive())
        for (const line of colored.split(/\r?\n/)) {
          if (historyMode !== 'legacy' && savedOverlap.consume(event, line)) continue;
          if (historyMode !== 'legacy') overlap.record(event, line);
          queueLines(line);
        }
      if (statusRef.current === 'running') return;
      const f = features.current.find(f => featureErrors[f]?.some(e => clean.toLowerCase().includes(e)));
      if (f) setFeature(f);
      if (features.current.includes('hytale_oauth')) {
        const link = clean.match(
          /https:\/\/oauth\.accounts\.hytale\.com\/oauth2\/device\/verify\?user_code=[A-Za-z0-9_-]+/i
        )?.[0];
        if (link) {
          setOAuth(link);
          setFeature('hytale_oauth');
        }
      }
    };
    const connectionLabels: Record<WingsConnection, string> = {
      connecting: 'Connecting',
      reconnecting: 'Reconnecting',
      connected: 'Connected',
      disconnected: 'Disconnected',
    };
    const stopSocket = wings.subscribe({
      // Live output is shown in these modes, so a replay must be the console's own request.
      get showsOutput() {
        return historyMode !== 'persistent';
      },
      state: (next, error) => {
        if (!active) return;
        setConnection(connectionLabels[next]);
        setSocketError(error);
      },
      ready: () => {
        socketReady = true;
        requestLiveLogs();
        if (!installing.current) wings.send('send stats');
      },
      closed: () => {
        socketReady = false;
        requestedLiveLogs = false;
      },
      message: message => {
        if (!active) return;
        const args = message.args;
        try {
          switch (message.event) {
            case 'console output':
            case 'install output':
            case 'daemon message':
              append(String(args[0] || ''), message.event);
              break;
            case 'status':
              observeState(String(args[0]));
              break;
            case 'stats': {
              const v = typeof args[0] === 'string' ? JSON.parse(args[0]) : args[0];
              if (v?.state) observeState(String(v.state));
              break;
            }
          }
        } catch {
          setSocketError('Received an invalid daemon event.');
        }
      },
    });
    return () => {
      active = false;
      clearTimeout(drainTimer);
      document.removeEventListener('visibilitychange', visibilityChanged);
      window.removeEventListener(consolePowerEvent, powerMessage);
      pendingLines.current.clear();
      clearTimeout(replayTimer);
      replayAbort.abort();
      stopHistory?.();
      stopSocket();
      held.release();
      socket.current = null;
    };
  }, [base]);
  useEffect(() => {
    if (feature === 'java_version')
      api<StartupResponse>(`${base}/startup`)
        .then(r => {
          const d = r.meta?.docker_images || {};
          setImages(d);
          setImage((Object.values(d)[0] as string) || '');
        })
        .catch(e => featureAction.run(() => Promise.reject(e)));
  }, [feature, base]);
  const acceptFeature = () =>
    featureAction.run(
      async () => {
        if (feature === 'eula') {
          await api(`${base}/files/write?file=${encodeURIComponent('/eula.txt')}`, {
            method: 'POST',
            headers: {'Content-Type': 'text/plain'},
            body: 'eula=true',
          });
          if (status === 'offline') await requestServerPower(base, 'restart');
        }
        if (feature === 'java_version') {
          await api(`${base}/settings/docker-image`, json('PUT', {docker_image: image}));
          if (status === 'offline') await requestServerPower(base, 'restart');
        }
        if (feature === 'gsl_token') {
          await api(`${base}/startup/variable`, json('PUT', {key: 'STEAM_ACC', value: token}));
          await requestServerPower(base, 'restart');
        }
      },
      () => setFeature('')
    );
  return (
    <section className="console-view" aria-label="Server console">
      <Notice action={a} />
      <PageError error={socketError} />
      <PageError error={historyError} />
      <Terminal
        history={history}
        status={status}
        connection={connection}
        busy={a.busy}
        onClear={() => {
          pendingLines.current.clear();
          setHistory(emptyConsoleHistory());
        }}
        onSend={(command, done) => {
          void a.run(() => api(`${base}/command`, json('POST', {command})), done);
        }}
      />
      {feature && (
        <Modal
          title={
            {
              eula: 'Accept Minecraft EULA',
              java_version: 'Unsupported Java version',
              gsl_token: 'Invalid GSL token',
              pid_limit: 'Memory or process limit reached',
              steam_disk_space: 'Out of available disk space',
              hytale_oauth: 'Hytale authentication required',
            }[feature] || feature
          }
          onClose={() => setFeature('')}
        >
          <div className="console-feature-content">
            <Notice action={featureAction} />
            {feature === 'eula' && (
              <p>
                To run this server you must agree to the{' '}
                <a href="https://www.minecraft.net/eula" target="_blank" rel="noreferrer">
                  Minecraft EULA
                </a>
                . Accepting writes eula=true to eula.txt.
              </p>
            )}
            {feature === 'java_version' && (
              <>
                <p>The server requires a different Java runtime. Select an image provided by this egg.</p>
                {can(permissions, 'startup.docker-image') && (
                  <Field label="Docker image">
                    <Select value={image} onChange={e => setImage(e.target.value)}>
                      {Object.entries(images).map(([name, v]) => (
                        <option key={v} value={v}>
                          {name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </>
            )}
            {feature === 'gsl_token' && (
              <>
                <p>
                  Your Gameserver Login Token is invalid or expired.{' '}
                  <a target="_blank" rel="noreferrer" href="https://steamcommunity.com/dev/managegameservers">
                    Generate a Steam token
                  </a>
                  , or leave this empty to remove it.
                </p>
                <Field label="GSL token">
                  <Input value={token} onChange={e => setToken(e.target.value)} />
                </Field>
              </>
            )}
            {feature === 'pid_limit' && (
              <p>
                The server cannot create more threads. Check its memory allowance and container_pid_limit in Wings
                config.yml. Restart Wings after changing its process limit.
              </p>
            )}
            {feature === 'steam_disk_space' && (
              <p>
                The install or update cannot complete because the node has insufficient disk space. Check df -h on the
                node, remove unneeded files, or increase disk capacity.
              </p>
            )}
            {feature === 'hytale_oauth' && (
              <>
                <p>Authenticate your Hytale account to download or update the server files.</p>
                <a className="button" href={oauth} target="_blank" rel="noreferrer" onClick={() => setFeature('')}>
                  Authenticate with Hytale
                </a>
              </>
            )}
            <div className="actions">
              <Button variant="secondary" onClick={() => setFeature('')}>
                Close
              </Button>
              {feature === 'eula' && can(permissions, 'file.update') && (
                <Button disabled={featureAction.busy} onClick={acceptFeature}>
                  I accept
                </Button>
              )}
              {feature === 'java_version' && can(permissions, 'startup.docker-image') && (
                <Button disabled={featureAction.busy || !image} onClick={acceptFeature}>
                  Update Docker image
                </Button>
              )}
              {feature === 'gsl_token' && can(permissions, 'startup.update') && (
                <Button disabled={featureAction.busy} onClick={acceptFeature}>
                  Update GSL token
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
