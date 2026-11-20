import {Feedback} from '../../notifications';
import {serverStatusKey, serverStatusVocabulary} from '../../serverStatus';
import {confirmAction} from '../../ui/ConfirmAction';
import {ButtonFeedback} from '../../ui/ButtonFeedback';
import ServerStorageSummary from './ServerStorageSummary';
import ServerInsights from './ServerInsights';
import {useTransientMessage} from '../../hooks/useTransientMessage';
import {formatUptime} from './uptime';
import {formatBytesGB} from '../../resourceUnits';
import {requestServerPower} from './serverPower';
import type {PowerSignal} from '../console/consoleLifecycle';
import {
  advancePowerOperation,
  beginPowerOperation,
  powerOperationLabel,
  powerOperationDetail,
  type PowerOperation,
} from './powerOperation';
import {useArtworkLibrary} from './ArtworkProvider';
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type ReactNode,
} from 'react';
import {useLocation} from 'react-router-dom';
import {api, Button} from '../../lib';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from '../../components/ui/card';
import {Item, ItemMedia, ItemContent, ItemDescription} from '../../components/ui/item';
import {Icon, type IconName} from '../../Icons';
import {bytes, resourceUsageGB, resourceLimitGB, can, items, PageError, useServer, value} from '../shared/common';
import './serverHeader.css';
import './powerProgress.css';
import {ServerConnection} from './ServerConnection';
import './shadcn-cards.css';
import './dashboard-ui.css';
import {fallbackArtwork, getServerBannerArtwork, type ServerArtwork} from './serverArtwork';
import {ServerIdentityIcon} from './ServerIdentityIcon';
import {FavoriteButton} from '../../ServerNavigation';
import {powerActions} from './serverPowerActions';
import {dashboardSections, isNarrowDashboard, subscribeNarrowDashboard} from './dashboardLayout';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../components/ui/dropdown-menu';
import {visiblePoll} from '../../hooks/visiblePoll';
import {observeLivePath, isLivePathFresh, liveSampleError} from '../../hooks/liveEvents';
import type {Resource, Server, ServerResources, ServerStats} from '../../types/api';

type Sample = {at: number; cpu: number; memory: number; rx: number; tx: number; uptime: number};
type Telemetry = {
  state: string;
  services?: {portal: string; game: string};
  resources: Record<string, any>;
  samples: Sample[];
  updated: number;
  error: string;
  refresh: () => void;
};
const TelemetryContext = createContext<Telemetry>({
  state: 'unknown',
  resources: {},
  samples: [],
  updated: 0,
  error: '',
  refresh: () => {},
});
export const useServerTelemetry = () => useContext(TelemetryContext);

export function ServerOperationNotice() {
  const {server} = useServer();
  const telemetry = useServerTelemetry();
  const pathname = useLocation().pathname;
  if (!server.status) return null;
  if (server.status === 'reinstall_failed') {
    // A failed attempt remains recorded, but does not describe a recovered runtime.
    if (telemetry.state === 'running' && !telemetry.error && !pathname.endsWith('/runtime')) return null;
    return (
      <>
        <Feedback
          tone="error"
          message={
            <>
              {'The last reinstall attempt failed.  '}
              {telemetry.state === 'running' && !telemetry.error ? 'The existing installation is running. ' : ''} Review
              the installation output before retrying Reinstall server under Server settings &gt; General.
            </>
          }
        />
      </>
    );
  }
  if (!server.status.includes('failed')) return null;
  return (
    <Feedback
      title={server.name}
      eventKey={`server-state:${server.uuid}`}
      tone={server.status.includes('failed') ? 'error' : 'info'}
      message={`Server state: ${server.status.replaceAll('_', ' ')}. ${server.status === 'installing' ? 'Installation output is available in the console.' : ''}`}
    />
  );
}

const number = (v: unknown) => Math.max(0, Number.isFinite(Number(v)) ? Number(v) : 0);
const emptyTelemetry = (): Omit<Telemetry, 'refresh'> => ({
  state: 'unknown',
  resources: {},
  samples: [],
  updated: 0,
  error: '',
});

export function useTelemetry(base: string, enabled: boolean): Telemetry {
  const [data, setData] = useState<{base: string; value: Omit<Telemetry, 'refresh'>}>(() => ({
    base,
    value: emptyTelemetry(),
  }));
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setData({base, value: emptyTelemetry()});
      return;
    }
    let active = true;
    let liveVersion = 0;
    const path = `${base}/resources`;
    const consume = (payload: Resource<ServerStats>) => {
      const response = value(payload);
      const r: Partial<ServerResources> = response.resources || {},
        at = Date.now();
      const sample = {
        at,
        cpu: number(r.cpu_absolute),
        memory: number(r.memory_bytes),
        rx: number(r.network_rx_bytes),
        tx: number(r.network_tx_bytes),
        uptime: number(r.uptime),
      };
      setData(old => ({
        base,
        value: {
          state: response.is_suspended ? 'suspended' : response.current_state || 'unknown',
          services: response.fs25_services,
          resources: r,
          samples: [...(old.base === base ? old.value.samples : []), sample].slice(-60),
          updated: at,
          error: '',
        },
      }));
    };
    const unsubscribe = observeLivePath<Resource<ServerStats>>(path, sample => {
      if (!active || document.hidden) return;
      liveVersion++;
      if (sample.status === 200) consume(sample.data);
      else
        setData({
          base,
          value: {...emptyTelemetry(), error: liveSampleError(sample.data) || 'Live resources unavailable.'},
        });
    });
    let forceRead = version > 0;
    const stop = visiblePoll(async signal => {
      if (!forceRead && isLivePathFresh(path)) return;
      forceRead = false;
      const generation = liveVersion;
      try {
        const response = await api<Resource<ServerStats>>(path, {signal});
        if (!active || signal.aborted || generation !== liveVersion) return;
        consume(response);
      } catch (error) {
        if (active && !signal.aborted && generation === liveVersion)
          setData(old => ({
            base,
            value: {
              ...(old.base === base ? old.value : emptyTelemetry()),
              error: error instanceof Error ? error.message : String(error),
            },
          }));
        throw error;
      }
    });
    return () => {
      active = false;
      stop();
      unsubscribe?.();
    };
  }, [base, enabled, version]);
  return {...(enabled && data.base === base ? data.value : emptyTelemetry()), refresh: () => setVersion(v => v + 1)};
}

const PowerContext = createContext<{
  pending: PowerOperation | null;
  busy: boolean;
  error: string;
  success: string;
  completedSignal: PowerSignal | null;
  power: (signal: PowerSignal) => Promise<void>;
  dismissError: () => void;
}>({
  pending: null,
  busy: false,
  error: '',
  success: '',
  completedSignal: null,
  power: async () => {},
  dismissError: () => {},
});

function usePowerOperation(base: string, telemetry: Telemetry) {
  const [pending, setPending] = useState<PowerOperation | null>(null),
    [error, setError] = useState('');
  const [success, setSuccess] = useTransientMessage(2000);
  const [completedSignal, setCompletedSignal] = useState<PowerSignal | null>(null);
  const requestInFlight = useRef<PowerOperation | null>(null),
    operationRef = useRef<PowerOperation | null>(null),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  function update(operation: PowerOperation | null) {
    operationRef.current = operation;
    setPending(operation);
  }
  useEffect(() => {
    update(null);
    setError('');
    setSuccess('');
    requestInFlight.current = null;
  }, [base]);
  useEffect(() => {
    const operation = operationRef.current;
    if (!operation || telemetry.error) return;
    const result = advancePowerOperation(
      operation,
      telemetry.state,
      number(telemetry.resources.uptime),
      telemetry.updated
    );
    if (result.operation !== operation) update(result.operation);
    if (result.outcome === 'success') {
      setCompletedSignal(operation.signal);
      setSuccess(result.message!);
    }
    if (result.outcome === 'error') setError(result.message!);
  }, [telemetry.state, telemetry.updated, telemetry.error, pending?.accepted]);
  async function power(signal: PowerSignal) {
    if (requestInFlight.current || (operationRef.current && signal !== 'kill')) return;
    if (
      signal === 'kill' &&
      !(await confirmAction({
        title: 'Force stop?',
        description: 'Force stop this server immediately? Unsaved progress may be lost.',
        confirmLabel: 'Force stop',
        danger: true,
      }))
    )
      return;
    setError('');
    setSuccess('');
    const operation = beginPowerOperation(signal, telemetry.updated, number(telemetry.resources.uptime));
    requestInFlight.current = operation;
    update(operation);
    try {
      await requestServerPower(base, signal);
      if (active.current && operationRef.current === operation) {
        update({...operation, accepted: true});
        telemetry.refresh();
      }
    } catch (error) {
      if (active.current && operationRef.current === operation) {
        update(null);
        setError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (requestInFlight.current === operation) requestInFlight.current = null;
    }
  }
  return {
    pending,
    busy: !!pending && !pending.accepted,
    error,
    success,
    completedSignal,
    power,
    dismissError: () => setError(''),
  };
}

function usePowerElapsed(pending: PowerOperation | null) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (!pending) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pending?.requestedAt]);
  return pending ? Math.max(0, Math.floor((clock - pending.requestedAt) / 1000)) : 0;
}

function PowerControls({compact = false}: {compact?: boolean}) {
  const {server, permissions} = useServer();
  const telemetry = useContext(TelemetryContext),
    action = useContext(PowerContext),
    pending = action.pending;
  const elapsed = usePowerElapsed(compact ? null : pending);
  const actions = powerActions({
    state: telemetry.state,
    pending,
    serverStatus: server.status,
    installing: !!server.is_installing,
    maintenance: !!server.is_node_under_maintenance,
    connected: !!telemetry.updated && !telemetry.error,
    can: permission => can(permissions, permission),
  });
  const group = useRef<HTMLDivElement>(null),
    hadFocus = useRef(false);
  const shown = actions.primary.map(b => b.signal).join() + (actions.forceStop ? ',menu' : '');
  // State changes replace buttons (Start becomes Restart and Stop). Keep keyboard
  // focus in the group instead of dropping it to the page.
  useLayoutEffect(() => {
    if (hadFocus.current && !group.current?.contains(document.activeElement))
      group.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }, [shown]);
  const tracking = {
    onFocus: () => {
      hadFocus.current = true;
    },
    onBlur: (event: FocusEvent<HTMLDivElement>) => {
      // Focus moved elsewhere, or the user clicked away while the button is still on the page.
      // A button that was removed is no longer connected; that case is restored above.
      const moved = event.relatedTarget
        ? !event.currentTarget.contains(event.relatedTarget as Node)
        : event.target.isConnected;
      if (moved) hadFocus.current = false;
    },
  };
  return (
    <div className="server-power">
      <div ref={group} className="actions" role="group" aria-label="Server controls" {...tracking}>
        {actions.primary.map(({signal, label, busy, disabled}) => {
          const feedback = busy ? 'pending' : action.success && action.completedSignal === signal ? 'success' : 'idle';
          const title =
            actions.reason ||
            (busy ? (pending ? powerOperationLabel(pending) : `${label} in progress`) : `${label} server`);
          return (
            <Button
              key={signal}
              className="server-power-button"
              data-power={signal}
              data-feedback={feedback}
              variant="secondary"
              aria-label={compact || busy ? (busy ? title : `${label} server`) : undefined}
              title={title}
              aria-busy={busy}
              aria-disabled={disabled || undefined}
              disabled={disabled && !busy}
              onClick={() => {
                if (!disabled) void action.power(signal);
              }}
            >
              <ButtonFeedback state={feedback}>
                <Icon name={icon[signal]} />
              </ButtonFeedback>
              {!compact && label}
            </Button>
          );
        })}
        {actions.forceStop && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="secondary"
                  className="server-power-more"
                  aria-label="More server controls"
                  title="More server controls"
                />
              }
            >
              <Icon name="more" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="server-power-menu">
              <DropdownMenuItem
                variant="destructive"
                disabled={actions.forceStop.disabled}
                onClick={() => void action.power('kill')}
              >
                <Icon name="close" />
                Force stop
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <span className="button-feedback-sr" role="status">
        {pending ? powerOperationLabel(pending) : action.success}
      </span>
      {!compact &&
        ((pending && (elapsed >= 30 || telemetry.error)) || (!pending && telemetry.error && !server.status)) && (
          <Button
            variant="secondary"
            title={pending ? powerOperationDetail(pending, elapsed, !!telemetry.error) : 'Read the server state again'}
            onClick={telemetry.refresh}
          >
            Check status
          </Button>
        )}
      {action.error && (
        <>
          <Feedback
            tone="error"
            message={
              <>
                <span>{action.error}</span>
              </>
            }
          />
        </>
      )}
    </div>
  );
}
const icon: Record<PowerSignal, IconName> = {start: 'play', restart: 'restart', stop: 'stop', kill: 'close'};

function ServerUptime() {
  const {server} = useServer(),
    telemetry = useServerTelemetry();
  const state = server.status && server.status !== 'reinstall_failed' ? server.status : telemetry.state;
  const online = state === 'running' && !telemetry.error;
  const elapsed = online ? number(telemetry.resources.uptime) : 0;
  return (
    <span className={`server-uptime${online && elapsed > 0 ? ' is-online' : ''}`}>
      <span className="server-meta-label">Uptime:</span>{' '}
      <strong>{telemetry.error ? '\u2014' : formatUptime(elapsed)}</strong>
    </span>
  );
}

export function ServerStateLine({compact = false, showUptime = compact}: {compact?: boolean; showUptime?: boolean}) {
  const {server} = useServer(),
    telemetry = useServerTelemetry();
  const action = useContext(PowerContext);
  const pending = compact ? action.pending : null;
  const operationElapsed = usePowerElapsed(pending);
  const operationError = '';
  const state = server.status && server.status !== 'reinstall_failed' ? server.status : telemetry.state;
  const stateText =
    telemetry.error && !server.status ? 'Connection unavailable' : serverStatusVocabulary[serverStatusKey(state)].label;
  const statusText = operationError ? 'Action failed' : stateText;
  const statusDetail =
    operationError || (pending ? powerOperationDetail(pending, operationElapsed, !!telemetry.error) : stateText);
  const statusState = operationError
    ? 'install_failed'
    : telemetry.error && !server.status
      ? 'unknown'
      : pending
        ? 'starting'
        : state;
  const fs25 = Array.isArray(server.egg_features) && server.egg_features.includes('voltra_fs25');
  const services = telemetry.error ? undefined : telemetry.services;
  const serviceLabels: Record<string, string> = {
    online: 'Online',
    offline: 'Offline',
    starting: 'Starting',
    stopping: 'Stopping',
    unknown: 'Unknown',
  };
  return (
    <div className="server-state-line">
      <span
        className={`server-state state-${statusState}`}
        title={statusDetail}
        role={compact ? 'status' : undefined}
        aria-live={compact ? 'polite' : undefined}
      >
        <span className="server-meta-label">Status:</span>
        <span className="status-dot" />
        <span className="server-state-text">{statusText}</span>
      </span>
      {fs25 &&
        (['game'] as const).map(key => {
          const service = services?.[key] || 'unknown';
          return (
            <span
              key={key}
              className={`server-state state-${service === 'online' ? 'running' : service}`}
              title={
                service === 'unknown'
                  ? 'No recent service check. The monitoring helper may need updating.'
                  : 'Game lifecycle log confirmed against the running process. Public reachability is checked separately.'
              }
            >
              <span className="server-meta-label">Game server:</span>
              <span className="status-dot" />
              <span>{serviceLabels[service] || 'Unknown'}</span>
            </span>
          );
        })}
      {showUptime && <ServerUptime />}
    </div>
  );
}

function DashboardArtwork({art}: {art: ServerArtwork}) {
  const [failed, setFailed] = useState(false);
  return (
    <img
      className="server-hero-artwork"
      src={failed ? fallbackArtwork.src : art.src}
      alt=""
      aria-hidden="true"
      decoding="async"
      draggable={false}
      onError={failed ? undefined : () => setFailed(true)}
    />
  );
}

// The favourite star belongs to the server name, not to the power controls.
function ServerTitle() {
  const {server} = useServer();
  return (
    <div className="server-identity-heading">
      <ServerIdentityIcon artwork={server.artwork} />
      <div>
        <div className="server-title-line">
          <h1>{server.name}</h1>
          <FavoriteButton id={server.uuid} name={server.name} variant="star" />
        </div>
        {server.artwork?.pack_name && <p className="server-pack-name">{server.artwork.pack_name}</p>}
      </div>
    </div>
  );
}

export function ServerWorkspace({children}: {children: ReactNode}) {
  const {server, base} = useServer();
  useArtworkLibrary();
  const art = getServerBannerArtwork({...server, name: server.name});
  const pathname = useLocation().pathname;
  const dashboardPage = /^\/server\/[^/]+\/?$/.test(pathname);
  const telemetry = useTelemetry(
    base,
    (!server.status || server.status === 'reinstall_failed') && !server.is_installing
  );
  const power = usePowerOperation(base, telemetry);
  const transition =
    power.pending?.signal ||
    (!telemetry.error
      ? telemetry.state === 'starting'
        ? 'start'
        : telemetry.state === 'stopping'
          ? 'stop'
          : undefined
      : undefined);
  return (
    <TelemetryContext.Provider value={telemetry}>
      <PowerContext.Provider value={power}>
        {!dashboardPage ? (
          <header className="server-topbar" data-power-transition={transition} data-power-paused={!!telemetry.error}>
            <div className="server-summary">
              <ServerTitle />
              <ServerStateLine compact />
            </div>
            <PowerControls compact />
          </header>
        ) : (
          <header>
            <Card
              className="server-hero server-hero-with-artwork shadcn-card"
              data-artwork={art.id}
              data-power-transition={transition}
              data-power-paused={!!telemetry.error}
            >
              <DashboardArtwork key={art.src} art={art} />
              <CardHeader className="server-hero-info">
                <div className="server-hero-title">
                  <CardTitle>
                    <ServerTitle />
                  </CardTitle>
                </div>
                {server.description && (
                  <CardDescription className="server-description">{server.description}</CardDescription>
                )}
                <div className="server-hero-meta">
                  <ServerStateLine showUptime />
                  <ServerConnection key={base} />
                </div>
              </CardHeader>
              <CardAction className="server-hero-controls">
                <PowerControls />
              </CardAction>
            </Card>
          </header>
        )}

        <PageError error={telemetry.error} />
        {children}
      </PowerContext.Provider>
    </TelemetryContext.Provider>
  );
}

type Series = {name: string; color: string; values: number[]};
function UsageChart({
  title,
  series,
  maximum,
  format,
  reading,
  limit,
  address,
}: {
  title: string;
  series: Series[];
  maximum: number;
  format: (n: number) => string;
  reading?: string;
  limit?: string;
  address?: string;
}) {
  const chartRef = useRef<HTMLDivElement>(null),
    [chartWidth, setChartWidth] = useState(480);
  useEffect(() => {
    const node = chartRef.current;
    if (!node) return;
    const measure = () => {
      const style = getComputedStyle(node);
      setChartWidth(Math.max(1, node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)));
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  const observed = series.flatMap(s => s.values);
  const scale = Math.max(maximum, ...observed, 1);
  const chartHeight = 128;
  const left = 3,
    right = chartWidth - 3,
    top = 8,
    bottom = chartHeight - 8;
  const hasSamples = observed.length > 0;
  const x = (index: number, length: number) => (length === 1 ? right : left + (index / (length - 1)) * (right - left));
  const y = (v: number) => bottom - (v / scale) * (bottom - top);
  return (
    <Card className="usage-chart dashboard-panel shadcn-card" role="region" aria-label={`${title} chart`}>
      <CardHeader className="dashboard-panel-heading">
        <CardTitle>
          <div className="chart-heading">
            <h2>{title}</h2>
            {address && (
              <span className="chart-address" aria-label={`Server address: ${address}`} title={address}>
                {address}
              </span>
            )}
            {reading !== undefined && (
              <p className="chart-reading">
                <strong>{reading}</strong>
                {limit && <span> / {limit}</span>}
              </p>
            )}
          </div>
        </CardTitle>
        <CardAction>
          {reading !== undefined ? null : series.length > 1 ? (
            <div className="chart-legend">
              {series.map(s => (
                <span key={s.name} style={{color: s.color}}>
                  <span />
                  {s.name}
                </span>
              ))}
            </div>
          ) : (
            <span className="chart-latest">{hasSamples ? format(series[0].values.at(-1) || 0) : 'Waiting'}</span>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="usage-chart-body">
        <div className="chart-scale" aria-hidden="true">
          {[1, 0.5, 0].map(f => (
            <span key={f}>{format(scale * f)}</span>
          ))}
        </div>
        <div className="usage-chart-plot" ref={chartRef}>
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${title}: ${hasSamples ? series.map(s => `${s.name} ${format(s.values.at(-1) || 0)}`).join(', ') : 'waiting for live samples'}`}
          >
            <title>{`${title}, live samples from this session`}</title>
            {[1, 0.5, 0].map(f => (
              <g key={f}>
                <line x1={left} x2={right} y1={y(scale * f)} y2={y(scale * f)} className="chart-grid" />
              </g>
            ))}
            {series.map(s => {
              if (!s.values.length) return null;
              const points = s.values.map((v, i) => `${x(i, s.values.length)},${y(v)}`).join(' ');
              return (
                <g key={s.name}>
                  {series.length === 1 && s.values.length > 1 && (
                    <polygon
                      points={`${left},${bottom} ${points} ${right},${bottom}`}
                      fill={s.color}
                      fillOpacity=".06"
                    />
                  )}
                  <polyline
                    points={points}
                    fill="none"
                    stroke={s.color}
                    strokeDasharray={series.length > 1 && s.name === 'Out' ? '5 3' : undefined}
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={x(s.values.length - 1, s.values.length)}
                    cy={y(s.values.at(-1) || 0)}
                    r="3"
                    fill={s.color}
                  />
                </g>
              );
            })}
          </svg>
        </div>
        {!hasSamples && <p className="chart-waiting">Collecting live samples…</p>}
      </CardContent>
      {reading === undefined && !address && (
        <CardFooter className="chart-footer">
          <Item size="xs" className="shadcn-compact-item">
            <ItemMedia variant="icon">
              <Icon name="activity" />
            </ItemMedia>
            <ItemContent>
              <ItemDescription>Samples from this session</ItemDescription>
            </ItemContent>
          </Item>
        </CardFooter>
      )}
    </Card>
  );
}

function serverAddress(server: Server) {
  const allocations = items(server.relationships?.allocations),
    allocation = allocations.find(a => a.is_default) || allocations[0];
  const host = allocation?.ip_alias || allocation?.alias || allocation?.ip;
  return host ? `${host.includes(':') ? `[${host}]` : host}:${allocation.port}` : 'Not assigned';
}

export function ServerResourcePanels({children}: {children?: ReactNode}) {
  const {server} = useServer();
  const {resources: r, samples, updated} = useServerTelemetry();
  const address = serverAddress(server);
  const limit = (key: 'memory' | 'disk') => resourceLimitGB(server.limits?.[key]);
  const network = samples.slice(1).map((sample, index) => {
    const previous = samples[index],
      elapsed = Math.max((sample.at - previous.at) / 1000, 0.001);
    // A restart resets Wings' byte counters. Never display that reset as traffic.
    const reset = sample.uptime < previous.uptime;
    return {
      rx: reset ? 0 : Math.max(0, sample.rx - previous.rx) / elapsed,
      tx: reset ? 0 : Math.max(0, sample.tx - previous.tx) / elapsed,
    };
  });
  return (
    <>
      <div className="dashboard-charts dashboard-resource-charts">
        <UsageChart
          title="CPU"
          reading={updated ? `${number(r.cpu_absolute).toFixed(2)}%` : '\u2014'}
          limit={server.limits?.cpu ? `${server.limits.cpu}%` : '\u221e'}
          series={[{name: 'CPU', color: 'var(--accent)', values: samples.map(s => s.cpu)}]}
          maximum={number(server.limits?.cpu) || 1}
          format={n => `${n < 1 ? n.toFixed(2) : n.toFixed(0)}%`}
        />
        <UsageChart
          title="Memory"
          reading={updated ? resourceUsageGB(r.memory_bytes) : '\u2014'}
          limit={limit('memory')}
          series={[{name: 'Memory', color: 'var(--theme-accent-b,var(--accent))', values: samples.map(s => s.memory)}]}
          maximum={number(server.limits?.memory) * 1024 ** 2}
          format={formatBytesGB}
        />
        <UsageChart
          title="Network"
          address={address}
          series={[
            {name: 'In', color: 'var(--accent)', values: network.map(s => s.rx)},
            {name: 'Out', color: 'var(--theme-accent-b,var(--muted))', values: network.map(s => s.tx)},
          ]}
          maximum={1}
          format={n => `${bytes(n)}/s`}
        />
        <ServerStorageSummary compact />
      </div>
      {children}
    </>
  );
}

export default function ServerDashboard({children}: {children?: ReactNode}) {
  const {permissions} = useServer();
  const narrow = useSyncExternalStore(subscribeNarrowDashboard, isNarrowDashboard, () => false);
  // Keyed sections move without remounting, so the console keeps its socket and scrollback.
  const sections = {
    insights: <ServerInsights key="insights" />,
    resources: <ServerResourcePanels key="resources" />,
    console: <Fragment key="console">{can(permissions, 'control.console') && children}</Fragment>,
  };
  return (
    <div className="server-dashboard" data-layout={narrow ? 'console-first' : undefined}>
      {dashboardSections(narrow).map(name => sections[name])}
    </div>
  );
}
