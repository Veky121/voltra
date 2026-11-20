import {Feedback} from './notifications';
import RouteRecovery from './RouteRecovery';
import {SidebarSection} from './Navigation';
import {lazy, Suspense, useEffect, type ReactNode} from 'react';
import {Link, Navigate, NavLink, Route, Routes, useLocation, useParams} from 'react-router-dom';
import {Loading, useAPI} from './lib';
import type {Resource, Server as ServerAttributes, ServerMeta} from './types/api';
import {ServerPageSkeleton} from './ui/ServerPageSkeleton';
import {can, PageError, ServerContext, value} from './features/shared/common';
import ServerDashboard, {ServerWorkspace, ServerOperationNotice} from './features/servers/ServerDashboard';
import {NavIcon, type IconName} from './Icons';
import {managedSteamServer} from './features/game-library/gameSetupModel';
import {useServerNavigation} from './ServerNavigation';
import {isLivePathFresh} from './hooks/liveEvents';
import {ServerTransfers} from './features/servers/ServerTransfers';
import {readyRoute} from './hooks/readyRoute';

const Account = lazy(() => import('./features/account/Account').then(module => ({default: module.Account})));
const Activity = lazy(() => import('./features/account/Account').then(module => ({default: module.Activity})));
const Console = lazy(() => import('./features/console/Console'));
const Files = lazy(() => import('./features/files/Files'));
const Backups = lazy(() => import('./features/backups/Backups').then(module => ({default: module.Backups})));
const ServerSettings = lazy(() => import('./features/server-settings/ServerSettings'));
const ServerAdminTools = lazy(() => import('./features/server-settings/ServerAdminTools'));
const Schedules = lazy(() => import('./features/schedules/Schedules').then(module => ({default: module.Schedules})));
const Users = lazy(() => import('./features/users/Users').then(module => ({default: module.Users})));
// The page most starts land on. Loading it with this module lets it be drawn
// with the shell instead of after a loading state.
const Overview = readyRoute(() => import('./features/servers/Overview'));
void Overview.preload().catch(() => {});
const GameLibrary = lazy(() =>
  import('./features/game-library/GameLibrary').then(module => ({default: module.GameLibrary}))
);
const MinecraftSetup = lazy(() =>
  import('./features/game-library/GameLibrary').then(module => ({default: module.MinecraftSetup}))
);
const MinecraftContent = lazy(() =>
  import('./features/game-library/MinecraftContent').then(module => ({default: module.MinecraftContent}))
);
const SteamGames = lazy(() => import('./features/game-library/SteamGames'));
const GameTemplateSetup = lazy(() => import('./features/game-library/TemplateGames'));
const SteamMaintenance = lazy(() => import('./features/game-library/SteamMaintenance'));

function routePage(children: ReactNode) {
  return <RoutePage>{children}</RoutePage>;
}

function RoutePage({children}: {children: ReactNode}) {
  const location = useLocation();
  return (
    <RouteRecovery key={location.pathname}>
      <Suspense
        fallback={
          location.pathname.startsWith('/server/') ? (
            <ServerPageSkeleton path={location.pathname + location.search} />
          ) : (
            <Loading />
          )
        }
      >
        {children}
      </Suspense>
    </RouteRecovery>
  );
}

function LegacySettingsPage({page}: {page: string}) {
  const {id} = useParams();
  const {search, hash} = useLocation();
  return <Navigate to={`/server/${id}/settings/${page}${search}${hash}`} replace />;
}

function Server() {
  const {id} = useParams();
  const location = useLocation();
  const base = `/api/client/servers/${id}`;
  const r = useAPI<Resource<ServerAttributes, ServerMeta>>(base);
  // Names the signed-in account for saved pages, as before.
  useAPI('/api/client/account');
  const navigation = useServerNavigation();
  const opened = value(r.data)?.uuid;
  useEffect(() => {
    if (opened) navigation.visit(opened);
  }, [opened, navigation.visit]);
  const lifecycleState = value(r.data)?.status;
  const installationPending =
    !!value(r.data)?.is_installing && !['install_failed', 'reinstall_failed'].includes(lifecycleState ?? '');
  useEffect(() => {
    if (!installationPending && !['installing', 'restoring_backup'].includes(lifecycleState ?? '')) return;
    const timer = setInterval(() => {
      if (!document.hidden && !isLivePathFresh(base)) r.reload();
    }, 1000);
    return () => clearInterval(timer);
  }, [base, lifecycleState, installationPending, r.reload]);
  if (r.loading && !r.data)
    return (
      <div className="page">
        <ServerPageSkeleton path={location.pathname + location.search} />
      </div>
    );
  if (!r.data)
    return (
      <div className="page">
        <PageError error={r.error} />
        <Link to="/">Back to servers</Link>
      </div>
    );
  const server = value(r.data);
  const permissions = r.data.meta?.is_server_owner || server.server_owner ? ['*'] : r.data.meta?.user_permissions || [];
  const groups: {label: string; tabs: [string, string, IconName, string][]}[] = [
    {label: 'Overview', tabs: [['', 'Dashboard', 'dashboard', '']]},
    {
      label: 'Configuration',
      tabs: [
        ['files', 'Files', 'files', 'file.read'],
        ['settings', 'Game Config', 'settings', ''],
      ],
    },
    {
      label: 'Management',
      tabs: [
        ['schedules', 'Schedules', 'schedules', 'schedule.read'],
        ['backups', 'Backups', 'backups', 'backup.read'],
        ['runtime', 'Server settings', 'wrench', ''],
      ],
    },
    {
      label: 'Access & logs',
      tabs: [
        ['users', 'Access', 'users', 'user.read'],
        ['activity', 'Activity', 'activity', 'activity.read'],
      ],
    },
  ];
  const managedSteam = managedSteamServer(server);
  const contentSupported = server.game === 'minecraft' && server.minecraft_content_supported === true;
  if (contentSupported) groups[1].tabs.push(['content', 'Mods & plugins', 'eggs', 'file.read']);
  if (
    managedSteam ||
    (Array.isArray(server.egg_features) && server.egg_features.includes('voltra:steam-private-prepared-v1'))
  )
    groups[2].tabs.unshift(['steam', 'Updates & repair', 'startup', 'startup.read']);
  return (
    <ServerContext.Provider value={{server, permissions, base, reload: r.reload}}>
      <div className="page server-page">
        <ServerTransfers key={server.uuid} base={base} permissions={permissions}>
          <ServerWorkspace key={server.uuid}>
            <PageError error={r.error} />
            {server.is_node_under_maintenance && (
              <Feedback tone="error" message={<>This node is under maintenance. Some actions may be unavailable.</>} />
            )}
            <ServerOperationNotice />
            {groups.map(group => {
              const tabs = group.tabs.filter(([, , , permission]) => !permission || can(permissions, permission));
              return (
                tabs.length > 0 && (
                  <SidebarSection key={group.label} label={group.label}>
                    {tabs.map(([path, label, icon]) => (
                      <NavLink key={path} title={label} end={!path} to={`/server/${id}${path ? `/${path}` : ''}`}>
                        <NavIcon name={icon} />
                        <span>{label}</span>
                      </NavLink>
                    ))}
                  </SidebarSection>
                )
              );
            })}
            <Routes>
              <Route index element={<ServerDashboard>{routePage(<Console />)}</ServerDashboard>} />
              <Route path="console" element={<Navigate to={`/server/${id}`} replace />} />
              <Route path="files/*" element={routePage(<Files />)} />
              <Route path="databases" element={<LegacySettingsPage page="databases" />} />
              <Route path="schedules/*" element={routePage(<Schedules />)} />
              <Route path="users" element={routePage(<Users />)} />
              <Route path="backups" element={routePage(<Backups />)} />
              <Route path="network" element={<LegacySettingsPage page="network" />} />
              <Route path="startup" element={<LegacySettingsPage page="startup" />} />
              <Route path="runtime" element={routePage(<ServerAdminTools />)} />
              <Route path="admin-tools" element={<Navigate to={`/server/${id}/runtime`} replace />} />
              <Route path="quick-setup" element={<Navigate to={`/server/${id}/settings`} replace />} />
              <Route path="steam" element={routePage(<SteamMaintenance />)} />
              <Route
                path="content"
                element={
                  contentSupported ? (
                    routePage(<MinecraftContent server={id ?? server.uuid} />)
                  ) : (
                    <Navigate to={`/server/${id}/settings`} replace />
                  )
                }
              />
              <Route path="settings/*" element={routePage(<ServerSettings />)} />
              <Route path="activity" element={routePage(<Activity path={`${base}/activity`} />)} />
              <Route path="*" element={<p>Page not found.</p>} />
            </Routes>
          </ServerWorkspace>
        </ServerTransfers>
      </div>
    </ServerContext.Provider>
  );
}
export default function Client() {
  return (
    <Routes>
      <Route path="/" element={routePage(<Overview />)} />
      <Route path="/game-library" element={routePage(<GameLibrary />)} />
      <Route path="/game-library/minecraft" element={routePage(<MinecraftSetup />)} />
      <Route path="/game-library/template/:template" element={routePage(<GameTemplateSetup />)} />
      <Route path="/game-library/:game" element={routePage(<SteamGames />)} />
      <Route path="/account/*" element={routePage(<Account />)} />
      <Route path="/server/:id/*" element={<Server />} />
      <Route
        path="*"
        element={
          <div className="page">
            <h1>Page not found</h1>
            <Link to="/">Go to servers</Link>
          </div>
        }
      />
    </Routes>
  );
}
