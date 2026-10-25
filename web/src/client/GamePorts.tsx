import './games-ui.css';
import {useEffect, useState} from 'react';
import {api, Button, ErrorBox, unwrap} from '../lib';
import {gamePortAddress, gamePortLabel, gamePortSummary, type GamePortPlan} from './gamePortsModel';
import './gamePorts.css';

export function useGamePortPlan(path: string, node: string, environment: Record<string, string | boolean> = {}, enabled = true) {
  const payload = JSON.stringify({node_id: Number(node), environment});
  const key = enabled && node ? `${path}:${payload}` : '';
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{key: string; data: GamePortPlan | null; error: string; loading: boolean}>({key: '', data: null, error: '', loading: false});
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    setState({key, data: null, error: '', loading: true});
    const timer = setTimeout(() => {
      api(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: payload, signal: controller.signal})
        .then(result => {if (!controller.signal.aborted) setState({key, data: unwrap(result), error: '', loading: false});})
        .catch(error => {if (!controller.signal.aborted) setState({key, data: null, error: error instanceof Error ? error.message : String(error), loading: false});});
    }, 250);
    return () => {clearTimeout(timer); controller.abort();};
  }, [key, path, payload, attempt]);
  return {...(key && state.key === key ? state : {data: null, error: '', loading: !!key}), reload: () => setAttempt(value => value + 1)};
}

export function GamePorts({plan, loading = false, error = '', retry}: {plan?: GamePortPlan | null; loading?: boolean; error?: string; retry?: () => void}) {
  return <section className="game-ports games-ui" aria-label="Automatic ports" aria-busy={loading}>
    <div className="game-ports-heading"><strong>Ports</strong><span>Automatic</span></div>
    {loading && <p role="status">Finding available game ports...</p>}
    {!loading && !plan && !error && <p className="muted">The game’s preferred ports are assigned during installation. If occupied, Voltra tries the next available ports.</p>}
    {plan && <><dl>{plan.ports.map(port => <div key={`${port.role}:${port.port}`}><dt>{gamePortLabel(port.role)}</dt><dd><code>{gamePortAddress(plan.ip, port.port)}</code>{port.preferred_port !== port.port && <span className="muted"> instead of {port.preferred_port}</span>}</dd></div>)}</dl>
      <p className="muted">{gamePortSummary(plan)}</p>
      {plan.forwarding?.routes?.filter(route=>route.status==='mapped'&&route.public_host&&route.public_port).map((route,index)=><p key={index}><code>{gamePortAddress(route.public_host!,route.public_port!)}</code> {route.protocol?.toUpperCase()}</p>)}
      <details className="game-ports-details"><summary>Connection details</summary><p>{plan.detail}</p>{plan.ports.filter(port=>port.reason).map(port=><p key={port.port}>{port.reason}</p>)}{plan.forwarding?.detail&&<p>{plan.forwarding.detail}</p>}{plan.forwarding?.routes?.map((route,index)=><p key={index}>{route.detail}</p>)}</details>
    </>}

    <ErrorBox>{error}</ErrorBox>{error && retry && <Button variant="secondary" onClick={retry}>Retry ports</Button>}
  </section>;
}

const noticeKey = (identifier: string) => `voltra:installation-ports:${identifier}`;
export function rememberInstallationPorts(identifier: string, plan?: GamePortPlan) {
  if (!plan) return;
  try {sessionStorage.setItem(noticeKey(identifier), JSON.stringify(plan));} catch { /* Storage may be disabled. The setup preview still explains ports. */ }
}
export function InstallationPortsNotice({identifier}: {identifier: string}) {
  const [plan, setPlan] = useState<GamePortPlan | null>(() => {
    try {const stored = sessionStorage.getItem(noticeKey(identifier)); return stored ? JSON.parse(stored) : null;} catch {return null;}
  });
  if (!plan) return null;
  return <div className="installation-ports-notice"><GamePorts plan={plan}/><Button variant="secondary" onClick={() => {try {sessionStorage.removeItem(noticeKey(identifier));} catch {} setPlan(null);}}>Dismiss port details</Button></div>;
}
