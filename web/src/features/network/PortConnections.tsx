import {Feedback} from '../../notifications';
import {SkeletonLine} from '../../ui/CollectionSkeleton';
import {useEffect, useState, type ComponentProps} from 'react';
import {FlaskConical, Plus, RefreshCw} from 'lucide-react';
import {api, Button, Input, Modal, useAPI} from '../../lib';
import {Badge} from '../../components/ui/badge';
import {Button as MiraButton} from '../../components/ui/button';
import {SettingsSection} from '../../ui/Settings';
import {CopyButton} from '../../ui/CopyButton';
import {confirmAction} from '../../ui/ConfirmAction';
import {can, items, PageError, useServer, value} from '../shared/common';
import {connectionAddress as address} from './connectionAddress';
import {portConnectionActions, groupPortRoutes, playerAddress, type PlayerAddress} from './portConnectionActions';
import {
  emptyNetworkSandbox,
  networkSandboxAllowed,
  networkSandboxView,
  updateNetworkSandbox,
} from '../../dev/networkSandbox';
import './serverProxy.css';
import type {
  Account,
  ProxyRoute,
  Resource,
  ResourceList,
  ServerAllocation,
  ServerProxySetup,
  ServerSubdomain,
} from '../../types/api';

type Row = Record<string, any>;
const routeStatus = (r: Row) =>
  r.desired_present === false
    ? 'Removing'
    : r.status === 'simulated'
      ? 'Test only'
      : r.status === 'applied'
        ? 'Configured'
        : r.status === 'error'
          ? 'Error'
          : 'Pending';
const domainStatus = (domain: {dns_status?: string; dns_matches?: boolean; cleanup_pending?: boolean}) =>
  domain.cleanup_pending
    ? 'Removing'
    : domain.dns_status === 'simulated'
      ? 'Test only'
      : domain.dns_status === 'error'
        ? 'DNS error'
        : domain.dns_matches
          ? 'DNS matches'
          : 'DNS pending';
const statusTone = (status: string) =>
  status === 'Configured' || status === 'DNS matches'
    ? 'ok'
    : status === 'Error' || status === 'DNS error'
      ? 'error'
      : status === 'Pending' || status === 'DNS pending' || status === 'Removing'
        ? 'warn'
        : 'neutral';
// The words carry the state; the dot only repeats it in colour.
function PortStatus({status, title}: {status: string; title?: string}) {
  return (
    <span className="port-status" data-status={status} data-tone={statusTone(status)} title={title}>
      <span className="port-status-dot" aria-hidden="true" />
      {status}
    </span>
  );
}
function shareHealth(share: PlayerAddress) {
  if (share.simulated) return {status: 'Test only', detail: 'Simulated on this computer. Nothing is published.'};
  if (share.source === 'subdomain') return {status: 'DNS matches', detail: 'Share this address with players.'};
  if (share.source === 'public')
    return {status: 'Configured', detail: 'Share this address with players. Game reachability is not verified.'};
  return {status: 'Local only', detail: 'Not reachable from the internet.'};
}
// Quiet page actions. `tone` picks the outline, ghost or destructive ghost look.
function PortAction({
  tone = 'ghost',
  className = '',
  ...props
}: ComponentProps<typeof MiraButton> & {tone?: 'ghost' | 'outline' | 'danger'}) {
  return (
    <MiraButton
      type="button"
      variant={tone === 'outline' ? 'outline' : 'ghost'}
      data-tone={tone}
      className={`port-action ${className}`}
      {...props}
    />
  );
}
function PortsSkeleton() {
  return (
    <div className="port-skeleton server-skeleton" role="status" aria-label="Loading ports" aria-busy="true">
      <span className="button-feedback-sr">Loading ports</span>
      <div className="port-share" aria-hidden="true">
        <SkeletonLine width={96} small />
        <SkeletonLine width={260} />
        <SkeletonLine width={180} small />
      </div>
      {[220, 190].map(width => (
        <div className="port-item" key={width} aria-hidden="true">
          <SkeletonLine width={width} />
        </div>
      ))}
    </div>
  );
}

export default function PortConnections() {
  const {base, server, permissions, reload} = useServer();
  const allocations = useAPI<ResourceList<ServerAllocation>>(`${base}/network/allocations`),
    account = useAPI<Resource<Account>>('/api/client/account');
  const admin = value(account.data)?.root_admin === true,
    writable = can(permissions, 'allocation.update');
  const path = `/api/admin/servers/${encodeURIComponent(server.uuid || server.identifier)}/proxy`;
  const setup = useAPI<Resource<ServerProxySetup>>(admin ? path : null),
    publicRoutes = useAPI<ResourceList<ProxyRoute>>(!account.loading && !admin ? `${base}/proxy-routes` : null),
    domain = useAPI<Resource<ServerSubdomain>>(`${base}/subdomain`);
  const realSetup = value(setup.data),
    realDomain: Partial<ServerSubdomain> = value(domain.data) || {};
  const ports = items(allocations.data);
  const [testRequested, setTestRequested] = useState(true),
    [testState, setTestState] = useState(emptyNetworkSandbox);
  const testAvailable = networkSandboxAllowed(
    import.meta.env.DEV,
    window.location.hostname,
    admin,
    ports,
    setup.error ? undefined : realSetup
  );
  const testing = testAvailable && testRequested;
  const testView = networkSandboxView(testState, ports);
  const setupData = testing ? testView.setup : realSetup,
    domainData = testing ? testView.domain : realDomain;
  const routes = (admin ? setupData?.routes || [] : items(publicRoutes.data)).filter(
    (r: Row) => !(r.desired_present === false && r.status === 'applied')
  );
  const [editor, setEditor] = useState<{kind: 'forward' | 'domain'; port: Row} | null>(null);
  const [clientID, setClientID] = useState(''),
    [protocols, setProtocols] = useState<string[]>([]),
    [publicPort, setPublicPort] = useState('');
  const [label, setLabel] = useState(''),
    [domainRouteID, setDomainRouteID] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const portRoutes = (port: Row) =>
    routes.filter(
      r =>
        String(r.allocation_id) === String(port.id) ||
        (!r.allocation_id && Number(r.local_port) === Number(port.port) && r.local_ip === port.ip)
    );
  function simulate(action: Parameters<typeof updateNetworkSandbox>[1]) {
    setTestState(updateNetworkSandbox(testState, action, ports));
  }
  function refresh() {
    allocations.reload();
    setup.reload();
    publicRoutes.reload();
    domain.reload();
    reload();
  }
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail === base) {
        allocations.reload();
        setup.reload();
        publicRoutes.reload();
        domain.reload();
      }
    };
    window.addEventListener('server-proxy-changed', changed);
    return () => window.removeEventListener('server-proxy-changed', changed);
  }, [base, allocations.reload, setup.reload, publicRoutes.reload, domain.reload]);
  async function run(action: () => Promise<void>, close = false) {
    setBusy(true);
    setError('');
    try {
      await action();
      if (close) setEditor(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (!testing) {
        refresh();
        window.dispatchEvent(new CustomEvent('server-proxy-changed', {detail: base}));
      }
    }
  }
  async function apply(route: Row) {
    if (testing) return;
    const result = items(
      await api<ResourceList<ProxyRoute>>(`/api/admin/proxy-gateways/${route.gateway_id}/routes/${route.id}/apply`, {
        method: 'POST',
      })
    );
    if (!result.length) throw new Error('The gateway did not confirm the change. Refresh and retry.');
    const failed = result.find(r => r.status !== 'applied');
    if (failed) throw new Error(failed.last_error || 'The gateway could not apply the change. Retry forwarding.');
  }
  function openForward(port: Row) {
    const {clients} = portConnectionActions(port, setupData, domainData, admin, writable);
    setClientID(clients.length === 1 ? String(clients[0].id) : '');
    setProtocols((port.protocols || []).filter((p: string) => p === 'tcp' || p === 'udp'));
    setPublicPort('');
    setError('');
    setEditor({kind: 'forward', port});
  }
  function openDomain(port: Row) {
    setLabel(domainData.label || '');
    setDomainRouteID(String(domainData.route?.id || domainData.choices?.[0]?.id || ''));
    setError('');
    setEditor({kind: 'domain', port});
  }
  const capabilities = editor ? portConnectionActions(editor.port, setupData, domainData, admin, writable) : null;
  const selectedClient = capabilities?.clients.find((c: Row) => String(c.id) === clientID);
  const selectedDomainRoute = capabilities?.domainChoices.find((c: Row) => String(c.id) === domainRouteID);
  const validLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label);
  async function connect() {
    if (busy || setup.error || setup.loading || !editor || !selectedClient || !protocols.length) return;
    if (
      !(await confirmAction({
        title: 'Forward port?',
        description: testing
          ? `Test ${protocols.map(p => p.toUpperCase()).join(' & ')} forwarding for ${address(editor.port.ip, editor.port.port)} locally? No public route will be created.`
          : `Forward ${address(editor.port.ip, editor.port.port)} through ${selectedClient.name} using ${protocols.map(p => p.toUpperCase()).join(' & ')}?`,
        confirmLabel: 'Forward port',
      }))
    )
      return;
    if (testing) {
      await run(
        async () =>
          simulate({
            type: 'forward',
            allocationID: editor.port.id,
            protocols,
            publicPort: publicPort ? Number(publicPort) : 0,
          }),
        true
      );
      return;
    }
    await run(async () => {
      for (const protocol of protocols) {
        const route = value(
          await api<Resource<ProxyRoute>>(path, {
            method: 'POST',
            body: JSON.stringify({
              allocation_id: editor.port.id,
              client_id: selectedClient.id,
              protocol,
              public_port: publicPort ? Number(publicPort) : 0,
            }),
          })
        );
        await apply(route);
      }
    }, true);
  }
  async function removeRoute(route: Row) {
    if (
      !(await confirmAction({
        title: 'Stop forwarding?',
        description: `Disconnect ${address(route.public_host, route.public_port)} using ${route.protocol.toUpperCase()}?`,
        confirmLabel: 'Stop forwarding',
        danger: true,
      }))
    )
      return;
    const members = (route.members || [route]).filter((r: Row) => r.desired_present !== false);
    await run(async () => {
      if (testing) {
        setTestState(
          members.reduce(
            (state: typeof testState, r: Row) => updateNetworkSandbox(state, {type: 'remove-route', id: r.id}, ports),
            testState
          )
        );
        return;
      }
      for (const member of members) {
        await api(`/api/admin/proxy-gateways/${member.gateway_id}/routes/${member.id}`, {method: 'DELETE'});
        await apply(member);
      }
    });
  }

  async function saveDomain() {
    if (busy || domain.error || domain.loading || !selectedDomainRoute || !validLabel) return;
    await run(async () => {
      if (testing) {
        simulate({type: 'subdomain', label, routeID: selectedDomainRoute.id});
        return;
      }
      await api(`${base}/subdomain`, {method: 'PUT', body: JSON.stringify({label, route_id: selectedDomainRoute.id})});
    }, true);
  }
  async function removeDomain() {
    if (
      !(await confirmAction({
        title: 'Remove subdomain?',
        description: `Remove ${domainData.hostname}?`,
        confirmLabel: 'Remove subdomain',
        danger: true,
      }))
    )
      return;
    await run(async () => {
      if (testing) {
        simulate({type: 'remove-domain'});
        return;
      }
      await api(`${base}/subdomain`, {method: 'DELETE'});
    }, true);
  }
  const primary = ports.find(port => port.is_default);
  const share = primary
    ? playerAddress(
        primary,
        portRoutes(primary),
        domain.error ? {} : domainData,
        server.game === 'minecraft' ? 'tcp' : realSetup?.primary_protocol
      )
    : null;
  const loadError = allocations.error || account.error || setup.error || publicRoutes.error || domain.error;
  const health = share && shareHealth(share);
  // A subdomain that exists but is not the shared address yet deserves a word of why.
  const domainHeld =
    share && share.source !== 'subdomain' && !domain.error && domainData.hostname
      ? domainData.cleanup_pending
        ? 'is being removed.'
        : domainData.dns_status === 'error'
          ? 'is not used until its DNS record is fixed.'
          : 'replaces this address once its DNS record matches.'
      : '';
  return (
    <section className="operations-page network-page settings-responsive" aria-label="Network">
      {testAvailable && (
        <div className="network-local-test" data-active={testing || undefined}>
          <span className="network-local-test-label">
            <FlaskConical size={14} aria-hidden="true" />
            {testing ? 'Local test mode. No public DNS or forwarding changes.' : 'Local network actions'}
          </span>
          <div className="network-local-test-actions">
            {testing && (
              <PortAction
                disabled={busy}
                onClick={() => {
                  setTestState(emptyNetworkSandbox());
                  setEditor(null);
                  setError('');
                }}
              >
                Reset test
              </PortAction>
            )}
            <PortAction
              disabled={busy}
              onClick={() => {
                setTestRequested(!testing);
                setEditor(null);
                setError('');
              }}
            >
              {testing ? 'Exit test mode' : 'Try actions locally'}
            </PortAction>
          </div>
        </div>
      )}
      <SettingsSection
        className="port-settings"
        title="Server ports"
        action={
          <div className="port-toolbar">
            <PortAction
              size="icon"
              aria-label="Refresh ports"
              title="Refresh ports"
              disabled={busy || allocations.loading}
              onClick={refresh}
            >
              <RefreshCw aria-hidden="true" />
            </PortAction>
            {!testing && can(permissions, 'allocation.create') && (
              <PortAction
                tone="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api(`${base}/network/allocations`, {method: 'POST'});
                  })
                }
              >
                <Plus aria-hidden="true" />
                Assign port
              </PortAction>
            )}
          </div>
        }
      >
        <PageError error={loadError} />
        {!editor && <PageError error={error} onDismiss={() => setError('')} />}
        {allocations.loading && !allocations.data && <PortsSkeleton />}
        {share && health && (
          <div className="port-share" data-source={share.source}>
            <span className="port-share-label">{share.label}</span>
            <div className="port-share-line">
              <code className="port-share-value">
                {share.value.replace(/:\d+$/, '')}
                <wbr />
                {share.value.match(/:\d+$/)?.[0]}
              </code>
              <CopyButton
                className="port-share-copy"
                aria-label={`Copy ${share.label.toLowerCase()} ${share.value}`}
                value={share.value}
              >
                Copy
              </CopyButton>
            </div>
            <p className="port-share-health">
              <PortStatus status={health.status} />
              <span>{health.detail}</span>
            </p>
            {domainHeld && (
              <p className="port-share-health">
                <PortStatus status={domainStatus(domainData)} />
                <span>
                  <code>{domainData.hostname}</code> {domainHeld}
                </span>
              </p>
            )}
          </div>
        )}
        {ports.length > 0 && (
          <ul className="port-list" aria-label="Assigned ports">
            {ports.map(port => {
              const capability = portConnectionActions(
                  port,
                  setup.error ? undefined : setupData,
                  domain.error ? undefined : domainData,
                  admin,
                  writable
                ),
                ownRoutes = portRoutes(port);
              const localAddress = address(port.ip, port.port);
              const domainAddress = port.is_default && domainData.hostname;
              const dnsError = domainData.dns_status === 'error';
              const protocol = (port.protocols || []).slice().sort().join(' & ').toUpperCase();
              const allocationLabel = port.is_default ? 'Primary port' : 'Additional port';
              const mapped = ownRoutes.length > 0 || !!domainAddress;
              return (
                <li key={port.id} className="port-item" aria-label={`${allocationLabel} ${localAddress}`}>
                  <div className="port-item-head">
                    <div className="port-item-identity">
                      <CopyButton
                        className="port-address"
                        value={localAddress}
                        aria-label={`Copy local address ${localAddress}`}
                      />
                      {port.is_default && (
                        <Badge variant="secondary" className="port-primary">
                          Primary
                        </Badge>
                      )}
                      {protocol && (
                        <span
                          className="port-protocol"
                          title={
                            port.protocol_source === 'forwarding' ? 'Configured forwarding protocol' : 'Game protocol'
                          }
                        >
                          {protocol}
                        </span>
                      )}
                      {!mapped && <PortStatus status="Not forwarded" title="Reachable on the local network only." />}
                    </div>
                    <div className="port-item-actions">
                      {admin && (capability.forward || ownRoutes.length > 0) && (
                        <PortAction disabled={busy} onClick={() => openForward(port)}>
                          {ownRoutes.length ? 'Edit forwarding' : 'Forward port'}
                        </PortAction>
                      )}
                      {capability.subdomain && (
                        <PortAction disabled={busy} onClick={() => openDomain(port)}>
                          {domainData.hostname ? 'Edit subdomain' : 'Add subdomain'}
                        </PortAction>
                      )}
                      {!testing && !port.is_default && can(permissions, 'allocation.delete') && (
                        <PortAction
                          tone="danger"
                          disabled={busy}
                          aria-label={`Unassign ${localAddress}`}
                          onClick={async () => {
                            if (
                              await confirmAction({
                                title: 'Unassign port?',
                                description: `Unassign ${address(port.ip, port.port)}?`,
                                confirmLabel: 'Unassign',
                                danger: true,
                              })
                            )
                              void run(async () => {
                                await api(`${base}/network/allocations/${port.id}`, {method: 'DELETE'});
                              });
                          }}
                        >
                          Unassign
                        </PortAction>
                      )}
                    </div>
                  </div>
                  {mapped && (
                    <ul className="port-mappings" aria-label={`Public addresses for ${localAddress}`}>
                      {groupPortRoutes(ownRoutes).map(route => {
                        const publicAddress = address(route.public_host, route.public_port);
                        return (
                          <li key={route.id} className="port-mapping">
                            <span className="port-mapping-kind">Public</span>
                            <CopyButton
                              className="port-address"
                              value={publicAddress}
                              aria-label={`Copy public address ${publicAddress}`}
                            />
                            <span className="port-protocol">{String(route.protocol).toUpperCase()}</span>
                            <PortStatus
                              status={routeStatus(route)}
                              title={
                                testing
                                  ? 'Local simulation.'
                                  : 'Gateway configuration status. Game reachability is unverified.'
                              }
                            />
                            {route.last_error && (
                              <Feedback tone="error" title="Port forwarding" message={<>{route.last_error}</>} />
                            )}
                          </li>
                        );
                      })}
                      {domainAddress && (
                        <li className="port-mapping">
                          <span className="port-mapping-kind">Subdomain</span>
                          <CopyButton
                            className="port-address"
                            value={
                              domainData.route?.public_port
                                ? address(domainAddress, domainData.route.public_port)
                                : domainAddress
                            }
                            aria-label={`Copy subdomain ${domainAddress}`}
                          />
                          <span className="port-protocol">{domainData.route?.protocol?.toUpperCase() || ''}</span>
                          <PortStatus status={domainStatus(domainData)} />
                          {writable && (dnsError || !capability.subdomain) && (
                            <div className="port-mapping-actions">
                              {dnsError && (
                                <PortAction
                                  disabled={busy}
                                  onClick={() =>
                                    void run(async () => {
                                      await api(`${base}/subdomain/retry`, {method: 'POST'});
                                    })
                                  }
                                >
                                  Retry DNS
                                </PortAction>
                              )}
                              {!capability.subdomain && (
                                <PortAction tone="danger" disabled={busy} onClick={() => void removeDomain()}>
                                  Remove subdomain
                                </PortAction>
                              )}
                            </div>
                          )}
                        </li>
                      )}
                    </ul>
                  )}
                  {port.is_default && domainData.cleanup_pending && (
                    <p className="port-item-note" role="status">
                      Subdomain removal pending.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!allocations.loading && !allocations.error && !ports.length && (
          <p className="port-empty">
            <strong>No ports assigned.</strong>
            {!testing && can(permissions, 'allocation.create')
              ? ' Assign a port to give this server an address.'
              : ' An administrator can assign one to this server.'}
          </p>
        )}
      </SettingsSection>
      {editor && (
        <Modal
          title={editor.kind === 'forward' ? 'Forward port' : 'Subdomain'}
          onClose={() => {
            if (!busy) setEditor(null);
          }}
        >
          <div className="port-action-editor">
            <p className="port-action-target">
              {editor.port.is_default ? 'Primary port' : 'Port'}{' '}
              <code>{address(editor.port.ip, editor.port.port)}</code>
            </p>
            <PageError error={error} onDismiss={() => setError('')} />
            {editor.kind === 'forward' ? (
              <>
                {portRoutes(editor.port).length > 0 && (
                  <ul className="port-forward-records" aria-label="Current forwarding">
                    {groupPortRoutes(portRoutes(editor.port)).map(route => (
                      <li key={route.id} className="port-forward-record">
                        <div>
                          <strong>{address(route.public_host, route.public_port)}</strong>
                          <span className="port-protocol">{String(route.protocol).toUpperCase()}</span>
                          <PortStatus status={routeStatus(route)} />
                          {route.last_error && (
                            <Feedback tone="error" title="Port forwarding" message={<>{route.last_error}</>} />
                          )}
                        </div>
                        <div className="server-proxy-actions">
                          {route.status !== 'applied' && route.status !== 'simulated' && (
                            <PortAction
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  for (const member of route.members || [route]) await apply(member);
                                })
                              }
                            >
                              Retry
                            </PortAction>
                          )}
                          {route.desired_present !== false && (
                            <PortAction tone="danger" disabled={busy} onClick={() => void removeRoute(route)}>
                              Stop forwarding
                            </PortAction>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {!!capabilities?.clients.length && (
                  <form
                    onSubmit={e => {
                      e.preventDefault();
                      void connect();
                    }}
                  >
                    <fieldset disabled={busy}>
                      <div className="port-action-field">
                        <span>Gateway</span>
                        <div className="port-action-options">
                          {capabilities.clients.map((c: Row) => (
                            <Button
                              key={c.id}
                              variant="secondary"
                              aria-pressed={clientID === String(c.id)}
                              onClick={() => {
                                setClientID(String(c.id));
                                setPublicPort('');
                              }}
                            >
                              {c.name}
                            </Button>
                          ))}
                        </div>
                      </div>
                      <div className="port-action-field">
                        <span>Protocol</span>
                        <div className="port-action-options">
                          {['udp', 'tcp'].map(p => (
                            <Button
                              key={p}
                              variant="secondary"
                              aria-pressed={protocols.includes(p)}
                              onClick={() =>
                                setProtocols(current =>
                                  current.includes(p) ? current.filter(v => v !== p) : [...current, p]
                                )
                              }
                            >
                              {p.toUpperCase()}
                            </Button>
                          ))}
                        </div>
                      </div>
                      <label className="port-action-field">
                        <span>Public port</span>
                        <Input
                          type="number"
                          aria-label="Public port"
                          min={selectedClient?.public_port_start ?? 1}
                          max={selectedClient?.public_port_end ?? 65535}
                          value={publicPort}
                          placeholder="Automatic"
                          onChange={e => setPublicPort(e.target.value)}
                        />
                        <small>Leave empty to pick a free port automatically.</small>
                      </label>
                      <div className="actions">
                        <Button
                          type="submit"
                          disabled={busy || !!setup.error || setup.loading || !selectedClient || !protocols.length}
                        >
                          {busy ? 'Applying...' : 'Forward port'}
                        </Button>
                      </div>
                    </fieldset>
                  </form>
                )}
              </>
            ) : (
              <form
                onSubmit={e => {
                  e.preventDefault();
                  void saveDomain();
                }}
              >
                <fieldset disabled={busy}>
                  <label className="port-action-field">
                    <span>Name</span>
                    <Input
                      aria-label="Subdomain name"
                      value={label}
                      maxLength={63}
                      required
                      pattern="[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?"
                      placeholder="my-server"
                      onChange={e => setLabel(e.target.value)}
                    />
                  </label>
                  {(capabilities?.domainChoices.length || 0) > 1 && (
                    <div className="port-action-options">
                      {capabilities?.domainChoices.map((c: Row) => (
                        <Button
                          key={c.id}
                          variant="secondary"
                          aria-pressed={domainRouteID === String(c.id)}
                          onClick={() => setDomainRouteID(String(c.id))}
                        >
                          {c.domain} / {String(c.protocol).toUpperCase()} :{c.public_port}
                        </Button>
                      ))}
                    </div>
                  )}
                  {label && selectedDomainRoute && (
                    <p className="port-domain-preview">
                      Players will join at{' '}
                      <code>
                        {address(`play.${label}.${selectedDomainRoute.domain}`, selectedDomainRoute.public_port)}
                      </code>
                    </p>
                  )}
                  <div className="actions">
                    <Button
                      type="submit"
                      disabled={busy || !!domain.error || domain.loading || !validLabel || !selectedDomainRoute}
                    >
                      {busy ? 'Saving...' : 'Save subdomain'}
                    </Button>
                    {domainData.hostname && (
                      <Button variant="danger" disabled={busy} onClick={() => void removeDomain()}>
                        Remove subdomain
                      </Button>
                    )}
                  </div>
                </fieldset>
              </form>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
