import RouteRecovery from "./RouteRecovery";
import { SidebarSection } from "./Navigation";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useParams } from "react-router-dom";
import { Loading, useAPI } from "./lib";
import {
  can,
  PageError,
  ServerContext,
  value,
} from "./client/common";
import ServerDashboard, {ServerWorkspace} from "./client/ServerDashboard";
import {NavIcon,type IconName} from "./Icons";
import {managedSteamServer} from "./client/gameSetupModel";
import {useServerNavigation} from './ServerNavigation';

const Account = lazy(() => import("./client/Account").then(module => ({default: module.Account})));
const Activity = lazy(() => import("./client/Account").then(module => ({default: module.Activity})));
const Console = lazy(() => import("./client/Console"));
const Files = lazy(() => import("./client/Files"));
const Backups = lazy(() => import("./client/Operations").then(module => ({default: module.Backups})));
const ServerSettings = lazy(() => import("./client/ServerSettings"));
const ServerAdminTools = lazy(() => import("./client/ServerAdminTools"));
const Schedules = lazy(() => import("./client/Collaboration").then(module => ({default: module.Schedules})));
const Users = lazy(() => import("./client/Collaboration").then(module => ({default: module.Users})));
const Overview = lazy(() => import("./client/Overview"));
const GameLibrary = lazy(() => import("./client/GameLibrary").then(module => ({default: module.GameLibrary})));
const MinecraftSetup = lazy(() => import("./client/GameLibrary").then(module => ({default: module.MinecraftSetup})));
const MinecraftContent = lazy(() => import("./client/MinecraftContent").then(module => ({default: module.MinecraftContent})));
const SteamGames = lazy(() => import("./client/SteamGames"));
const GameTemplateSetup = lazy(() => import("./client/TemplateGames"));
const SteamMaintenance = lazy(() => import("./client/SteamMaintenance"));

function routePage(children: ReactNode) {
  return <RoutePage>{children}</RoutePage>;
}

function RoutePage({children}:{children:ReactNode}) {
  const location=useLocation();
  return <RouteRecovery key={location.pathname}><Suspense fallback={<Loading />}>{children}</Suspense></RouteRecovery>;
}

function LegacySettingsPage({page}:{page:string}) {
  const {id}=useParams();
  const {search,hash}=useLocation();
  return <Navigate to={`/server/${id}/settings/${page}${search}${hash}`} replace/>;
}

function Server() {
  const { id } = useParams();
  const base = `/api/client/servers/${id}`;
  const r = useAPI(base);
  const account=useAPI('/api/client/account');
  const administrator=!account.loading&&!account.error&&value(account.data)?.root_admin===true;
  const navigation=useServerNavigation();
  const opened=value(r.data)?.uuid;
  useEffect(()=>{if(opened)navigation.visit(opened)},[opened,navigation.visit]);
  const lifecycleState=value(r.data)?.status;
  useEffect(()=>{
    if(!['installing','restoring_backup'].includes(lifecycleState))return;
    const timer=setInterval(r.reload,1000);
    return()=>clearInterval(timer);
  },[base,lifecycleState,r.reload]);
  if (r.loading && !r.data)
    return (
      <div className="page" role="status">
        Loading server...
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
  const permissions =
    r.data.meta?.is_server_owner || server.server_owner
      ? ["*"]
      : r.data.meta?.user_permissions || server.permissions || [];
  const groups:{label:string;tabs:[string,string,IconName,string][]}[] = [
    {label:"Overview",tabs:[["","Dashboard","dashboard",""]]},
    {label:"Configuration",tabs:[["schedules","Schedules","schedules","schedule.read"],["settings","Settings","settings",""]]},
    {label:"Management",tabs:[["files","Files","files","file.read"],["backups","Backups","backups","backup.read"]]},
    {label:"Access & logs",tabs:[["users","Users","users","user.read"],["activity","Activity","activity","activity.read"]]},
  ];
  const managedSteam = managedSteamServer(server);
  if(server.game==="minecraft")groups[2].tabs.unshift(["content","Mods & plugins","eggs","file.read"]);
  if(administrator || can(permissions, "startup.read")) groups[1].tabs.push(["runtime","Runtime & resources","wrench",""]);
  if(managedSteam||(Array.isArray(server.egg_features)&&server.egg_features.includes('voltra:steam-private-prepared-v1')))groups[2].tabs.unshift(["steam","Steam maintenance","startup","startup.read"]);
  return (
    <ServerContext.Provider
      value={{ server, permissions, base, reload: r.reload }}
    >
      <div className="page server-page">
        <ServerWorkspace key={server.uuid}>
        <PageError error={r.error} />
        {server.is_node_under_maintenance && (
          <div className="error">
            This node is under maintenance. Some actions may be unavailable.
          </div>
        )}
        {server.status && (
          <div className="card">
            Server state: {server.status.replaceAll("_", " ")}.{" "}
            {server.status === "installing"
              ? "Installation output is available in the console."
              : server.status === "reinstall_failed"
                ? "Review the installation output in the dashboard console. An owner or administrator can correct the settings and retry Reinstall server under Settings > General."
                : ""}
          </div>
        )}
        {groups.map(group=>{
          const tabs=group.tabs.filter(([, , ,permission])=>!permission||can(permissions,permission));
          return tabs.length>0&&<SidebarSection key={group.label} label={group.label}>{tabs.map(([path,label,icon])=><NavLink key={path} title={label} end={!path} to={`/server/${id}${path?`/${path}`:''}`}><NavIcon name={icon}/><span>{label}</span></NavLink>)}</SidebarSection>;
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
          <Route path="runtime" element={routePage(<ServerAdminTools/>)} />
          <Route path="admin-tools" element={<Navigate to={`/server/${id}/runtime`} replace/>} />
          <Route path="quick-setup" element={<Navigate to={`/server/${id}/settings`} replace/>} />
          <Route path="steam" element={routePage(<SteamMaintenance />)} />
          <Route path="content" element={routePage(<MinecraftContent server={id??server.uuid} />)} />
          <Route path="settings/*" element={routePage(<ServerSettings />)} />
          <Route
            path="activity"
            element={routePage(<Activity path={`${base}/activity`} />)}
          />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
        </ServerWorkspace>
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
