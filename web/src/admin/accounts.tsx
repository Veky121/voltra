import { useState } from "react";
import SFTPPassword from '../client/SFTPPassword';
import { Link, useParams } from "react-router-dom";
import {
  Action,
  DataTable,
  Editor,
  ErrorMessage,
  Heading,
  Panel,
  ResourceEditor,
  ResourceList,
  f,
  rows,
  useAPI,
} from "./shared";

const userFields = [
  f("username", "Username", undefined, { required: true }),
  f("email", "Contact email", "email", { required: true }),
  f("first_name", "First name", undefined, { required: true }),
  f("last_name", "Last name", undefined, { required: true }),
  f("language", "Language", undefined, { default: "en" }),
  f("root_admin", "Administrator", "checkbox"),
  f("disabled", "Account disabled", "checkbox"),
  f("external_id", "External ID"),
];
export function Users() {
  return (
    <ResourceList
      title="Users"
      endpoint="/api/application/users"
      base="/admin/users"
      columns={["username", "email", "root_admin", "disabled"]}
    />
  );
}
export function User() {
  const { id = "new" } = useParams();
  const servers = useAPI(
    id === "new" ? null : "/api/application/servers?per_page=100"
  );
  return (
    <ResourceEditor
      title="User"
      id={id}
      endpoint="/api/application/users"
      base="/admin/users"
      fields={userFields}
    >
      {() => (<>
        <SFTPPassword key={id} userID={id}/>
        <Panel title="Owned servers">
          <ErrorMessage error={servers.error} />
          <DataTable
            loading={servers.loading}
            empty="This user has no owned servers."
            data={
              servers.data
                ? rows(servers.data).filter(
                    (x) => String(x.user ?? x.owner_id) === id
                  )
                : []
            }
            columns={[
              {
                label: "Server",
                render: (x) => (
                  <Link to={`/admin/servers/${x.id}`}>{x.name}</Link>
                ),
              },
              { label: "Status", render: (x) => x.status ?? "Ready" },
            ]}
          />
        </Panel></>
      )}
    </ResourceEditor>
  );
}
export function ApplicationKeys() {
  const q = useAPI("/api/admin/api-keys");
  const [secret, setSecret] = useState("");
  return (
    <div className="admin-management-page management-ui">
      <Heading title="Application API keys" />
      <p className="muted">
        Application keys grant automation access to panel administration. Secret
        tokens are shown once.
      </p>
      <ErrorMessage error={q.error} />
      {secret && (
        <Panel title="New secret token" className="admin-secret-panel">
          <p className="muted">Copy this token now. It will only be shown once.</p>
          <code className="admin-secret">{secret}</code>
          <div className="actions">
          <button
            className="secondary"
            onClick={() => navigator.clipboard.writeText(secret)}
          >
            Copy token
          </button>
          <button className="secondary" onClick={() => setSecret("")}>
            Dismiss
          </button>
          </div>
        </Panel>
      )}
      <Panel>
        <DataTable
          loading={q.loading}
          empty="No application keys yet."
          data={q.data ? rows(q.data) : []}
          columns={[
            { label: "Identifier", render: (x) => x.identifier },
            { label: "Description", render: (x) => x.description ?? x.memo },
            { label: "Last used", render: (x) => x.last_used_at ?? "Never" },
            {
              label: "Actions",
              render: (x) => (
                <Action
                  path={`/api/admin/api-keys/${x.identifier}`}
                  method="DELETE"
                  danger
                  confirm="Revoke this key immediately?"
                  onDone={q.reload}
                >
                  Revoke
                </Action>
              ),
            },
          ]}
        />
      </Panel>
      <Editor
        title="Create application key"
        endpoint="/api/admin/api-keys"
        method="POST"
        fields={[
          f("description", "Description", undefined, { required: true }),
          f("allowed_ips", "Allowed IP addresses and CIDR ranges", "json", {
            default: [],
          }),
          f("permissions", "Permission scopes", "json", {
            default: {
              servers: 3,
              nodes: 3,
              allocations: 3,
              users: 3,
              locations: 3,
              nests: 3,
              eggs: 3,
              database_hosts: 3,
              server_databases: 3,
              mounts: 3,
              settings: 3,
            },
            hint: "Each scope uses 0 for none, 1 for read, 2 for write, or 3 for read and write.",
          }),
        ]}
        onSaved={(r) => {
          setSecret(r.meta?.secret_token ?? r.attributes?.secret_token ?? "");
          q.reload();
        }}
        submit="Create key"
      />
    </div>
  );
}
