import {SectionTabs} from "../ui/SectionTabs";
import { useEffect, useState } from "react";
import "../client/serverAdminTools.css";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Switch } from "../ui/Settings";
import {
  Action,
  DataTable,
  Editor,
  ErrorMessage,
  Fields,
  Heading,
  JsonView,
  Panel,
  ResourceList,
  api,
  defaults,
  f,
  normalize,
  rows,
  unwrap,
  useAPI,
  type RecordData,
} from "./shared";
const servers = "/api/application/servers";
const limits = [
  f("memory", "Memory limit (GB)", "number", { default: 1024, unit: "GB", hint: "0 means unlimited memory." }),
  f("swap", "Swap (GB)", "number", { unit: "GB", swapSentinel: true, hint: "0 disables swap. -1 allows unlimited swap." }),
  f("disk", "Disk limit (GB)", "number", { default: 10240, unit: "GB", hint: "0 means unlimited storage." }),
  f("io", "IO weight", "number", { default: 500 }),
  f("cpu", "CPU limit (%)", "number", { default: 100 }),
  f("threads", "CPU pinning"),
  f("oom_disabled", "Disable OOM killer", "checkbox"),
];
const features = [
  f("database_limit", "Database limit", "number"),
  f("allocation_limit", "Additional allocation limit", "number"),
  f("backup_limit", "Backup limit", "number"),
];
export function ServerSettingsTabs({tabs,active,onChange,scope='server-settings'}:{tabs:readonly (readonly [string,string])[];active:string;onChange:(tab:string)=>void;scope?:string}){
 return <SectionTabs label="Server settings" scope={scope} className="server-settings-tabs" items={tabs.map(([id,label])=>({id,label}))} active={active} onChange={onChange}/>;
}
export function Servers() {
  return (
    <ResourceList
      title="Servers"
      endpoint={`${servers}?per_page=100`}
      base="/admin/servers"
      columns={["name", "identifier", "node", "user", "status"]}
    />
  );
}
export function Server() {
  const { id = "new" } = useParams();
  const q = useAPI(
    id === "new"
      ? null
      : `${servers}/${id}?include=allocations,variables,user,node,egg`
  );
  if (id === "new") return <Navigate to="/game-library" replace/>;
  const record = q.data ? unwrap(q.data) : null;
  if (q.error) return <ErrorMessage error={q.error}/>;
  if (!record) return <p role="status">Loading server...</p>;
  return <Navigate to={`/server/${record.identifier || record.uuid}/runtime`} replace/>;
}

function CreateServer() {
  const navigate = useNavigate();
  const usersQ = useAPI("/api/application/users?per_page=100"),
    nodesQ = useAPI("/api/application/nodes?per_page=100"),
    nestsQ = useAPI("/api/application/nests?per_page=100");
  const [values, setValues] = useState<RecordData>({
    ...defaults(limits),
    ...defaults(features),
    name: "",
    description: "",
    user: "",
    node: "",
    nest: "",
    egg: "",
    allocation: "",
    additional_allocations: [],
    docker_image: "",
    startup: "",
    skip_scripts: false,
    start_on_completion: true,
    environment: {},
  });
  const eggsQ = useAPI(
    values.nest
      ? `/api/application/nests/${values.nest}/eggs?per_page=100`
      : null
  );
  const eggQ = useAPI(values.egg ? `/api/admin/eggs/${values.egg}` : null);
  const integrationQ = useAPI(values.egg ? `/api/admin/integrations/defaults/${values.egg}` : null);
  const integrationDefaults = integrationQ.data ? unwrap(integrationQ.data).variables ?? {} : {};
  const [integrationOverrides, setIntegrationOverrides] = useState<Record<string, boolean>>({});
  useEffect(() => { setIntegrationOverrides({}); }, [values.egg]);
  const allocationsQ = useAPI(
    values.node
      ? `/api/application/nodes/${values.node}/allocations?per_page=100`
      : null
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const egg = eggQ.data ? unwrap(eggQ.data) : null;
  useEffect(() => {
    if (egg) {
      const vars = rows(egg.relationships?.variables ?? { data: [] });
      setValues((v) => ({
        ...v,
        startup: egg.startup,
        docker_image: Object.values(egg.docker_images ?? {})[0] ?? "",
        environment: Object.fromEntries(
          vars.map((x) => [x.env_variable, x.default_value])
        ),
      }));
    }
  }, [eggQ.data]);
  const fields = [
    f("name", "Server name", undefined, { required: true }),
    f("description", "Description", "textarea"),
    f("user", "Owner", "select", {
      required: true,
      options: usersQ.data
        ? rows(usersQ.data).map((x) => ({
            value: x.id,
            label: `${x.username} · ${x.email}`,
          }))
        : [],
    }),
    f("node", "Node", "select", {
      required: true,
      options: nodesQ.data
        ? rows(nodesQ.data).map((x) => ({ value: x.id, label: x.name }))
        : [],
    }),
    f("allocation", "Primary allocation", "select", {
      required: true,
      options: allocationsQ.data
        ? rows(allocationsQ.data)
            .filter((x) => !x.assigned && !x.server_id)
            .map((x) => ({
              value: x.id,
              label: `${x.ip}:${x.port}${x.alias ? ` · ${x.alias}` : ""}`,
            }))
        : [],
    }),
    f("additional_allocations", "Additional allocations", "multiselect", {
      options: allocationsQ.data
        ? rows(allocationsQ.data)
            .filter((x) => !x.assigned && !x.server_id)
            .map((x) => ({
              value: x.id,
              label: String(x.ip) + ":" + String(x.port),
            }))
        : [],
      default: [],
    }),
    f("nest", "Nest", "select", {
      required: true,
      options: nestsQ.data
        ? rows(nestsQ.data).map((x) => ({ value: x.id, label: x.name }))
        : [],
    }),
    f("egg", "Egg", "select", {
      required: true,
      options: eggsQ.data
        ? rows(eggsQ.data).map((x) => ({ value: x.id, label: x.name }))
        : [],
    }),
    f("docker_image", "Docker image", undefined, { required: true }),
    f("startup", "Startup command", "textarea", { required: true }),
    f("skip_scripts", "Skip installation script", "checkbox"),
    f("start_on_completion", "Start after installation", "checkbox"),
  ];
  const eggVars = egg ? rows(egg.relationships?.variables ?? { data: [] }) : [];
  return (
    <div className="admin-management-page management-ui">
      <Heading title="Create server">
        <Link to="/admin/servers">All servers</Link>
      </Heading>
      <ErrorMessage
        error={
          usersQ.error ||
          nodesQ.error ||
          nestsQ.error ||
          eggsQ.error ||
          allocationsQ.error ||
          eggQ.error ||
          integrationQ.error ||
          error
        }
      />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          try {
            const v = normalize([...fields, ...limits, ...features], values);
            const body = {
              ...v,
              environment: Object.fromEntries(Object.entries(v.environment).filter(([name]) => !integrationDefaults[name] || integrationOverrides[name])),
              user: Number(v.user),
              node_id: Number(v.node),
              egg: Number(v.egg),
              nest_id: Number(v.nest),
              limits: Object.fromEntries(limits.map((x) => [x.key, v[x.key]])),
              feature_limits: {
                databases: Number(v.database_limit),
                allocations: Number(v.allocation_limit),
                backups: Number(v.backup_limit),
              },
              allocation: {
                default: Number(v.allocation),
                additional: v.additional_allocations.map(Number),
              },
            };
            const result = await api(servers, {
              method: "POST",
              body: JSON.stringify(body),
            });
            navigate(`/admin/servers/${unwrap(result).id}`);
          } catch (err) {
            setError(String(err instanceof Error ? err.message : err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Panel title="Identity and deployment">
          <Fields
            fields={fields}
            value={values}
            onChange={(next) =>
              setValues({
                ...next,
                ...(next.nest !== values.nest ? { egg: "" } : {}),
                ...(next.node !== values.node ? { allocation: "" } : {}),
              })
            }
          />
        </Panel>
        <Panel title="Resource limits">
          <Fields fields={limits} value={values} onChange={setValues} />
        </Panel>
        <Panel title="Feature limits">
          <Fields fields={features} value={values} onChange={setValues} />
        </Panel>
        <Panel title="Egg environment">
          {egg?.description && <p className="muted">{egg.description}</p>}
          {Object.keys(integrationDefaults).length > 0 && <p className="muted">Saved global credentials are available for this egg. Values stay hidden and are applied when you create the server. <Link to="/admin/integrations">Manage integrations</Link></p>}
          {eggVars.filter(x => integrationDefaults[x.env_variable]).map(x => <div key={x.id} className="toolbar">
            <span>{x.name}: {integrationDefaults[x.env_variable].name}</span>
            <label className="admin-inline-switch"><Switch checked={integrationOverrides[x.env_variable] ?? false} onCheckedChange={checked => setIntegrationOverrides(v => ({ ...v, [x.env_variable]: checked }))} /> Override for this server</label>
          </div>)}
          <Fields
            fields={eggVars.filter(x => !integrationDefaults[x.env_variable] || integrationOverrides[x.env_variable]).map((x) =>
              f(x.env_variable, x.name, integrationDefaults[x.env_variable] ? "password" : undefined, {
                hint: `${x.description ?? ""} Rules: ${x.rules}`,
                required: x.rules?.includes("required"),
              })
            )}
            value={values.environment}
            onChange={(environment) =>
              setValues((v) => ({ ...v, environment }))
            }
          />
        </Panel>
        <div className="actions admin-form-actions"><button disabled={busy || eggQ.loading || integrationQ.loading || Boolean(integrationQ.error)}>
          {busy ? "Creating…" : "Create and install server"}
        </button></div>
      </form>
    </div>
  );
}
export function Details({ record, onSaved }: { record: any; onSaved: () => void }) {
  const q = useAPI("/api/application/users?per_page=100");
  return (
    <Editor
      title="Server details"
      endpoint={`${servers}/${record.id}/details`}
      initial={{ ...record, user: record.user ?? record.owner_id }}
      fields={[
        f("name", "Name", undefined, { required: true }),
        f("description", "Description", "textarea"),
        f("user", "Owner", "select", {
          required: true,
          options: q.data
            ? rows(q.data).map((x) => ({
                value: x.id,
                label: `${x.username} · ${x.email}`,
              }))
            : [],
        }),
        f("external_id", "External ID"),
      ]}
      transform={(v) => ({
        name: v.name,
        description: v.description,
        user: Number(v.user),
        external_id: v.external_id || null,
      })}
      onSaved={onSaved}
    />
  );
}
export function Build({ record, onSaved }: { record: any; onSaved: () => void }) {
  const allocations = useAPI(
    `/api/application/nodes/${
      record.node ?? record.node_id
    }/allocations?per_page=100`
  );
  return (
    <Editor
      title="Build configuration"
      endpoint={`${servers}/${record.id}/build`}
      initial={{
        ...record,
        ...record.limits,
        database_limit:
          record.feature_limits?.databases ?? record.database_limit,
        allocation_limit:
          record.feature_limits?.allocations ?? record.allocation_limit,
        backup_limit: record.feature_limits?.backups ?? record.backup_limit,
        allocation: record.allocation ?? record.allocation_id,
        add_allocations: [],
        remove_allocations: [],
      }}
      fields={[
        ...limits,
        ...features,
        f("allocation", "Primary allocation", "select", {
          options: allocations.data
            ? rows(allocations.data)
                .filter(
                  (x) => x.server_id === record.id || x.id === record.allocation
                )
                .map((x) => ({ value: x.id, label: `${x.ip}:${x.port}` }))
            : [],
        }),
        f(
          "add_allocations",
          "Additional allocations to attach",
          "multiselect",
          {
            default: [],
            options: allocations.data
              ? rows(allocations.data)
                  .filter((x) => !x.assigned && !x.server_id)
                  .map((x) => ({
                    value: x.id,
                    label: String(x.ip) + ":" + String(x.port),
                  }))
              : [],
          }
        ),
        f("remove_allocations", "Allocations to remove", "multiselect", {
          default: [],
          options: allocations.data
            ? rows(allocations.data)
                .filter(
                  (x) => x.server_id === record.id && x.id !== record.allocation
                )
                .map((x) => ({
                  value: x.id,
                  label: String(x.ip) + ":" + String(x.port),
                }))
            : [],
        }),
      ]}
      transform={(v) => ({
        allocation: Number(v.allocation),
        ...Object.fromEntries(limits.map((x) => [x.key, v[x.key]])),
        feature_limits: {
          databases: Number(v.database_limit),
          allocations: Number(v.allocation_limit),
          backups: Number(v.backup_limit),
        },
        add_allocations: v.add_allocations,
        remove_allocations: v.remove_allocations,
      })}
      onSaved={onSaved}
    />
  );
}
export function RuntimeAssignment({record, onSaved}: {record: any; onSaved: () => void}) {
  const eggID = record.egg ?? record.egg_id;
  return (
      <details className="server-admin-advanced">
        <summary>Startup command and template assignment</summary>
        <p className="muted">The command may contain sensitive values. Template and installer choices affect this server only. A template change can require a separate reinstall.</p>
        <Editor
          title="Startup command and template"
          endpoint={`${servers}/${record.id}/startup`}
          initial={{ startup: record.container?.startup_command ?? record.startup, egg: eggID,
            skip_scripts: record.container?.skip_scripts ?? record.skip_scripts }}
          fields={[f("startup", "Startup command", "textarea"), f("egg", "Egg ID", "number"), f("skip_scripts", "Skip installation script", "checkbox")]}
          onSaved={onSaved}
          submit="Save server assignment"
        />
      </details>
  );
}
export function Startup({ record, onSaved, contextual = false, restrictedOnly = false }: { record: any; onSaved: () => void; contextual?: boolean; restrictedOnly?: boolean }) {
  const eggID = record.egg ?? record.egg_id;
  const q = useAPI(`/api/admin/eggs/${eggID}`);
  const egg = q.data ? unwrap(q.data) : null;
  const farming=egg?.features?.includes('voltra_fs25');
  const vars = egg ? rows(egg.relationships?.variables ?? { data: [] }).filter(variable=>(!farming||!['GAME_SERIAL','DLC_PRODUCT_KEY'].includes(variable.env_variable)) && (!restrictedOnly || variable.user_viewable === false || variable.user_editable === false)) : [];
  const existing = record.relationships?.variables
    ? rows(record.relationships.variables)
    : [];
  const environment = Object.fromEntries(
    vars.map((x) => [
      x.env_variable,
      existing.find((v) => v.env_variable === x.env_variable)?.server_value ??
        x.default_value,
    ])
  );
  if (contextual) {
    if (q.loading) return <p role="status">Loading runtime settings...</p>;
    if (!egg || q.error) return <ErrorMessage error={q.error || "Runtime settings are unavailable."} />;
    const current = { ...environment, ...record.container?.environment };
    const secret = (variable: RecordData) => variable.secret || variable.is_secret || variable.field_type === "password"
      || variable.user_viewable === false || /password|passwd|secret|token|api_?key|credential/i.test(variable.env_variable);
    return <>
      <p className="muted">Runtime changes apply on the next start. Saving does not restart or reinstall this server.</p>
      <Editor
        title={restrictedOnly ? "Restricted template options" : "Image and environment"}
        endpoint={`${servers}/${record.id}/startup`}
        initial={{ ...(!restrictedOnly ? {image: record.container?.image ?? record.image} : {}),
          ...Object.fromEntries(vars.map(variable => [`env:${variable.env_variable}`, secret(variable) ? "" : current[variable.env_variable] ?? ""])) }}
        fields={[...(!restrictedOnly ? [f("image", "Docker image")] : []), ...vars.map(variable => f(`env:${variable.env_variable}`, variable.name || variable.env_variable,
          secret(variable) ? "password" : variable.field_type === "textarea" ? "textarea" : undefined,
          { hint: `${variable.description || variable.env_variable}${secret(variable) ? " Leave blank to keep the saved value." : ""}` }))]}
        transform={v => ({ ...(!restrictedOnly ? {image: v.image} : {}), environment: Object.fromEntries(vars
          .filter(variable => Object.hasOwn(v, `env:${variable.env_variable}`)
            && (!secret(variable) || v[`env:${variable.env_variable}`] !== "")
            && v[`env:${variable.env_variable}`] !== current[variable.env_variable])
          .map(variable => [variable.env_variable, v[`env:${variable.env_variable}`]])) })}
        onSaved={onSaved}
        submit="Save for next start"
      />
      {!restrictedOnly && <RuntimeAssignment record={record} onSaved={onSaved}/>}
    </>;
  }
  return (
    <>
      <ErrorMessage error={q.error} />
      <Editor
        title="Startup and environment"
        endpoint={`${servers}/${record.id}/startup`}
        initial={{
          startup: record.container?.startup_command ?? record.startup,
          image: record.container?.image ?? record.image,
          egg: eggID,
          skip_scripts: record.container?.skip_scripts ?? record.skip_scripts,
          environment: { ...environment, ...record.container?.environment },
        }}
        fields={[
          f("startup", "Startup command", "textarea"),
          f("image", "Docker image"),
          f("egg", "Egg ID", "number"),
          f("skip_scripts", "Skip installation script", "checkbox"),
          f("environment", "Environment variables", "json", {
            hint: vars
              .map((x) => `${x.env_variable}: ${x.description ?? x.name}`)
              .join("\n"),
          }),
        ]}
        onSaved={onSaved}
      />
      <p className="muted">
        Changing an egg or its installer may require reinstalling the server.
      </p>
    </>
  );
}
export function Manage({ record, onSaved }: { record: any; onSaved: () => void }) {
  return (
    <>
      <Panel title="Server lifecycle">
        <div className="actions">
          <Action
            path={`${servers}/${record.id}/${
              record.status === "suspended" ? "unsuspend" : "suspend"
            }`}
            confirm={
              record.status === "suspended"
                ? undefined
                : "Suspend this server and stop it?"
            }
            onDone={onSaved}
          >
            {record.status === "suspended"
              ? "Unsuspend server"
              : "Suspend server"}
          </Action>
          <Action
            path={`${servers}/${record.id}/reinstall`}
            confirm="Reinstall this server? Its egg installer will run again and may overwrite files."
            danger
            onDone={onSaved}
          >
            Reinstall server
          </Action>
          <Action
            path={`/api/admin/servers/${record.id}/install`}
            body={{ installed: !record.container?.installed }}
            confirm="Change the server installation state manually?"
            onDone={onSaved}
          >
            Toggle installation state
          </Action>
        </div>
      </Panel>
      <Transfer record={record} onSaved={onSaved} />
    </>
  );
}
function Transfer({ record, onSaved }: { record: any; onSaved: () => void }) {
  const endpoint = `/api/admin/servers/${record.id}/transfer`;
  const nodes = useAPI("/api/application/nodes?per_page=100"),
    history = useAPI(endpoint);
  const [value, setValue] = useState<RecordData>({
    node_id: "",
    allocation_id: "",
    allocation_additional: [],
  });
  const allocations = useAPI(
    value.node_id
      ? `/api/application/nodes/${value.node_id}/allocations?per_page=100`
      : null
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const available = allocations.data
    ? rows(allocations.data)
        .filter((x) => !x.assigned && !x.server_id)
        .map((x) => ({ value: x.id, label: `${x.ip}:${x.port}` }))
    : [];
  const fields = [
    f("node_id", "Destination node", "select", {
      required: true,
      options: nodes.data
        ? rows(nodes.data)
            .filter((x) => x.id !== (record.node ?? record.node_id))
            .map((x) => ({ value: x.id, label: x.name }))
        : [],
    }),
    f("allocation_id", "Primary allocation", "select", {
      required: true,
      options: available,
    }),
    f("allocation_additional", "Additional allocations", "multiselect", {
      options: available.filter((x) => x.value !== value.allocation_id),
    }),
  ];
  return (
    <>
      <Panel title="Transfer to another node">
        <ErrorMessage error={error || nodes.error || allocations.error} />
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              !window.confirm(
                "Transfer this server to the selected node? The server will stop while its files are copied."
              )
            )
              return;
            setBusy(true);
            setError("");
            try {
              await api(endpoint, {
                method: "POST",
                body: JSON.stringify(value),
              });
              history.reload();
              onSaved();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Fields
            fields={fields}
            value={value}
            onChange={(next) =>
              setValue({
                ...next,
                ...(next.node_id !== value.node_id
                  ? { allocation_id: "", allocation_additional: [] }
                  : {}),
              })
            }
          />
          <div className="actions admin-form-actions"><button disabled={busy}>
            {busy ? "Transferring…" : "Start transfer"}
          </button></div>
        </form>
      </Panel>
      <Panel title="Transfer history">
        <ErrorMessage error={history.error} />
        <DataTable
          loading={history.loading}
          empty="No transfers yet."
          data={history.data ? rows(history.data) : []}
          columns={[
            { label: "Created", render: (x) => x.created_at },
            { label: "Source node", render: (x) => x.old_node },
            { label: "Destination node", render: (x) => x.new_node },
            {
              label: "Status",
              render: (x) =>
                x.successful === true
                  ? "Completed"
                  : x.successful === false
                  ? "Failed"
                  : x.archived
                  ? "Cancelled"
                  : "In progress",
            },
          ]}
        />
        <Action
          path={endpoint}
          method="DELETE"
          confirm="Cancel this active server transfer?"
          onDone={() => {
            history.reload();
            onSaved();
          }}
        >
          Cancel transfer
        </Action>
      </Panel>
    </>
  );
}
export function DeleteServer({ record, returnTo = "/admin/servers" }: { record: any; returnTo?: string }) {
  const navigate = useNavigate();
  return (
    <Panel title="Delete server" className="admin-danger-panel">
      <p>
        Deletes the container, server files, backups, database records, and
        panel configuration. This cannot be undone.
      </p>
      <div className="actions">
        <Action
          path={`${servers}/${record.id}`}
          method="DELETE"
          danger
          confirm={`Permanently delete ${record.name} and its data?`}
          onDone={() => navigate(returnTo)}
        >
          Delete server
        </Action>
        <Action
          path={`${servers}/${record.id}/force`}
          method="DELETE"
          danger
          confirm={`Force-delete ${record.name} even if Wings cannot be reached? Daemon files may remain.`}
          onDone={() => navigate(returnTo)}
        >
          Force delete
        </Action>
      </div>
    </Panel>
  );
}
export function ServerMounts({ record, contextual = false }: { record: any; contextual?: boolean }) {
  const endpoint = `/api/admin/servers/${record.id}/mounts`;
  const q = useAPI(endpoint);
  return (
    <>
      <ErrorMessage error={q.error} />
      <Panel title="Available mounts">
        <DataTable
          loading={q.loading}
          empty="No mounts available for this server."
          data={q.data ? rows(q.data) : []}
          columns={[
            {
              label: "Name",
              render: (x) => contextual ? x.name : <Link to={`/admin/mounts/${x.id}`}>{x.name}</Link>,
            },
            { label: "Source", render: (x) => x.source },
            { label: "Target", render: (x) => x.target },
            {
              label: "Actions",
              render: (x) =>
                x.attached ? (
                  <Action
                    path={`${endpoint}/${x.id}`}
                    method="DELETE"
                    confirm="Detach this mount? Restart the server to apply."
                    onDone={q.reload}
                  >
                    Detach
                  </Action>
                ) : (
                  <Action
                    path={endpoint}
                    body={{ mount_id: x.id }}
                    onDone={q.reload}
                  >
                    Attach
                  </Action>
                ),
            },
          ]}
        />
      </Panel>
      <Editor
        title="Attach mount"
        endpoint={endpoint}
        method="POST"
        fields={[f("mount_id", "Mount ID", "number", { required: true })]}
        onSaved={q.reload}
        submit="Attach mount"
      />
    </>
  );
}
export function ServerDatabases({ record }: { record: any }) {
  const path = `${servers}/${record.id}/databases`;
  const q = useAPI(path);
  const hosts = useAPI("/api/admin/database-hosts");
  return (
    <>
      <ErrorMessage error={q.error} />
      <Panel title="Server databases">
        <DataTable
          loading={q.loading}
          empty="No databases for this server yet."
          data={q.data ? rows(q.data) : []}
          columns={[
            { label: "Database", render: (x) => x.database },
            { label: "Username", render: (x) => x.username },
            { label: "Allowed connections", render: (x) => x.remote },
            {
              label: "Credentials",
              render: (x) => <DatabaseCredentials path={`${path}/${x.id}`} />,
            },
            {
              label: "Actions",
              render: (x) => (
                <div className="actions">
                  <Action
                    path={`${path}/${x.id}/reset-password`}
                    confirm="Rotate this database password? Existing applications will need the new credentials."
                    onDone={q.reload}
                  >
                    Rotate password
                  </Action>
                  <Action
                    path={`${path}/${x.id}`}
                    method="DELETE"
                    danger
                    confirm="Delete this database and all its data?"
                    onDone={q.reload}
                  >
                    Delete
                  </Action>
                </div>
              ),
            },
          ]}
        />
      </Panel>
      <Editor
        title="Create database"
        endpoint={path}
        method="POST"
        fields={[
          f("database", "Database name", undefined, { required: true }),
          f("remote", "Allowed connection host", undefined, { default: "%" }),
          f("host", "Database host", "select", {
            required: true,
            options: hosts.data
              ? rows(hosts.data).map((x) => ({
                  value: x.id,
                  label: `${x.name} · ${x.host}`,
                }))
              : [],
          }),
          f("max_connections", "Maximum connections", "number"),
        ]}
        onSaved={q.reload}
        submit="Create database"
      />
    </>
  );
}
function DatabaseCredentials({ path }: { path: string }) {
  const [password, setPassword] = useState<string | null>(null),
    [error, setError] = useState("");
  return (
    <div className="admin-credentials management-ui">
      {password === null ? (
        <button
          className="secondary"
          onClick={async () => {
            try {
              const data = unwrap(await api(`${path}?include=password`));
              setPassword(
                data.relationships?.password?.attributes?.password ?? ""
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Reveal password
        </button>
      ) : (
        <>
          <code className="admin-secret">{password}</code>
          <button
            className="secondary"
            onClick={() => navigator.clipboard.writeText(password)}
          >
            Copy
          </button>
          <button className="secondary" onClick={() => setPassword(null)}>
            Hide
          </button>
        </>
      )}
      <ErrorMessage error={error} />
    </div>
  );
}
