export type GamePort = {port: number; preferred_port: number; role: string; reason?: string};
export type GameForwardRoute = {internal_port: number; public_port?: number; public_host?: string; protocol?: string; status: string; detail: string};
export type GamePortPlan = {ip: string; ports: GamePort[]; detail: string; forwarding?: {status: string; detail: string; routes?: GameForwardRoute[]}};
export type CurrentProxyRoute = {local_port: number; public_port: number; public_host: string; protocol: string; status: string};

export function refreshInstallationForwarding(plan: GamePortPlan, current: CurrentProxyRoute[]): GamePortPlan {
  const routes: GameForwardRoute[] = current.filter(route => plan.ports.some(port => port.port === route.local_port)).map(route => ({internal_port:route.local_port,public_port:route.public_port,public_host:route.public_host,protocol:route.protocol,status:route.status==='applied'?'mapped':'pending',detail:route.status==='applied'?'FRP mapping registered. External gameplay has not been verified.':'Proxy mapping is waiting or needs attention in Integrations.'}));
  const old = plan.forwarding?.routes ?? [];
  const manual = old.filter(route => route.status === 'manual');
  if (!routes.length && !old.some(route => route.protocol)) return plan;
  const status = !routes.length ? 'manual' : routes.some(route => route.status !== 'mapped') ? 'pending' : manual.length ? 'partial' : 'mapped';
  return {...plan,forwarding:{status,detail:status==='mapped'?'FRP mappings registered. External gameplay has not been verified.':status==='manual'?'No current proxy mapping. Configure forwarding in Integrations.':'Some proxy mappings need attention in Integrations.',routes:[...routes,...manual]}};
}

export function gamePortAddress(ip: string, port: number): string {
  return ip === '0.0.0.0' || ip === '::' ? String(port) : `${ip.includes(':') ? `[${ip}]` : ip}:${port}`;
}

export function gamePortLabel(role: string): string {
  return role === 'game' ? 'Game' : role === 'auxiliary' ? 'Additional' : role.replaceAll('_', ' ');
}

export function gameNodeAvailable(node: {setup_available?: boolean; automatic_ports?: boolean; free_allocations?: number}): boolean {
  return node.setup_available !== false && (node.automatic_ports === true || node.free_allocations === undefined || node.free_allocations > 0);
}

export function gamePortSummary(plan: GamePortPlan): string {
  if (plan.forwarding?.status === 'mapped') return 'Game ports assigned. Proxy forwarding is configured.';
  if (plan.forwarding?.status === 'pending') return 'Game ports assigned. Proxy connection needs attention in Integrations.';
  if (plan.forwarding?.status === 'manual' || plan.forwarding?.status === 'partial') return 'Game ports assigned. Internet access needs connection setup.';
  if (plan.detail.includes('Node bind checks unavailable')) return 'Ports are assigned automatically. This node needs an update to check availability.';
  return 'Ports are assigned automatically. Busy ports are replaced with available ones.';
}
