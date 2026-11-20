import {Navigate, NavLink, Route, Routes} from 'react-router-dom';
import {lazy, Suspense, type ReactNode} from 'react';
import {Loading} from './lib';
import {Panel} from './features/admin/shared';
import Overview from './features/admin/overview/Overview';

const ApplicationKeys = lazy(() =>
  import('./features/admin/accounts/accounts').then(module => ({default: module.ApplicationKeys}))
);
const User = lazy(() => import('./features/admin/accounts/accounts').then(module => ({default: module.User})));
const Users = lazy(() => import('./features/admin/accounts/accounts').then(module => ({default: module.Users})));
const Egg = lazy(() => import('./features/admin/eggs/eggs').then(module => ({default: module.Egg})));
const Nest = lazy(() => import('./features/admin/eggs/eggs').then(module => ({default: module.Nest})));
const Nests = lazy(() => import('./features/admin/eggs/eggs').then(module => ({default: module.Nests})));
const Host = lazy(() => import('./features/admin/infrastructure/Host').then(module => ({default: module.Host})));
const Hosts = lazy(() => import('./features/admin/infrastructure/Hosts').then(module => ({default: module.Hosts})));
const Location = lazy(() =>
  import('./features/admin/infrastructure/Location').then(module => ({default: module.Location}))
);
const Locations = lazy(() =>
  import('./features/admin/infrastructure/Locations').then(module => ({default: module.Locations}))
);
const Mount = lazy(() => import('./features/admin/infrastructure/Mount').then(module => ({default: module.Mount})));
const Mounts = lazy(() => import('./features/admin/infrastructure/Mounts').then(module => ({default: module.Mounts})));
const Node = lazy(() => import('./features/admin/infrastructure/Node').then(module => ({default: module.Node})));
const Nodes = lazy(() => import('./features/admin/infrastructure/Nodes').then(module => ({default: module.Nodes})));
const Settings = lazy(() => import('./features/admin/settings/Settings').then(module => ({default: module.Settings})));
const Server = lazy(() => import('./features/admin/servers/Server').then(module => ({default: module.Server})));
const Servers = lazy(() => import('./features/admin/servers/Servers').then(module => ({default: module.Servers})));
const Integration = lazy(() =>
  import('./features/admin/integrations/integrations').then(module => ({default: module.Integration}))
);
const Integrations = lazy(() =>
  import('./features/admin/integrations/integrations').then(module => ({default: module.Integrations}))
);
const GameLicences = lazy(() =>
  import('./features/admin/integrations/GameLicences').then(module => ({default: module.GameLicences}))
);
const ProxyGateways = lazy(() =>
  import('./features/admin/integrations/ProxyGateways').then(module => ({default: module.ProxyGateways}))
);
const RuntimeManagement = lazy(() => import('./features/admin/runtimes/RuntimeManagement'));
const JavaRuntimes = lazy(() =>
  import('./features/admin/runtimes/JavaRuntimes').then(module => ({default: module.JavaRuntimes}))
);
const MinecraftRuntimeRules = lazy(() =>
  import('./features/admin/runtimes/MinecraftRuntimeRules').then(module => ({default: module.MinecraftRuntimeRules}))
);

function routePage(children: ReactNode) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

export default function Admin() {
  return (
    <div className="page admin-page">
      <Routes>
        <Route path="/admin">
          <Route index element={<Overview />} />
          <Route path="servers" element={routePage(<Servers />)} />
          <Route path="servers/:id" element={routePage(<Server />)} />
          <Route path="nodes" element={routePage(<Nodes />)} />
          <Route path="nodes/:id" element={routePage(<Node />)} />
          <Route path="users" element={routePage(<Users />)} />
          <Route path="users/:id" element={routePage(<User />)} />
          <Route path="locations" element={routePage(<Locations />)} />
          <Route path="locations/:id" element={routePage(<Location />)} />
          <Route path="nests" element={routePage(<Nests />)} />
          <Route path="nests/:id" element={routePage(<Nest />)} />
          <Route path="eggs/:id" element={routePage(<Egg />)} />
          <Route path="mounts" element={routePage(<Mounts />)} />
          <Route path="mounts/:id" element={routePage(<Mount />)} />
          <Route path="database-hosts" element={routePage(<Hosts />)} />
          <Route path="database-hosts/:id" element={routePage(<Host />)} />
          <Route path="api-keys" element={routePage(<ApplicationKeys />)} />
          <Route path="settings" element={routePage(<Settings />)} />
          <Route path="integrations" element={routePage(<Integrations />)} />
          <Route path="integrations/licences" element={routePage(<GameLicences />)} />
          <Route path="integrations/proxy-gateways" element={routePage(<ProxyGateways />)} />
          <Route path="proxy-gateways" element={<Navigate to="/admin/integrations/proxy-gateways" replace />} />
          <Route path="integrations/:id" element={routePage(<Integration />)} />
          <Route path="runtime-management" element={routePage(<RuntimeManagement />)} />
          <Route
            path="java-runtimes"
            element={routePage(
              <>
                <JavaRuntimes />
                <MinecraftRuntimeRules />
              </>
            )}
          />
          <Route
            path="*"
            element={
              <Panel>
                <h1>Admin page not found</h1>
                <NavLink to="/admin">Return to overview</NavLink>
              </Panel>
            }
          />
        </Route>
      </Routes>
    </div>
  );
}
