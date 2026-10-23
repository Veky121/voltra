import { useEffect, useState } from "react";
import { JavaSettings } from "./JavaSettings";
import { ProxyEndpoints } from "./ProxyEndpoints";
import {
  api,
  useAPI,
  Button,
  Input,
  Textarea,
  Select,
  Field,
  Card,
  Modal,
} from "../lib";
import {
  bytes,
  can,
  Check,
  date,
  download,
  items,
  json,
  Notice,
  PageError,
  Pager,
  useAction,
  useServer,
  value,
} from "./common";

export function Backups() {
  const { base, permissions, server } = useServer();
  const [page, setPage] = useState(1);
  const r = useAPI(`${base}/backups?page=${page}&per_page=20`);
  const a = useAction();
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [ignored, setIgnored] = useState(""),
    [locked, setLocked] = useState(false),
    [restore, setRestore] = useState<any>(null),
    [truncate, setTruncate] = useState(false);
  useEffect(() => {
    const t = setInterval(r.reload, 10000);
    return () => clearInterval(t);
  }, [base, page]);
  const perform = (id: string, action: string, body?: any, method = "POST") =>
    a.run(
      () =>
        api(
          `${base}/backups/${id}${action ? "/" + action : ""}`,
          json(method, body)
        ),
      () => {
        r.reload();
        setRestore(null);
      }
    );
  return (
    <section>
      <div className="toolbar server-page-toolbar">
        <h2>Backups</h2>
        <p className="muted">
          Limit: {server.feature_limits?.backups ?? "Unlimited"}
        </p>
        <Button variant="secondary" onClick={r.reload}>
          Refresh
        </Button>
        {can(permissions, "backup.create") && (
          <Button onClick={() => setOpen(true)}>Create backup</Button>
        )}
      </div>
      <Notice action={a} />
      <PageError error={r.error} />
      {r.loading && <p role="status">Loading backups...</p>}
      <div className="grid grid-2">
        {items(r.data).map((b) => (
          <Card key={b.uuid}>
            <div className="toolbar">
              <h3>{b.name}</h3>
              <span className="badge">
                {b.is_locked ? "Locked · " : ""}
                {b.completed_at
                  ? b.is_successful
                    ? "Completed"
                    : "Failed"
                  : "In progress"}
              </span>
            </div>
            <p className="muted">
              {date(b.created_at)} · {bytes(b.bytes)}
            </p>
            <small>
              <code>{b.uuid}</code>
            </small>
            {b.checksum && (
              <details>
                <summary>Checksum</summary>
                <code>{b.checksum}</code>
              </details>
            )}
            <div className="actions">
              {can(permissions, "backup.download") && b.is_successful && (
                <Button
                  variant="secondary"
                  disabled={a.busy}
                  onClick={() =>
                    a.run(() => download(`${base}/backups/${b.uuid}/download`))
                  }
                >
                  Download
                </Button>
              )}
              {can(permissions, "backup.restore") && b.is_successful && (
                <Button
                  variant="secondary"
                  disabled={a.busy}
                  onClick={() => {
                    setRestore(b);
                    setTruncate(false);
                  }}
                >
                  Restore
                </Button>
              )}
              {can(permissions, "backup.delete") && (
                <>
                  <Button
                    variant="secondary"
                    disabled={a.busy}
                    onClick={() => perform(b.uuid, "lock")}
                  >
                    {b.is_locked ? "Unlock" : "Lock"}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={a.busy || b.is_locked}
                    onClick={() => {
                      if (confirm(`Permanently delete backup ${b.name}?`))
                        perform(b.uuid, "", undefined, "DELETE");
                    }}
                  >
                    Delete
                  </Button>
                </>
              )}
            </div>
          </Card>
        ))}
      </div>
      {!r.loading && !items(r.data).length && (
        <Card>No backups have been created.</Card>
      )}
      <Pager data={r.data} page={page} setPage={setPage} />
      {open && (
        <Modal title="Create backup" onClose={() => setOpen(false)}>
          <Notice action={a} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              a.run(
                () =>
                  api(
                    `${base}/backups`,
                    json("POST", { name, ignored, is_locked: locked })
                  ),
                () => {
                  setOpen(false);
                  setName("");
                  r.reload();
                }
              );
            }}
          >
            <Field label="Name (optional)">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field
              label="Ignored files"
              hint="One file or glob per line. Leave empty to use .pteroignore."
            >
              <Textarea
                rows={5}
                value={ignored}
                onChange={(e) => setIgnored(e.target.value)}
              />
            </Field>
            <Check
              label="Lock backup against deletion"
              checked={locked}
              onChange={setLocked}
            />
            <Button type="submit" disabled={a.busy}>
              Start backup
            </Button>
          </form>
        </Modal>
      )}
      {restore && (
        <Modal
          title={`Restore ${restore.name}`}
          onClose={() => setRestore(null)}
        >
          <Notice action={a} />
          <p>
            The server will stop. Existing files may be overwritten by this
            backup.
          </p>
          <Check
            label="Delete all existing files before restoring"
            checked={truncate}
            onChange={setTruncate}
          />
          <Button
            variant="danger"
            disabled={a.busy}
            onClick={() => perform(restore.uuid, "restore", { truncate })}
          >
            Restore backup
          </Button>
        </Modal>
      )}
    </section>
  );
}

export function Network() {
  const { base, permissions, server } = useServer();
  const r = useAPI(`${base}/network/allocations`);
  const a = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const perform = (path: string, body?: any, method = "POST") =>
    a.run(
      () => api(`${base}/network/allocations${path}`, json(method, body)),
      r.reload
    );
  return (
    <section>
      <ProxyEndpoints base={base} />
      <div className="toolbar">
        <h2>Network allocations</h2>
        <p className="muted">
          Limit: {server.feature_limits?.allocations ?? "Unlimited"}
        </p>
        {can(permissions, "allocation.create") && (
          <Button disabled={a.busy} onClick={() => perform("")}>
            Assign allocation
          </Button>
        )}
        <Button variant="secondary" onClick={r.reload}>
          Refresh
        </Button>
      </div>
      <Notice action={a} />
      <PageError error={r.error} />
      <div className="grid grid-2">
        {items(r.data).map((n) => (
          <Card key={n.id}>
            <h3>
              {n.ip_alias || n.alias || n.ip}:{n.port}{" "}
              {n.is_default && <span className="badge">Primary</span>}
            </h3>
            {(n.ip_alias || n.alias) && (
              <p className="muted">
                {n.ip}:{n.port}
              </p>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                perform(`/${n.id}`, { notes: notes[n.id] ?? n.notes ?? "" });
              }}
            >
              <Field label="Notes">
                <Input
                  disabled={!can(permissions, "allocation.update")}
                  value={notes[n.id] ?? n.notes ?? ""}
                  maxLength={255}
                  onChange={(e) =>
                    setNotes((old) => ({ ...old, [n.id]: e.target.value }))
                  }
                />
              </Field>
              <div className="actions">
                {can(permissions, "allocation.update") && (
                  <>
                    <Button type="submit" disabled={a.busy}>
                      Save notes
                    </Button>
                    {!n.is_default && (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={a.busy}
                        onClick={() => perform(`/${n.id}/primary`)}
                      >
                        Make primary
                      </Button>
                    )}
                  </>
                )}
                {!n.is_default && can(permissions, "allocation.delete") && (
                  <Button
                    type="button"
                    variant="danger"
                    disabled={a.busy}
                    onClick={() => {
                      if (confirm(`Unassign ${n.ip}:${n.port}?`))
                        perform(`/${n.id}`, undefined, "DELETE");
                    }}
                  >
                    Unassign
                  </Button>
                )}
              </div>
            </form>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Variable({
  variable,
  onSave,
  busy,
  editable,
}: {
  variable: any;
  onSave: (key: string, val: string) => void;
  busy: boolean;
  editable: boolean;
}) {
  const [v, setV] = useState(
    String(
      variable.server_value ??
        variable.variable_value ??
        variable.default_value ??
        ""
    )
  );
  useEffect(
    () =>
      setV(
        String(
          variable.server_value ??
            variable.variable_value ??
            variable.default_value ??
            ""
        )
      ),
    [variable.server_value, variable.variable_value]
  );
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(variable.env_variable, v);
        }}
      >
        <Field
          label={variable.name || variable.env_variable}
          hint={variable.description}
        >
          <Input
            value={v}
            disabled={
              !editable ||
              (!variable.is_editable && variable.is_editable !== undefined) ||
              variable.user_editable === false
            }
            onChange={(e) => setV(e.target.value)}
          />
        </Field>
        <p className="muted">
          <code>{variable.env_variable}</code> · {variable.rules}
        </p>
        {editable &&
          variable.is_editable !== false &&
          variable.user_editable !== false && (
            <Button type="submit" disabled={busy}>
              Save variable
            </Button>
          )}
      </form>
    </Card>
  );
}
export function Startup() {
  const { base, permissions, reload, server } = useServer();
  const r = useAPI(`${base}/startup`);
  const a = useAction();
  const [image, setImage] = useState(server.docker_image || server.image || "");
  const meta = r.data?.meta || value(r.data) || {};
  const images = meta.docker_images || {};
  return (
    <section>
      <h2>Startup configuration</h2>
      {can(permissions, "startup.read") && (
        <JavaSettings key={base} base={base} memoryMiB={server.limits?.memory ?? server.memory} canChangeRuntime={can(permissions, "startup.docker-image")} onSaved={() => { r.reload(); reload(); }} />
      )}
      <Notice action={a} />
      <PageError error={r.error} />
      <Card>
        <h3>Startup command</h3>
        <pre>{meta.startup_command || server.invocation || server.startup}</pre>
        <p className="muted">Changes take effect when the server restarts.</p>
      </Card>
      {!meta.java_managed && <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            a.run(
              () =>
                api(
                  `${base}/settings/docker-image`,
                  json("PUT", { docker_image: image })
                ),
              () => {
                r.reload();
                reload();
                a.setSuccess("Docker image updated.");
              }
            );
          }}
        >
          <Field label="Docker image">
            {Object.keys(images).length ? (
              <Select
                value={image}
                disabled={!can(permissions, "startup.docker-image")}
                onChange={(e) => setImage(e.target.value)}
              >
                {Object.entries(images).map(([name, v]) => (
                  <option key={String(v)} value={String(v)}>
                    {name} · {String(v)}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                value={image}
                disabled={!can(permissions, "startup.docker-image")}
                onChange={(e) => setImage(e.target.value)}
              />
            )}
          </Field>
          {can(permissions, "startup.docker-image") && (
            <Button type="submit" disabled={a.busy}>
              Change Docker image
            </Button>
          )}
        </form>
      </Card>}
      <div className="grid grid-2">
        {items(r.data).map((v) => (
          <Variable
            key={v.env_variable}
            variable={v}
            busy={a.busy}
            editable={can(permissions, "startup.update")}
            onSave={(key, val) =>
              a.run(
                () =>
                  api(
                    `${base}/startup/variable`,
                    json("PUT", { key, value: val })
                  ),
                () => {
                  r.reload();
                  a.setSuccess(`${key} updated.`);
                }
              )
            }
          />
        ))}
      </div>
    </section>
  );
}

export function Settings() {
  const { base, server, permissions, reload } = useServer();
  const account = useAPI("/api/client/account");
  const a = useAction();
  const [name, setName] = useState(server.name || ""),
    [description, setDescription] = useState(server.description || "");
  const user = value(account.data) || {};
  const sftp = server.sftp_details || {};
  return (
    <section>
      <h2>Server settings</h2>
      <Notice action={a} />
      <div className="grid grid-2">
        <Card>
          <h3>Server details</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              a.run(
                () =>
                  api(
                    `${base}/settings/rename`,
                    json("POST", { name, description })
                  ),
                () => {
                  reload();
                  a.setSuccess("Server details saved.");
                }
              );
            }}
          >
            <Field label="Name">
              <Input
                required
                disabled={!can(permissions, "settings.rename")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Description">
              <Textarea
                disabled={!can(permissions, "settings.rename")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            {can(permissions, "settings.rename") && (
              <Button type="submit" disabled={a.busy}>
                Save details
              </Button>
            )}
          </form>
        </Card>
        <Card>
          <h3>SFTP connection</h3>
          <Field label="Address">
            <Input
              readOnly
              value={`sftp://${sftp.ip || server.node}:${sftp.port || 2022}`}
            />
          </Field>
          <Field label="Username">
            <Input
              readOnly
              value={`${user.username || ""}.${server.identifier || ""}`}
            />
          </Field>
          <p className="muted">
            Add an SSH public key in your account to connect with an SFTP
            client.
          </p>
          {can(permissions, "file.sftp") && (
            <a
              className="button secondary"
              href={`sftp://${encodeURIComponent(
                `${user.username || ""}.${server.identifier || ""}`
              )}@${sftp.ip || server.node}:${sftp.port || 2022}`}
            >
              Launch SFTP client
            </a>
          )}
          <h3>Server information</h3>
          <p>Node: {server.node}</p>
          <Field label="Server UUID">
            <Input readOnly value={server.uuid || ""} />
          </Field>
        </Card>
        {can(permissions, "settings.reinstall") && (
          <Card>
            <h3 className="danger">Reinstall server</h3>
            <p>
              The server will stop and its installation script will run again.
              Existing files may be overwritten. Create a backup before
              continuing.
            </p>
            <Button
              variant="danger"
              disabled={a.busy}
              onClick={() => {
                if (
                  confirm(
                    `Reinstall ${server.name}? Installation scripts can overwrite existing files.`
                  )
                )
                  a.run(
                    () => api(`${base}/settings/reinstall`, json("POST")),
                    () => {
                      reload();
                      a.setSuccess("Reinstallation requested.");
                    }
                  );
              }}
            >
              Reinstall server
            </Button>
          </Card>
        )}
      </div>
    </section>
  );
}
