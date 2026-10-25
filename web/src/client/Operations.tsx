import { useEffect, useState } from "react";
import { JavaSettings } from "./JavaSettings";
import { ProxyEndpoints } from "./ProxyEndpoints";
import {SettingsRow,SettingsSection} from '../ui/Settings';
import {Link} from 'react-router-dom';
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
  ServerPageTitle,
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
    <section className="operations-page backups-page">
      <div className="toolbar server-page-toolbar">
        <ServerPageTitle title="Backups" limit={server.feature_limits?.backups}/>
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
          <Card key={b.uuid} className="operations-record">
            <div className="toolbar operations-record-heading">
              <h3>{b.name}</h3>
              <span className={`badge ${b.completed_at ? b.is_successful ? 'operations-status-success' : 'operations-status-error' : 'operations-status-pending'}`}>
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
            <div className="actions operations-record-actions">
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
        <Card className="operations-empty">No backups have been created.</Card>
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
          <p className="operations-warning">
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
    <section className="operations-page network-page">
      <ProxyEndpoints base={base} />
      <div className="toolbar server-page-toolbar">
        <ServerPageTitle title="Network allocations" limit={server.feature_limits?.allocations}/>
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
      {r.loading && <p className="operations-loading" role="status">Loading allocations...</p>}
      <div className="grid grid-2">
        {items(r.data).map((n) => (
          <Card key={n.id} className="operations-record">
            <h3>
              {n.ip_alias || n.alias || n.ip}:{n.port}{" "}
              {n.is_default && <span className="badge operations-status-accent">Primary</span>}
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
              <div className="actions operations-record-actions">
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
      {!r.loading && !items(r.data).length && <Card className="operations-empty">No allocations assigned.</Card>}
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
    <section className="operations-page settings-page server-general-settings">
      <Notice action={a} />
      <div className="server-general-grid">
        <SettingsSection title="Server details">
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
            <SettingsRow label="Name" control={
              <Input
                aria-label="Server name"
                required
                disabled={!can(permissions, "settings.rename")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            }/>
            <SettingsRow label="Description" control={
              <Textarea
                aria-label="Server description"
                disabled={!can(permissions, "settings.rename")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            }/>
            {can(permissions, "settings.rename") && (
              <div className="settings-actions">
              <Button type="submit" disabled={a.busy}>
                Save
              </Button>
              </div>
            )}
          </form>
        </SettingsSection>
        <SettingsSection title="SFTP">
          <SettingsRow label="Address" control={
            <Input
              aria-label="SFTP address"
              readOnly
              value={`sftp://${sftp.ip || server.node}:${sftp.port || 2022}`}
            />
          }/>
          <SettingsRow label="Username" control={
            <Input
              aria-label="SFTP username"
              readOnly
              value={`${user.username || ""}.${server.__deprecated_uuid_short || server.uuid?.slice(0,8) || server.identifier || ""}`}
            />
          }/>
          <div className="settings-actions settings-actions--split"><span className="settings-note"><Link to="/account/sftp">Password</Link> · <Link to="/account/ssh">SSH keys</Link></span>
          {can(permissions, "file.sftp") && (
            <a
              className="button secondary"
              href={`sftp://${encodeURIComponent(
                `${user.username || ""}.${server.__deprecated_uuid_short || server.uuid?.slice(0,8) || server.identifier || ""}`
              )}@${sftp.ip || server.node}:${sftp.port || 2022}`}
            >
              Open client
            </a>
          )}
          </div>
        </SettingsSection>
        <SettingsSection title="Server information">
          <SettingsRow label="Node" control={<span className="settings-value">{server.node}</span>}/>
          <SettingsRow label="UUID" control={<Input aria-label="Server UUID" readOnly value={server.uuid || ""} />}/>
        </SettingsSection>
        {can(permissions, "settings.reinstall") && (
          <SettingsSection title="Reinstall">
            <SettingsRow label="Reinstall server" description="Stops the server and may overwrite files. Back up first." control={
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
            }/>
          </SettingsSection>
        )}
      </div>
    </section>
  );
}
