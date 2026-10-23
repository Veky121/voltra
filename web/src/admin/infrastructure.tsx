import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { NodeConnection, NodeList } from "./node-pairing";
import {
  Action,
  DataTable,
  DownloadJSON,
  Editor,
  ErrorMessage,
  Heading,
  JsonView,
  Panel,
  ResourceEditor,
  ResourceList,
  api,
  f,
  rows,
  unwrap,
  useAPI,
} from "./shared";

const locations = "/api/application/locations",
  nodes = "/api/application/nodes";
export function Locations() {
  return (
    <ResourceList
      title="Groups"
      description="Organize nodes into groups such as Home or EU. Each node belongs to one group, which can also be used when choosing where to create servers."
      endpoint={locations}
      base="/admin/locations"
      columns={["short", "long"]}
    />
  );
}
export function Location() {
  const { id = "new" } = useParams();
  return (
    <ResourceEditor
      title="Group"
      id={id}
      endpoint={locations}
      base="/admin/locations"
      fields={[
        f("short", "Group name", undefined, { required: true }),
        f("long", "Description", "textarea"),
      ]}
    />
  );
}
export function Nodes() {
  return <NodeList />;
}
export function Node() {
  const { id = "new" } = useParams();
  const l = useAPI(`${locations}?per_page=100`);
  const fields = [
    f("name", "Name", undefined, { required: true }),
    f("description", "Description", "textarea"),
    f("location_id", "Group", "select", {
      required: true,
      options: l.data
        ? rows(l.data).map((x) => ({
            value: x.id,
            label: `${x.short} · ${x.long}`,
          }))
        : [],
    }),
    f("fqdn", "Hostname or IP address", undefined, { required: true }),
    f("scheme", "Protocol", "select", {
      default: "http",
      options: [
        { value: "http", label: "HTTP" },
        { value: "https", label: "HTTPS" },
      ],
    }),
    f("behind_proxy", "Behind a reverse proxy", "checkbox"),
    f("public", "Allow automatic deployment", "checkbox", { default: true }),
    f("memory", "Memory capacity (MiB)", "number", { required: true }),
    f("memory_overallocate", "Memory overallocation (%)", "number"),
    f("disk", "Disk capacity (MiB)", "number", { required: true }),
    f("disk_overallocate", "Disk overallocation (%)", "number"),
    f("upload_size", "Maximum upload (MiB)", "number", { default: 100 }),
    f("daemon_listen", "Wings HTTP port", "number", { default: 8080 }),
    f("daemon_sftp", "Wings SFTP port", "number", { default: 2022 }),
    f("daemon_base", "Server data directory", undefined, {
      default: "/var/lib/voltra/volumes",
    }),
    f("maintenance_mode", "Maintenance mode", "checkbox"),
    f("allowed_origins", "Additional allowed origins", "json", { default: [] }),
  ];
  return (
    <ResourceEditor
      title="Node"
      id={id}
      endpoint={nodes}
      base="/admin/nodes"
      fields={fields}
    >
      {(node) => <NodeExtras node={node} />}
    </ResourceEditor>
  );
}
function NodeExtras({ node }: { node: any }) {
  const path = `${nodes}/${node.id}`;
  const a = useAPI(`${path}/allocations?per_page=100`);
  const config = useAPI(`${path}/configuration`);
  const servers = useAPI("/api/application/servers?per_page=100");
  const [rotated, setRotated] = useState<any>(null);
  const [selection, setSelection] = useState<number[]>([]);
  return (
    <>
      <NodeConnection nodeId={node.id} nodeName={node.name} />
      <NodeDiagnostics node={node} />
      <Panel title="Wings configuration">
        <p className="muted">
          Save this configuration on the node. It contains the node's machine
          credential.
        </p>
        <ErrorMessage error={config.error} />
        {config.data && (
          <>
            <JsonView value={rotated ?? config.data} />
            <DownloadJSON
              value={rotated ?? config.data}
              name={`wings-${node.id}.json`}
            />
          </>
        )}
        <Action
          path={`/api/admin/nodes/${node.id}/reset-token`}
          confirm="Rotate the Wings token? Update the daemon configuration afterwards."
          onDone={(r) => {
            setRotated(r);
            config.reload();
          }}
        >
          Rotate daemon token
        </Action>
      </Panel>
      <Panel title="Allocations">
        <ErrorMessage error={a.error} />
        <DataTable
          data={a.data ? rows(a.data) : []}
          columns={[
            {
              label: "Select",
              render: (x) => (
                <input
                  aria-label={`Select allocation ${x.id}`}
                  type="checkbox"
                  checked={selection.includes(x.id)}
                  onChange={(e) =>
                    setSelection(
                      e.target.checked
                        ? [...selection, x.id]
                        : selection.filter((y) => y !== x.id)
                    )
                  }
                />
              ),
            },
            { label: "Address", render: (x) => `${x.ip}:${x.port}` },
            {
              label: "Alias",
              render: (x) => (
                <AllocationAlias
                  node={node.id}
                  allocation={x}
                  onSaved={a.reload}
                />
              ),
            },
            {
              label: "Server",
              render: (x) =>
                x.server_id ? (
                  <Link to={`/admin/servers/${x.server_id}`}>
                    #{x.server_id}
                  </Link>
                ) : x.assigned ? (
                  "Assigned"
                ) : (
                  "Available"
                ),
            },
            {
              label: "Actions",
              render: (x) => (
                <Action
                  path={`${path}/allocations/${x.id}`}
                  method="DELETE"
                  confirm="Delete this allocation?"
                  onDone={a.reload}
                  danger
                >
                  Delete
                </Action>
              ),
            },
          ]}
        />
        {selection.length > 0 && (
          <Action
            path={`/api/admin/nodes/${node.id}/allocations`}
            method="DELETE"
            body={{ allocations: selection }}
            confirm={`Delete ${selection.length} selected allocations?`}
            onDone={() => {
              a.reload();
              setSelection([]);
            }}
            danger
          >
            Delete selected allocations
          </Action>
        )}
      </Panel>
      <Editor
        title="Create allocations"
        endpoint={`${path}/allocations`}
        method="POST"
        fields={[
          f("ip", "IP address or CIDR", undefined, { required: true }),
          f("alias", "IP alias"),
          f("ports", "Ports and ranges", "json", {
            default: ["25565"],
            hint: 'Example: ["25565", "25570-25580"]',
          }),
        ]}
        onSaved={a.reload}
        submit="Create allocations"
      />
      <Panel title="Servers on this node">
        <ErrorMessage error={servers.error} />
        <DataTable
          data={
            servers.data
              ? rows(servers.data).filter(
                  (x) => String(x.node ?? x.node_id) === String(node.id)
                )
              : []
          }
          columns={[
            {
              label: "Name",
              render: (x) => (
                <Link to={`/admin/servers/${x.id}`}>{x.name}</Link>
              ),
            },
            {
              label: "Memory",
              render: (x) => `${x.limits?.memory ?? x.memory} MiB`,
            },
            { label: "Status", render: (x) => x.status ?? "Ready" },
          ]}
        />
      </Panel>
    </>
  );
}
function NodeDiagnostics({ node }: { node: any }) {
  const [system, setSystem] = useState<any>(null),
    [token, setToken] = useState<any>(null);
  return (
    <Panel title="Node diagnostics and deployment">
      <div className="actions">
        <Action
          path={`/api/admin/nodes/${node.id}/system-information`}
          method="GET"
          onDone={setSystem}
        >
          Check Wings connection
        </Action>
        <Action
          path={`/api/admin/nodes/${node.id}/deploy-token`}
          onDone={setToken}
        >
          Generate deployment token
        </Action>
      </div>
      {system && <JsonView value={system} />}
      {token && (
        <>
          <p className="muted">
            Run this command on the node. Revoke the deployment key from
            Application API keys after configuration.
          </p>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            wings configure --panel-url {window.location.origin} --token{" "}
            {token.token} --node {token.node}
          </pre>
          <button className="secondary" onClick={() => setToken(null)}>
            Dismiss token
          </button>
        </>
      )}
    </Panel>
  );
}
function AllocationAlias({
  node,
  allocation,
  onSaved,
}: {
  node: number;
  allocation: any;
  onSaved: () => void;
}) {
  const [alias, setAlias] = useState(
    allocation.alias ?? allocation.ip_alias ?? ""
  );
  const [err, setErr] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/api/admin/nodes/${node}/allocations/${allocation.id}`, {
            method: "PATCH",
            body: JSON.stringify({ alias }),
          });
          onSaved();
        } catch (error) {
          setErr(String(error));
        }
      }}
    >
      <input
        aria-label={`Alias for ${allocation.ip}:${allocation.port}`}
        value={alias}
        onChange={(e) => setAlias(e.target.value)}
      />
      <button className="secondary">Save alias</button>
      <ErrorMessage error={err} />
    </form>
  );
}
const mounts = "/api/admin/mounts";
export function Mounts() {
  return (
    <ResourceList
      title="Mounts"
      endpoint={mounts}
      base="/admin/mounts"
      columns={["name", "source", "target", "read_only"]}
    />
  );
}
export function Mount() {
  const { id = "new" } = useParams();
  return (
    <ResourceEditor
      title="Mount"
      endpoint={mounts}
      base="/admin/mounts"
      id={id}
      fields={[
        f("name", "Name", undefined, { required: true }),
        f("description", "Description", "textarea"),
        f("source", "Host source path", undefined, { required: true }),
        f("target", "Container target path", undefined, { required: true }),
        f("read_only", "Read only", "checkbox", { default: true }),
        f("user_mountable", "User mountable", "checkbox"),
      ]}
    >
      {() => (
        <>
          <MountAssignments mountID={id} relation="nodes" />
          <MountAssignments mountID={id} relation="eggs" />
          <MountAssignments mountID={id} relation="servers" />
          <p className="muted">
            Only servers matching an allowed node and egg can attach this mount.
          </p>
        </>
      )}
    </ResourceEditor>
  );
}
function MountAssignments({
  mountID,
  relation,
}: {
  mountID: string;
  relation: "nodes" | "eggs" | "servers";
}) {
  const path = `${mounts}/${mountID}/${relation}`;
  const q = useAPI(path);
  return (
    <>
      <Panel title={`Assigned ${relation}`}>
        <ErrorMessage error={q.error} />
        <DataTable
          data={q.data ? rows(q.data) : []}
          columns={[
            { label: "Name", render: (x) => x.name },
            { label: "ID", render: (x) => x.id },
            {
              label: "Actions",
              render: (x) => (
                <Action
                  path={`${path}/${x.id}`}
                  method="DELETE"
                  confirm={`Remove this ${relation.slice(0, -1)} assignment?`}
                  onDone={q.reload}
                >
                  Remove
                </Action>
              ),
            },
          ]}
        />
      </Panel>
      <Editor
        title={`Assign ${relation}`}
        endpoint={path}
        method="POST"
        fields={[f(relation, `${relation} IDs`, "json", { default: [] })]}
        onSaved={q.reload}
        submit="Assign"
      />
    </>
  );
}
const hosts = "/api/admin/database-hosts";
export function Hosts() {
  return (
    <ResourceList
      title="Database hosts"
      endpoint={hosts}
      base="/admin/database-hosts"
      columns={["name", "host", "port", "username"]}
    />
  );
}
export function Host() {
  const { id = "new" } = useParams();
  const n = useAPI(nodes);
  return (
    <ResourceEditor
      title="Database host"
      endpoint={hosts}
      base="/admin/database-hosts"
      id={id}
      fields={[
        f("name", "Name", undefined, { required: true }),
        f("host", "Host", undefined, { required: true }),
        f("port", "Port", "number", { default: 3306 }),
        f("username", "Database administrator username", undefined, {
          required: true,
        }),
        f("password", "Database administrator password", "password", {
          hint: "Leave blank to keep the current password when editing.",
        }),
        f("node_id", "Linked node", "select", {
          options: n.data
            ? rows(n.data).map((x) => ({ value: x.id, label: x.name }))
            : [],
        }),
        f("max_databases", "Maximum databases", "number", { default: "" }),
      ]}
    >
      {() => (
        <Panel title="Connectivity">
          <Action path={`${hosts}/${id}/test`}>Test connection</Action>
        </Panel>
      )}
    </ResourceEditor>
  );
}
export function Settings() {
  const q = useAPI("/api/admin/settings");
  const initial = q.data ? q.data.attributes ?? q.data : undefined;
  return (
    <>
      <Heading title="Panel settings" />
      <ErrorMessage error={q.error} />
      {q.loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <Editor
            title="General"
            endpoint="/api/admin/settings"
            initial={initial}
            fields={[
              f("app:name", "Panel name", undefined, { default: "Voltra" }),
              f("app:locale", "Default language", undefined, { default: "en" }),
              f("app:timezone", "Panel timezone", undefined, {
                default: "UTC",
                required: true,
                hint: "IANA timezone, such as UTC or Europe/Berlin. Schedules use the panel timezone.",
              }),
            ]}
          />
          <Editor
            title="Wings and allocation settings"
            endpoint="/api/admin/settings"
            initial={initial}
            fields={[
              f(
                "pterodactyl:guzzle:connect_timeout",
                "Wings connection timeout (seconds)",
                "number",
                { default: 5 }
              ),
              f(
                "pterodactyl:guzzle:timeout",
                "Wings request timeout (seconds)",
                "number",
                { default: 60 }
              ),
              f(
                "pterodactyl:client_features:allocations:enabled",
                "Allow automatic allocation creation",
                "checkbox"
              ),
              f(
                "pterodactyl:client_features:allocations:range_start",
                "Allocation range start",
                "number",
                { default: 25565 }
              ),
              f(
                "pterodactyl:client_features:allocations:range_end",
                "Allocation range end",
                "number",
                { default: 26000 }
              ),
              f(
                "pterodactyl:client_features:databases:enabled",
                "Allow client database creation",
                "checkbox",
                { default: true }
              ),
              f(
                "pterodactyl:client_features:databases:allow_random",
                "Allow random database host selection",
                "checkbox",
                { default: true }
              ),
              f(
                "pterodactyl:client_features:schedules:per_schedule_task_limit",
                "Maximum tasks per schedule",
                "number",
                { default: 10 }
              ),
              f(
                "activity:hide_admin_activity",
                "Hide administrator activity from users",
                "checkbox"
              ),
            ]}
          />
          <details className="card"><summary>Optional panel artwork pack</summary><p>Set <code>ARTWORK_DIRECTORY</code> on the panel host to a private directory outside the web root, containing a <code>manifest.json</code> that maps server and library IDs to JPG, PNG or WebP files. Restart the panel during maintenance to apply pack changes. Web and desktop load the pack after sign-in and keep original SVG tiles as fallbacks. See <code>SERVER_ARTWORK.md</code> for the manifest format. Operators are responsible for permission to host their chosen artwork.</p></details>
          <BackupSettings initial={initial} />
          <Editor
            title="Mail delivery"
            endpoint="/api/admin/settings"
            initial={initial}
            fields={[
              f("mail:host", "SMTP host"),
              f("mail:port", "SMTP port", "number", { default: 587 }),
              f("mail:username", "SMTP username"),
              f("mail:password", "SMTP password", "password"),
              f("mail:encryption", "Encryption", "select", {
                default: "tls",
                options: [
                  { value: "tls", label: "STARTTLS" },
                  { value: "ssl", label: "TLS" },
                  { value: "none", label: "None" },
                ],
              }),
              f("mail:from:address", "Sender address", "email"),
              f("mail:from:name", "Sender name"),
            ]}
          />
          <Editor
            title="Send test email"
            endpoint="/api/admin/settings/mail/test"
            method="POST"
            fields={[
              f("email", "Recipient email", "email", { required: true }),
            ]}
            submit="Send test email"
          />
          <Editor
            title="All settings"
            endpoint="/api/admin/settings"
            initial={{ settings: initial ?? {} }}
            fields={[f("settings", "Settings JSON", "json")]}
            transform={(v) => cleanSettings(v.settings)}
          />
        </>
      )}
    </>
  );
}
function cleanSettings(settings: any): any {
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    return settings;
  return Object.fromEntries(
    Object.entries(settings)
      .filter(([key]) => !key.endsWith("_configured"))
      .map(([key, value]) => [key, cleanSettings(value)])
  );
}
function BackupSettings({ initial }: { initial: any }) {
  return (
    <>
      <Editor
        title="Backup storage"
        endpoint="/api/admin/settings"
        initial={initial}
        fields={[
          f("backups.default", "Storage provider", "select", {
            default: "wings",
            options: [
              { value: "wings", label: "Wings local storage" },
              { value: "s3", label: "S3 compatible object storage" },
            ],
          }),
        ]}
      />
      <Editor
        title="S3 connection"
        endpoint="/api/admin/settings"
        initial={initial?.["backups.s3"]}
        fields={[
          f("bucket", "Bucket"),
          f("region", "Region", undefined, { default: "us-east-1" }),
          f("endpoint", "Custom S3 endpoint"),
          f("access_key_id", "Access key ID"),
          f("secret_access_key", "Secret access key", "password", {
            hint: initial?.["backups.s3"]?.secret_access_key_configured
              ? "A secret is configured. Leave blank to retain it."
              : "No secret configured.",
          }),
          f("session_token", "Session token", "password"),
          f("path_style", "Use path style addressing", "checkbox"),
          f("part_size", "Multipart upload part size (bytes)", "number", {
            default: 5 * 1024 * 1024,
          }),
        ]}
        transform={(v) => ({ "backups.s3": v })}
      />
    </>
  );
}
