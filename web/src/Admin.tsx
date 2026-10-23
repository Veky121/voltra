import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { ApplicationKeys, User, Users } from "./admin/accounts";
import { Egg, Nest, Nests } from "./admin/eggs";
import {
  Host,
  Hosts,
  Location,
  Locations,
  Mount,
  Mounts,
  Node,
  Nodes,
  Settings,
} from "./admin/infrastructure";
import { Server, Servers } from "./admin/servers";
import { Integration, Integrations } from "./admin/integrations";
import { ProxyGateways } from "./admin/ProxyGateways";
import { JavaRuntimes } from "./admin/JavaRuntimes";
import { MinecraftRuntimeRules } from "./admin/MinecraftRuntimeRules";
import {
  DataTable,
  ErrorMessage,
  Heading,
  Panel,
  rows,
  useAPI,
} from "./admin/shared";

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
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}
      >
        {entries.map(([label, q, to]) => (
          <Panel key={label}>
            <NavLink to={to}>
              <span className="muted">{label}</span>
              <strong
                style={{ display: "block", fontSize: "2.5rem", marginTop: 12 }}
              >
                {q.loading ? "…" : q.data ? rows(q.data).length : "—"}
              </strong>
            </NavLink>
            <ErrorMessage error={q.error} />
          </Panel>
        ))}
      </div>
      <Panel title="Servers">
        <DataTable
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
      <Panel title="Local development">
        <p className="muted">
          Sign-in is deferred while parity is tested. Accounts, ownership,
          permissions, application API keys, and Wings credentials remain
          active.
        </p>
      </Panel>
    </>
  );
}
export default function Admin() {
  return (
    <div className="page">
      <Routes>
        <Route path="/admin">
          <Route index element={<Overview />} />
          <Route path="servers" element={<Servers />} />
          <Route path="servers/:id" element={<Server />} />
          <Route path="nodes" element={<Nodes />} />
          <Route path="nodes/:id" element={<Node />} />
          <Route path="users" element={<Users />} />
          <Route path="users/:id" element={<User />} />
          <Route path="locations" element={<Locations />} />
          <Route path="locations/:id" element={<Location />} />
          <Route path="nests" element={<Nests />} />
          <Route path="nests/:id" element={<Nest />} />
          <Route path="eggs/:id" element={<Egg />} />
          <Route path="mounts" element={<Mounts />} />
          <Route path="mounts/:id" element={<Mount />} />
          <Route path="database-hosts" element={<Hosts />} />
          <Route path="database-hosts/:id" element={<Host />} />
          <Route path="api-keys" element={<ApplicationKeys />} />
          <Route path="settings" element={<Settings />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="integrations/proxy-gateways" element={<ProxyGateways />} />
          <Route path="proxy-gateways" element={<Navigate to="/admin/integrations/proxy-gateways" replace />} />
          <Route path="integrations/:id" element={<Integration />} />
          <Route path="java-runtimes" element={<><JavaRuntimes /><MinecraftRuntimeRules /></>} />
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
