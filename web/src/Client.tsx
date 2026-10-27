import { SidebarSection } from "./Navigation";
import { useEffect, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useAPI } from "./lib";
import {
  can,
  PageError,
  ServerContext,
  value,
} from "./client/common";
import { Account, Activity } from "./client/Account";
import Console from "./client/Console";
import Files from "./client/Files";
import { Backups } from "./client/Operations";
import ServerSettings from './client/ServerSettings';
import ServerAdminTools from './client/ServerAdminTools';
import { Schedules, Users } from "./client/Collaboration";
import ServerDashboard, {ServerWorkspace} from "./client/ServerDashboard";
import {NavIcon,type IconName} from "./Icons";
import Overview from "./client/Overview";
import {GameLibrary,MinecraftSetup} from "./client/GameLibrary";
import {MinecraftContent} from "./client/MinecraftContent";
import SteamGames from "./client/SteamGames";
import GameTemplateSetup from "./client/TemplateGames";
import SteamMaintenance from "./client/SteamMaintenance";
import {managedSteamServer} from "./client/gameSetupModel";
import {useServerNavigation} from './ServerNavigation';

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
          <Route index element={<ServerDashboard><Console /></ServerDashboard>} />
          <Route path="console" element={<Navigate to={`/server/${id}`} replace />} />
          <Route path="files/*" element={<Files />} />
          <Route path="databases" element={<LegacySettingsPage page="databases" />} />
          <Route path="schedules/*" element={<Schedules />} />
          <Route path="users" element={<Users />} />
          <Route path="backups" element={<Backups />} />
          <Route path="network" element={<LegacySettingsPage page="network" />} />
          <Route path="startup" element={<LegacySettingsPage page="startup" />} />
          <Route path="runtime" element={<ServerAdminTools/>} />
          <Route path="admin-tools" element={<Navigate to={`/server/${id}/runtime`} replace/>} />
          <Route path="quick-setup" element={<Navigate to={`/server/${id}/settings`} replace/>} />
          <Route path="steam" element={<SteamMaintenance />} />
          <Route path="content" element={<MinecraftContent server={id??server.uuid} />} />
          <Route path="settings/*" element={<ServerSettings />} />
          <Route
            path="activity"
            element={<Activity path={`${base}/activity`} />}
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
      <Route path="/" element={<Overview />} />
      <Route path="/game-library" element={<GameLibrary />} />
      <Route path="/game-library/minecraft" element={<MinecraftSetup />} />
      <Route path="/game-library/template/:template" element={<GameTemplateSetup />} />
      <Route path="/game-library/:game" element={<SteamGames />} />
      <Route path="/account/*" element={<Account />} />
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
