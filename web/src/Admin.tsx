import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { Loading } from "./lib";
import {
  DataTable,
  ErrorMessage,
  Heading,
  Panel,
  rows,
  useAPI,
} from "./admin/shared";

const ApplicationKeys = lazy(() => import("./admin/accounts").then(module => ({default: module.ApplicationKeys})));
const User = lazy(() => import("./admin/accounts").then(module => ({default: module.User})));
const Users = lazy(() => import("./admin/accounts").then(module => ({default: module.Users})));
const Egg = lazy(() => import("./admin/eggs").then(module => ({default: module.Egg})));
const Nest = lazy(() => import("./admin/eggs").then(module => ({default: module.Nest})));
const Nests = lazy(() => import("./admin/eggs").then(module => ({default: module.Nests})));
const Host = lazy(() => import("./admin/infrastructure").then(module => ({default: module.Host})));
const Hosts = lazy(() => import("./admin/infrastructure").then(module => ({default: module.Hosts})));
const Location = lazy(() => import("./admin/infrastructure").then(module => ({default: module.Location})));
const Locations = lazy(() => import("./admin/infrastructure").then(module => ({default: module.Locations})));
const Mount = lazy(() => import("./admin/infrastructure").then(module => ({default: module.Mount})));
const Mounts = lazy(() => import("./admin/infrastructure").then(module => ({default: module.Mounts})));
const Node = lazy(() => import("./admin/infrastructure").then(module => ({default: module.Node})));
const Nodes = lazy(() => import("./admin/infrastructure").then(module => ({default: module.Nodes})));
const Settings = lazy(() => import("./admin/infrastructure").then(module => ({default: module.Settings})));
const Server = lazy(() => import("./admin/servers").then(module => ({default: module.Server})));
const Servers = lazy(() => import("./admin/servers").then(module => ({default: module.Servers})));
const Integration = lazy(() => import("./admin/integrations").then(module => ({default: module.Integration})));
const Integrations = lazy(() => import("./admin/integrations").then(module => ({default: module.Integrations})));
const GameLicences = lazy(() => import("./admin/GameLicences").then(module => ({default: module.GameLicences})));
const ProxyGateways = lazy(() => import("./admin/ProxyGateways").then(module => ({default: module.ProxyGateways})));
const JavaRuntimes = lazy(() => import("./admin/JavaRuntimes").then(module => ({default: module.JavaRuntimes})));
const MinecraftRuntimeRules = lazy(() => import("./admin/MinecraftRuntimeRules").then(module => ({default: module.MinecraftRuntimeRules})));


function routePage(children: ReactNode) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

function Overview() {
  const servers = useAPI("/api/application/servers?per_page=100"),
    nodes = useAPI("/api/application/nodes?per_page=100"),
    users = useAPI("/api/application/users?per_page=100"),
    nests = useAPI("/api/application/nests?per_page=100");
  const entries = [
    ["Servers", servers, "/admin/servers"],
    ["Nodes", nodes, "/admin/nodes"],
    ["Accounts", users, "/admin/users"],
    ["Nests", nests, "/admin/nests"],
  ] as const;
  return (
    <>
      <Heading title="Administration" />
      <div
        className="grid admin-summary-grid"
        style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}
      >
        {entries.map(([label, q, to]) => (
          <Panel key={label}>
            <NavLink to={to}>
              <span className="muted">{label}</span>
              <strong className="admin-summary-value">
                {q.loading ? "…" : q.data ? rows(q.data).length : "—"}
              </strong>
            </NavLink>
            <ErrorMessage error={q.error} />
          </Panel>
        ))}
      </div>
      <Panel title="Servers">
        <DataTable
          loading={servers.loading}
          data={servers.data ? rows(servers.data) : []}
          columns={[
            {
              label: "Server",
              render: (x) => (
                <NavLink to={`/admin/servers/${x.id}`}>{x.name}</NavLink>
              ),
            },
            {
              label: "Node",
              render: (x) => (
                <NavLink to={`/admin/nodes/${x.node ?? x.node_id}`}>
                  #{x.node ?? x.node_id}
                </NavLink>
              ),
            },
            {
              label: "Owner",
              render: (x) => (
                <NavLink to={`/admin/users/${x.user ?? x.owner_id}`}>
                  #{x.user ?? x.owner_id}
                </NavLink>
              ),
            },
            {
              label: "Status",
              render: (x) => (
                <span className="badge">{x.status ?? "Ready"}</span>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
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
          <Route path="java-runtimes" element={routePage(<><JavaRuntimes /><MinecraftRuntimeRules /></>)} />
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
