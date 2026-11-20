import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {build} from 'esbuild';

const fixture = {context: {}, reads: new Map()};
const require = createRequire(import.meta.url);
const {outputFiles} = await build({
  stdin: {
    contents: `
      export {GameSettingField} from './src/features/server-settings/GameSettingsFields';
      export {default as ServerSettings} from './src/features/server-settings/ServerSettings';
      export {default as PortConnections} from './src/features/network/PortConnections';
    `,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'tsx',
  },
  platform: 'node',
  format: 'cjs',
  bundle: true,
  packages: 'external',
  external: ['react'],
  write: false,
  jsx: 'automatic',
  define: {'import.meta.env.DEV': 'false', 'window.location.hostname': '"fixture.invalid"'},
  loader: {'.css': 'empty'},
  plugins: [
    {
      name: 'settings-fixtures',
      setup(builder) {
        const stubs = {
          lib: `
            export const useAPI = path => fixture.reads.get(path) ?? {data: null, error: '', loading: false, reload() {}};
            export const api = () => { throw new Error('Unexpected network request'); };
            export const Button = 'button', Input = 'input', Select = 'select', Textarea = 'textarea';
            export const Modal = ({children}) => children;
          `,
          common: `
            export const useServer = () => fixture.context;
            export const can = (perms, key) => perms.includes('*') || perms.includes(key);
            export const value = resource => resource?.attributes;
            export const items = resource => resource?.data.map(value) ?? [];
            export const PageError = () => null;
          `,
          notifications: 'export const Feedback = () => null;',
          ConfirmAction: 'export const confirmAction = async () => false;',
          CopyButton: `
            import {createElement} from 'react';
            export const CopyButton = ({value, children, ...props}) =>
              createElement('button', {...props, 'data-copy': value}, children ?? value);
          `,
          GameQuickSetup: 'export default () => "Configuration fields";',
          ServerStartup: 'export default ({section}) => `Startup options panel: ${section}`;',
          Databases: 'export const Databases = () => "Databases panel";',
        };
        builder.onResolve(
          {filter: /\/(lib|common|notifications|ConfirmAction|CopyButton|GameQuickSetup|ServerStartup|Databases)$/},
          args => ({
            path: args.path.split('/').at(-1),
            namespace: 'settings-fixtures',
          })
        );
        builder.onLoad({filter: /.*/, namespace: 'settings-fixtures'}, ({path}) => ({contents: stubs[path]}));
      },
    },
  ],
});
const module = {exports: {}};
new Function('require', 'module', 'exports', 'fixture', outputFiles[0].text)(require, module, module.exports, fixture);
const {GameSettingField, ServerSettings, PortConnections} = module.exports;
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

const base = '/api/client/servers/atm10';
const resource = attributes => ({attributes});
const response = (...entries) => ({data: {data: entries.map(resource)}, loading: false, error: '', reload() {}});
const context = (permissions = ['*']) => ({base, permissions, server: {uuid: 'atm10', game: 'minecraft'}, reload() {}});

const primaryPort = {id: 1, ip: '192.168.178.89', port: 25567, protocols: ['udp', 'tcp'], is_default: true};
const gatewayRoute = (id, protocol, public_port, status = 'applied', extra) => ({
  id,
  allocation_id: 1,
  public_host: 'example.test',
  public_port,
  protocol,
  status,
  ...extra,
});
const joinName = extra => ({
  hostname: 'play.atm10.example.test',
  dns_matches: true,
  route: {public_port: 1024, protocol: 'tcp'},
  choices: [{id: 1}],
  ...extra,
});
function serverPorts({admin = true, permissions, ports = [primaryPort], routes = [], subdomain = {}, allocations}) {
  fixture.context = context(permissions);
  fixture.reads = new Map([
    ['/api/client/account', {data: resource({root_admin: admin})}],
    [base + '/network/allocations', allocations ?? response(...ports)],
    ['/api/admin/servers/atm10/proxy', {data: resource({routes})}],
    [base + '/proxy-routes', response(...routes)],
    [base + '/subdomain', {data: resource(subdomain)}],
  ]);
  return render(PortConnections);
}
const portItem = (html, address) =>
  html
    .split('<li class="port-item"')
    .slice(1)
    .find(item => new RegExp(`^ aria-label="(Primary|Additional) port ${address}"`).test(item));

test('Server ports leads with the address players use, then lists each port with its public addresses', () => {
  const html = serverPorts({
    ports: [primaryPort, {id: 2, ip: '192.168.178.89', port: 25568, protocols: []}],
    routes: [
      gatewayRoute(1, 'tcp', 1024),
      gatewayRoute(2, 'udp', 25567, 'pending'),
      gatewayRoute(3, 'tcp', 25569, 'error'),
    ],
    subdomain: joinName(),
  });
  assert.match(
    html,
    /Server ports.*Refresh ports.*Assign port.*port-share.*Player address.*play\.atm10\.example\.test.*:1024.*data-copy="play.atm10.example.test:1024".*DNS matches.*Share this address with players\..*Assigned ports/s
  );
  assert.doesNotMatch(html, /<table|is not used until|replaces this address/);

  const primary = portItem(html, '192.168.178.89:25567');
  assert.match(primary, /data-copy="192.168.178.89:25567".*Primary.*TCP &amp; UDP.*Edit forwarding.*Edit subdomain/s);
  assert.match(primary, /aria-label="Public addresses for 192.168.178.89:25567"/);
  assert.match(
    primary,
    /Public.*data-copy="example.test:1024".*TCP.*Configured.*data-copy="example.test:25567".*UDP.*Pending.*data-copy="example.test:25569".*Error.*Subdomain.*data-copy="play.atm10.example.test:1024".*DNS matches/s
  );
  assert.doesNotMatch(primary, /Unassign|Not forwarded|Retry DNS|Remove subdomain/);

  const additional = portItem(html, '192.168.178.89:25568');
  assert.match(additional, /data-copy="192.168.178.89:25568".*Not forwarded.*Unassign/s);
  assert.doesNotMatch(additional, /Primary|port-mappings|Edit forwarding|subdomain/);

  // Status is always a word; its tone only repeats the meaning in colour.
  for (const [status, tone] of [
    ['DNS matches', 'ok'],
    ['Configured', 'ok'],
    ['Pending', 'warn'],
    ['Error', 'error'],
    ['Not forwarded', 'neutral'],
  ])
    assert.match(
      html,
      new RegExp(`data-status="${status}" data-tone="${tone}"[^>]*><span[^>]*aria-hidden="true"></span>${status}<`)
    );
});

test('Server ports keeps every page action quiet and labelled', () => {
  const html = serverPorts({
    ports: [primaryPort, {id: 2, ip: '192.168.178.89', port: 25568, protocols: ['tcp']}],
    routes: [gatewayRoute(1, 'tcp', 1024)],
    subdomain: joinName(),
  });
  const actions = [...html.matchAll(/<button[^>]*class="[^"]*port-action[^"]*"[^>]*>/g)].map(match => match[0]);
  assert.equal(actions.length, 5);
  for (const action of actions) assert.match(action, /data-variant="(ghost|outline)"/);
  assert.equal(actions.filter(action => /data-tone="outline"/.test(action)).length, 1);
  assert.match(html, /aria-label="Refresh ports"/);
  assert.match(html, /aria-label="Unassign 192.168.178.89:25568"[^>]*>Unassign</);
  assert.match(html, /aria-label="Copy player address play.atm10.example.test:1024"[^>]*>Copy</);
  assert.match(html, /aria-label="Copy local address 192.168.178.89:25567"/);
  assert.match(html, /aria-label="Copy public address example.test:1024"/);
  assert.match(html, /aria-label="Copy subdomain play.atm10.example.test"/);
});

test('Server ports says when the only address is local', () => {
  const html = serverPorts({ports: [{...primaryPort, ip: '10.0.0.5', protocols: ['tcp']}]});
  assert.match(
    html,
    /data-source="local".*Local address.*10\.0\.0\.5.*:25567.*Local only.*Not reachable from the internet\..*Not forwarded/s
  );
  assert.doesNotMatch(html, /port-mappings|Forward port|Add subdomain|Unassign/);
});

test('Server ports shares the gateway address while the subdomain is not ready', () => {
  const routes = [gatewayRoute(1, 'tcp', 1024)];
  const pending = serverPorts({routes, subdomain: joinName({dns_matches: false})});
  assert.match(
    pending,
    /data-source="public".*Player address.*data-copy="example.test:1024".*Configured.*Game reachability is not verified\..*DNS pending.*play\.atm10\.example\.test<\/code> replaces this address once its DNS record matches\./s
  );
  assert.match(pending, /Subdomain.*data-status="DNS pending" data-tone="warn"/s);
  assert.doesNotMatch(pending, /Retry DNS/);

  const failed = serverPorts({routes, subdomain: joinName({dns_matches: false, dns_status: 'error', choices: []})});
  assert.match(failed, /DNS error.*is not used until its DNS record is fixed\./s);
  assert.match(failed, /Subdomain.*data-status="DNS error" data-tone="error".*Retry DNS.*Remove subdomain/s);
  assert.doesNotMatch(failed, /Edit subdomain|Add subdomain/);

  const removing = serverPorts({routes, subdomain: joinName({cleanup_pending: true})});
  assert.match(removing, /data-status="Removing".*is being removed\..*Subdomain removal pending\./s);
});

test('Server ports is read-only without edit rights', () => {
  const html = serverPorts({
    admin: false,
    permissions: ['allocation.read'],
    ports: [primaryPort, {id: 2, ip: '192.168.178.89', port: 25568, protocols: ['tcp']}],
    routes: [gatewayRoute(1, 'tcp', 1024), gatewayRoute(2, 'udp', 25567)],
    subdomain: joinName({dns_matches: false, dns_status: 'error', choices: []}),
  });
  assert.match(html, /Player address.*data-copy="example.test:1024".*Configured.*DNS error/s);
  assert.match(html, /aria-label="Refresh ports"/);
  assert.doesNotMatch(
    html,
    /Assign port|Forward port|Edit forwarding|Edit subdomain|Add subdomain|Unassign|Retry DNS|Remove subdomain/
  );
});

test('Server ports has loading and empty states of its own', () => {
  const loading = serverPorts({allocations: {data: null, loading: true, error: '', reload() {}}});
  assert.match(loading, /role="status" aria-label="Loading ports" aria-busy="true"/);
  assert.doesNotMatch(loading, /No ports assigned|Player address|Local address/);

  assert.match(
    serverPorts({ports: []}),
    /No ports assigned\.<\/strong> Assign a port to give this server an address\./
  );
  const guest = serverPorts({admin: false, permissions: ['allocation.read'], ports: []});
  assert.match(guest, /No ports assigned\.<\/strong> An administrator can assign one to this server\./);
  assert.doesNotMatch(guest, /port-share|Assigned ports/);
});
