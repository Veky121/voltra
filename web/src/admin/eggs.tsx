import { SidebarSection } from "../Navigation";
import { JavaEgg } from "./JavaEgg";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Action,
  DataTable,
  Editor,
  ErrorMessage,
  Heading,
  Panel,
  ResourceEditor,
  ResourceList,
  api,
  f,
  rows,
  unwrap,
  useAPI,
} from "./shared";
const nests = "/api/admin/nests",
  eggs = "/api/admin/eggs";
export function Nests() {
  return (
    <ResourceList
      title="Nests"
      endpoint={nests}
      base="/admin/nests"
      columns={["name", "author", "description"]}
    />
  );
}
export function Nest() {
  const { id = "new" } = useParams();
  const q = useAPI(
    id === "new" ? null : `/api/application/nests/${id}/eggs?per_page=100`
  );
  return (
    <ResourceEditor
      title="Nest"
      endpoint={nests}
      base="/admin/nests"
      id={id}
      fields={[
        f("name", "Name", undefined, { required: true }),
        f("description", "Description", "textarea"),
        f("author", "Author email", "email", {
          required: true,
          default: "admin@localhost",
        }),
      ]}
    >
      {() => (
        <>
          <Panel title="Eggs">
            <Link className="button" to={`/admin/eggs/new?nest=${id}`}>
              Create egg
            </Link>
            <ErrorMessage error={q.error} />
            <DataTable
              data={q.data ? rows(q.data) : []}
              columns={[
                {
                  label: "Name",
                  render: (x) => (
                    <Link to={`/admin/eggs/${x.id}`}>{x.name}</Link>
                  ),
                },
                { label: "Author", render: (x) => x.author },
                { label: "Description", render: (x) => x.description },
              ]}
            />
          </Panel>
          <EggImport nestID={Number(id)} onSaved={q.reload} />
        </>
      )}
    </ResourceEditor>
  );
}
function EggImport({
  nestID,
  eggID,
  onSaved,
}: {
  nestID: number;
  eggID?: string;
  onSaved: () => void;
}) {
  const [json, setJSON] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  return (
    <Panel title={eggID ? "Replace from egg file" : "Import egg"}>
      <p className="muted">
        Import a Voltra-compatible egg JSON file with its installation script,
        configuration, variables, and Docker images.
      </p>
      <label className="field">
        Egg JSON file
        <input
          type="file"
          accept=".json,application/json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) setJSON(await file.text());
          }}
        />
      </label>
      <label className="field">
        Egg JSON
        <textarea
          rows={8}
          value={json}
          onChange={(e) => setJSON(e.target.value)}
          spellCheck={false}
        />
      </label>
      <ErrorMessage error={error} />
      {success && (
        <p className="success" role="status">
          {success}
        </p>
      )}
      <button
        disabled={busy || !json}
        onClick={async () => {
          setError("");
          setSuccess("");
          setBusy(true);
          try {
            const egg = JSON.parse(json);
            await api(
              eggID
                ? `${eggs}/${eggID}/import`
                : `${nests}/${nestID}/eggs/import`,
              { method: "POST", body: JSON.stringify({ egg }) }
            );
            setSuccess("Egg imported.");
            onSaved();
          } catch (err) {
            setError(String(err instanceof Error ? err.message : err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Importing…" : eggID ? "Replace egg" : "Import egg"}
      </button>
    </Panel>
  );
}
export function Egg() {
  const { id = "new" } = useParams();
  const navigate = useNavigate();
  const q = useAPI(id === "new" ? null : `${eggs}/${id}`);
  const nestsQ = useAPI(nests);
  const record = q.data ? unwrap(q.data) : undefined;
  const [tab, setTab] = useState("details");
  const [exportError, setExportError] = useState("");
  const fields = [
    f("nest_id", "Nest", "select", {
      required: true,
      disabled: id !== "new",
      default: new URLSearchParams(window.location.search).get("nest") ?? "",
      options: nestsQ.data
        ? rows(nestsQ.data).map((x) => ({ value: x.id, label: x.name }))
        : [],
    }),
    f("name", "Name", undefined, { required: true }),
    f("author", "Author email", "email", { required: true }),
    f("description", "Description", "textarea"),
    f("startup", "Startup command", "textarea", { required: true }),
    f("docker_images", "Docker images", "json", {
      default: { "Java 21": "ghcr.io/pterodactyl/yolks:java_21" },
      hint: "JSON object mapping display names to container images.",
    }),
    f("features", "Features", "json", { default: [] }),
    f("file_denylist", "File denylist", "json", { default: [] }),
    f("force_outgoing_ip", "Force outgoing IP", "checkbox"),
    f("update_url", "Update URL"),
  ];
  return (
    <>
      <Heading
        title={id === "new" ? "Create egg" : `Egg · ${record?.name ?? id}`}
      >
        <Link to={record ? `/admin/nests/${record.nest_id}` : "/admin/nests"}>
          Back to nest
        </Link>
        {id !== "new" && (
          <>
            <button
              className="secondary"
              onClick={async () => {
                try {
                  const data = await api(`${eggs}/${id}/export`);
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(
                    new Blob([JSON.stringify(data, null, 2)], {
                      type: "application/json",
                    })
                  );
                  a.download = `egg-${record?.name ?? id}.json`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                } catch (err) {
                  setExportError(String(err));
                }
              }}
            >
              Export egg
            </button>
            <Action
              path={`${eggs}/${id}`}
              method="DELETE"
              danger
              confirm="Delete this egg?"
              onDone={() => navigate("/admin/nests")}
            >
              Delete
            </Action>
          </>
        )}
      </Heading>
      <ErrorMessage error={q.error || exportError} />
      {id !== "new" && (
        <SidebarSection label="Egg settings" detail>
          {[
            "details",
            "configuration",
            "java",
            "variables",
            "installation",
            "import",
          ].map((t) => (
            <button
              className={tab === t ? "active" : "secondary"}
              key={t}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </SidebarSection>
      )}
      {q.loading ? (
        <p>Loading…</p>
      ) : (
        <>
          {tab === "details" && (
            <Editor
              fields={fields}
              endpoint={id === "new" ? eggs : `${eggs}/${id}`}
              initial={record}
              method={id === "new" ? "POST" : "PATCH"}
              submit={id === "new" ? "Create egg" : undefined}
              onSaved={(r) =>
                id === "new"
                  ? navigate(`/admin/eggs/${unwrap(r).id}`)
                  : q.reload()
              }
            />
          )}
          {record && tab === "configuration" && (
            <Editor
              title="Process and file configuration"
              endpoint={`${eggs}/${id}`}
              initial={record}
              fields={[
                f(
                  "config_from",
                  "Inherit configuration from egg ID",
                  "number",
                  { default: "" }
                ),
                f(
                  "config_files",
                  "Configuration files and replacements",
                  "json"
                ),
                f("config_startup", "Startup detection", "json"),
                f("config_logs", "Log configuration", "json"),
                f("config_stop", "Stop command"),
              ]}
              onSaved={q.reload}
            />
          )}
          {record && tab === "installation" && (
            <Editor
              title="Installation script"
              endpoint={`${eggs}/${id}/scripts`}
              initial={record}
              fields={[
                f(
                  "copy_script_from",
                  "Copy installation script from egg ID",
                  "number",
                  { default: "" }
                ),
                f("script_container", "Installer container image"),
                f("script_entry", "Installer entrypoint", undefined, {
                  default: "bash",
                }),
                f("script_install", "Installation script", "textarea"),
                f("script_is_privileged", "Privileged installer", "checkbox"),
              ]}
              onSaved={q.reload}
            />
          )}
          {record && tab === "variables" && <EggVariables eggID={id} />}
          {record && tab === "java" && (
            <JavaEgg eggID={id} config={record.java_config} onSaved={q.reload} />
          )}
          {record && tab === "import" && (
            <EggImport nestID={record.nest_id} eggID={id} onSaved={q.reload} />
          )}
        </>
      )}
    </>
  );
}
const variableFields = [
  f("name", "Name", undefined, { required: true }),
  f("description", "Description", "textarea"),
  f("env_variable", "Environment variable", undefined, { required: true }),
  f("default_value", "Default value"),
  f("rules", "Validation rules", undefined, {
    default: "required|string",
    hint: "Laravel validation rules, such as required|string|max:100.",
  }),
  f("user_viewable", "Visible to users", "checkbox", { default: true }),
  f("user_editable", "Editable by users", "checkbox", { default: true }),
  f("field_type", "Field type", undefined, { default: "text" }),
];
function EggVariables({ eggID }: { eggID: string }) {
  const endpoint = `${eggs}/${eggID}/variables`;
  const q = useAPI(endpoint);
  return (
    <>
      <ErrorMessage error={q.error} />
      {q.data &&
        rows(q.data).map((v) => (
          <div key={v.id}>
            <Editor
              title={v.name}
              endpoint={`${endpoint}/${v.id}`}
              fields={variableFields}
              initial={v}
              onSaved={q.reload}
            />
            <Action
              path={`${endpoint}/${v.id}`}
              method="DELETE"
              danger
              confirm={`Delete variable ${v.env_variable}?`}
              onDone={q.reload}
            >
              Delete variable
            </Action>
          </div>
        ))}
      <Editor
        title="New variable"
        endpoint={endpoint}
        method="POST"
        fields={variableFields}
        onSaved={q.reload}
        submit="Create variable"
      />
    </>
  );
}
