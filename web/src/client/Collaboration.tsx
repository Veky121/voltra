import { useEffect, useState } from "react";
import { ScheduleTiming } from "./ScheduleTiming";
import type { ScheduleCron } from "./scheduleTimingModel";
import {SettingsRow,SettingsSection} from '../ui/Settings';
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
  can,
  Check,
  date,
  items,
  json,
  Notice,
  PageError,
  ServerPageTitle,
  useAction,
  useServer,
  value,
} from "./common";
import type { RecordData } from "./common";

export function Databases() {
  const { base, permissions, server } = useServer();
  const r = useAPI(`${base}/databases?include=password`);
  const a = useAction();
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [remote, setRemote] = useState("%"),
    [visible, setVisible] = useState<Record<string, boolean>>({});
  return (
    <section className="operations-page databases-page">
      <div className="toolbar server-page-toolbar">
        <ServerPageTitle title="Databases" limit={server.feature_limits?.databases}/>
        {can(permissions, "database.create") && (
          <Button onClick={() => setOpen(true)}>Create database</Button>
        )}
        <Button variant="secondary" onClick={r.reload}>
          Refresh
        </Button>
      </div>
      <Notice action={a} />
      <PageError error={r.error} />
      {r.loading && <p className="operations-loading" role="status">Loading databases...</p>}
      <div className="grid grid-2">
        {items(r.data).map((d) => {
          const password =
            value(d.relationships?.password)?.password || d.password || "";
          const host = `${d.host?.address || d.host?.host || d.host || ""}:${
            d.host?.port || 3306
          }`;
          return (
            <SettingsSection key={d.id} title={d.name || d.database} className="operations-database">
              <SettingsRow label="Host" control={<Input aria-label={`Host for ${d.name || d.database}`} readOnly value={host} />}/>
              <SettingsRow label="Username" control={<Input aria-label={`Username for ${d.name || d.database}`} readOnly value={d.username} />}/>
              <SettingsRow label="Connections from" control={<span className="settings-value">{d.connections_from || d.remote}</span>}/>
              {can(permissions, "database.view_password") && (
                <SettingsRow label="Password" control={
                    <Input
                      aria-label={`Password for ${d.name || d.database}`}
                      type={visible[d.id] ? "text" : "password"}
                      readOnly
                      value={password}
                    />}>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setVisible((old) => ({ ...old, [d.id]: !old[d.id] }))
                    }
                  >
                    {visible[d.id] ? "Hide" : "Show"} password
                  </Button>
                </SettingsRow>
              )}
              <div className="settings-actions operations-record-actions">
                {can(permissions, "database.update") && (
                  <Button
                    variant="secondary"
                    disabled={a.busy}
                    onClick={() => {
                      if (
                        confirm(
                          "Rotate this database password? Update game configuration afterwards."
                        )
                      )
                        a.run(
                          () =>
                            api(
                              `${base}/databases/${d.id}/rotate-password`,
                              json("POST")
                            ),
                          () => {
                            r.reload();
                            a.setSuccess("Database password rotated.");
                          }
                        );
                    }}
                  >
                    Rotate password
                  </Button>
                )}
                {can(permissions, "database.delete") && (
                  <Button
                    variant="danger"
                    disabled={a.busy}
                    onClick={() => {
                      if (
                        confirm(
                          `Permanently delete database ${
                            d.name || d.database
                          } and all its data?`
                        )
                      )
                        a.run(
                          () =>
                            api(`${base}/databases/${d.id}`, json("DELETE")),
                          r.reload
                        );
                    }}
                  >
                    Delete database
                  </Button>
                )}
              </div>
            </SettingsSection>
          );
        })}
      </div>
      {!r.loading && !items(r.data).length && (
        <Card className="operations-empty">No databases provisioned.</Card>
      )}
      {open && (
        <Modal title="Create database" onClose={() => setOpen(false)}>
          <Notice action={a} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              a.run(
                () =>
                  api(
                    `${base}/databases?include=password`,
                    json("POST", { database: name, remote })
                  ),
                () => {
                  setOpen(false);
                  setName("");
                  r.reload();
                }
              );
            }}
          >
            <Field label="Database name">
              <Input
                required
                pattern="[A-Za-z0-9_]+"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field
              label="Connections from"
              hint="Use % to allow any source, or enter an IP address."
            >
              <Input
                required
                value={remote}
                onChange={(e) => setRemote(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={a.busy}>
              Create database
            </Button>
          </form>
        </Modal>
      )}
    </section>
  );
}

const emptySchedule = {
  name: "",
  minute: "0",
  hour: "*",
  day_of_month: "*",
  month: "*",
  day_of_week: "*",
  is_active: true,
  only_when_online: false,
};
export function Schedules() {
  const { base, permissions } = useServer();
  const r = useAPI(`${base}/schedules?include=tasks`);
  const a = useAction();
  useEffect(() => {
    const timer = setInterval(r.reload, 10000);
    return () => clearInterval(timer);
  }, [base]);
  const [editing, setEditing] = useState<RecordData | null>(null),
    [task, setTask] = useState<RecordData | null>(null);
  const saveSchedule = () =>
    a.run(
      () =>
        api(
          `${base}/schedules${editing?.id ? "/" + editing.id : ""}`,
          json("POST", editing)
        ),
      () => {
        r.reload();
        setEditing(null);
      }
    );
  const saveTask = () =>
    a.run(
      () =>
        api(
          `${base}/schedules/${task?.schedule_id}/tasks${
            task?.id ? "/" + task.id : ""
          }`,
          json("POST", {
            action: task?.action,
            payload: task?.payload,
            ...(task?.sequence_id
              ? { sequence_id: Number(task.sequence_id) }
              : {}),
            time_offset: Number(task?.time_offset || 0),
            continue_on_failure: !!task?.continue_on_failure,
          })
        ),
      () => {
        r.reload();
        setTask(null);
      }
    );
  return (
    <section className="operations-page schedules-page">
      <div className="toolbar server-page-toolbar">
        <h2>Schedules</h2>
        {can(permissions, "schedule.create") && (
          <Button onClick={() => setEditing({ ...emptySchedule })}>
            Create schedule
          </Button>
        )}
        <Button variant="secondary" onClick={r.reload}>
          Refresh
        </Button>
      </div>
      <Notice action={a} />
      <PageError error={r.error} />
      {r.loading && <p className="operations-loading" role="status">Loading schedules...</p>}
      {items(r.data).map((s) => (
        <Card key={s.id} className="operations-record schedule-record">
          <div className="toolbar operations-record-heading">
            <h3>{s.name}</h3>
            <span className={`badge ${s.is_processing ? 'operations-status-pending' : s.is_active ? 'operations-status-success' : ''}`}>
              {s.is_processing
                ? "Processing"
                : s.is_active
                ? "Active"
                : "Disabled"}
            </span>
            <code className="schedule-cron">
              {s.cron?.minute || s.cron_minute} {s.cron?.hour || s.cron_hour}{" "}
              {s.cron?.day_of_month || s.cron_day_of_month}{" "}
              {s.cron?.month || s.cron_month}{" "}
              {s.cron?.day_of_week || s.cron_day_of_week}
            </code>
            <div className="actions">
              {can(permissions, "schedule.update") && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    setEditing({
                      id: s.id,
                      name: s.name,
                      is_active: s.is_active,
                      only_when_online: s.only_when_online,
                      ...Object.fromEntries(
                        [
                          "minute",
                          "hour",
                          "day_of_month",
                          "month",
                          "day_of_week",
                        ].map((k) => [k, s.cron?.[k] || s["cron_" + k] || "*"])
                      ),
                    })
                  }
                >
                  Edit schedule
                </Button>
              )}
              {can(permissions, "schedule.update") && (
                <Button
                  variant="secondary"
                  disabled={a.busy || s.is_processing}
                  onClick={() =>
                    a.run(
                      () =>
                        api(`${base}/schedules/${s.id}/execute`, json("POST")),
                      () => {
                        r.reload();
                        a.setSuccess("Schedule execution requested.");
                      }
                    )
                  }
                >
                  Run now
                </Button>
              )}
              {can(permissions, "schedule.delete") && (
                <Button
                  variant="danger"
                  disabled={a.busy}
                  onClick={() => {
                    if (confirm(`Delete schedule ${s.name} and all its tasks?`))
                      a.run(
                        () => api(`${base}/schedules/${s.id}`, json("DELETE")),
                        r.reload
                      );
                  }}
                >
                  Delete
                </Button>
              )}
            </div>
          </div>
          <p className="muted">
            Last run: {date(s.last_run_at)} · Next run: {date(s.next_run_at)}
            {s.only_when_online ? " · Only when online" : ""}
          </p>
          <div className="table-wrap operations-table schedule-tasks">
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Action</th>
                  <th>Payload</th>
                  <th>Delay</th>
                  <th>Failure behavior</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items(s.relationships?.tasks || s.tasks)
                  .sort((a, b) => a.sequence_id - b.sequence_id)
                  .map((t) => (
                    <tr key={t.id}>
                      <td>{t.sequence_id}</td>
                      <td>
                        {t.action}
                        {t.is_queued && <span className="badge">Queued</span>}
                      </td>
                      <td>
                        <pre>{t.payload}</pre>
                      </td>
                      <td>{t.time_offset}s</td>
                      <td>
                        {t.continue_on_failure ? "Continue" : "Stop schedule"}
                      </td>
                      <td>
                        {can(permissions, "schedule.update") && (
                          <div className="actions">
                            <Button
                              variant="secondary"
                              onClick={() =>
                                setTask({ ...t, schedule_id: s.id })
                              }
                            >
                              Edit
                            </Button>
                            <Button
                              variant="danger"
                              disabled={a.busy}
                              onClick={() => {
                                if (confirm("Delete this task?"))
                                  a.run(
                                    () =>
                                      api(
                                        `${base}/schedules/${s.id}/tasks/${t.id}`,
                                        json("DELETE")
                                      ),
                                    r.reload
                                  );
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {can(permissions, "schedule.update") && (
            <Button
              variant="secondary"
              onClick={() =>
                setTask({
                  schedule_id: s.id,
                  action: "command",
                  payload: "",
                  time_offset: 0,
                  continue_on_failure: false,
                })
              }
            >
              Add task
            </Button>
          )}
        </Card>
      ))}
      {!r.loading && !items(r.data).length && (
        <Card className="operations-empty">
          No schedules configured. Add a schedule to automate commands, power
          actions, or backups.
        </Card>
      )}
      {editing && (
        <Modal
          title={editing.id ? "Edit schedule" : "Create schedule"}
          onClose={() => setEditing(null)}
        >
          <Notice action={a} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveSchedule();
            }}
          >
            <Field label="Name">
              <Input
                required
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </Field>
            <ScheduleTiming value={editing as ScheduleCron} onChange={cron => setEditing({ ...editing, ...cron })} />
            <Check
              label="Schedule enabled"
              checked={editing.is_active}
              onChange={(v) => setEditing({ ...editing, is_active: v })}
            />
            <Check
              label="Only run when server is online"
              checked={editing.only_when_online}
              onChange={(v) => setEditing({ ...editing, only_when_online: v })}
            />
            <Button type="submit" disabled={a.busy || !editing.day_of_week.trim()}>
              Save schedule
            </Button>
          </form>
        </Modal>
      )}
      {task && (
        <Modal
          title={task.id ? "Edit task" : "Add task"}
          onClose={() => setTask(null)}
        >
          <Notice action={a} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveTask();
            }}
          >
            <Field label="Action">
              <Select
                value={task.action}
                onChange={(e) =>
                  setTask({ ...task, action: e.target.value, payload: "" })
                }
              >
                <option value="command">Send command</option>
                <option value="power">Power action</option>
                <option value="backup">Create backup</option>
              </Select>
            </Field>
            <Field
              label={
                task.action === "backup"
                  ? "Ignored files (one per line)"
                  : "Payload"
              }
            >
              {task.action === "power" ? (
                <Select
                  required
                  value={task.payload}
                  onChange={(e) =>
                    setTask({ ...task, payload: e.target.value })
                  }
                >
                  <option value="">Choose action</option>
                  {["start", "stop", "restart", "kill"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              ) : (
                <Textarea
                  required={task.action === "command"}
                  rows={4}
                  value={task.payload}
                  onChange={(e) =>
                    setTask({ ...task, payload: e.target.value })
                  }
                />
              )}
            </Field>
            {task.id && (
              <Field label="Task order">
                <Input
                  type="number"
                  required
                  min={1}
                  max={10}
                  value={task.sequence_id}
                  onChange={(e) =>
                    setTask({ ...task, sequence_id: Number(e.target.value) })
                  }
                />
              </Field>
            )}
            <Field label="Delay after previous task (seconds)">
              <Input
                type="number"
                required
                min={0}
                max={900}
                value={task.time_offset}
                onChange={(e) =>
                  setTask({ ...task, time_offset: e.target.value })
                }
              />
            </Field>
            <Check
              label="Continue remaining tasks if this task fails"
              checked={task.continue_on_failure}
              onChange={(v) => setTask({ ...task, continue_on_failure: v })}
            />
            <Button type="submit" disabled={a.busy}>
              Save task
            </Button>
          </form>
        </Modal>
      )}
    </section>
  );
}

export function Users() {
  const { base, permissions } = useServer();
  const r = useAPI(`${base}/users`);
  const p = useAPI("/api/client/permissions");
  const a = useAction();
  const [editing, setEditing] = useState<RecordData | null>(null);
  const permissionGroups = value(p.data)?.permissions || value(p.data) || {};
  const groups = Object.entries(permissionGroups).filter(
    ([, v]) => typeof v === "object" && v !== null
  ) as [string, any][];
  return (
    <section className="operations-page server-users-page">
      <div className="toolbar server-page-toolbar">
        <h2>Server users</h2>
        {can(permissions, "user.create") && (
          <Button onClick={() => setEditing({ email: "", permissions: [] })}>
            Add user
          </Button>
        )}
        <Button variant="secondary" onClick={r.reload}>
          Refresh
        </Button>
      </div>
      <Notice action={a} />
      <PageError error={r.error} />
      <PageError error={p.error} />
      {r.loading && <p className="operations-loading" role="status">Loading users...</p>}
      <div className="grid grid-2">
        {items(r.data).map((u) => (
          <Card key={u.uuid || u.id} className="operations-record">
            <h3>{u.username || u.email}{u.is_current_user && ' (you)'}</h3>
            <p>{u.email}</p>
            <p className="muted">
              {u.inherited_access ? `${u.is_owner ? 'Server owner' : 'Administrator'} · Full access` : `${u.permissions?.length || 0} permissions`} · Created{" "}
              {date(u.created_at)}
            </p>
            <div className="actions operations-record-actions">
              {!u.inherited_access && can(permissions, "user.update") && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    setEditing({ ...u, permissions: u.permissions || [] })
                  }
                >
                  Edit permissions
                </Button>
              )}
              {!u.inherited_access && can(permissions, "user.delete") && (
                <Button
                  variant="danger"
                  disabled={a.busy}
                  onClick={() => {
                    if (
                      confirm(
                        `Remove ${u.email || u.username} from this server?`
                      )
                    )
                      a.run(
                        () =>
                          api(
                            `${base}/users/${u.uuid || u.id}`,
                            json("DELETE")
                          ),
                        r.reload
                      );
                  }}
                >
                  Remove user
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
      {!r.loading && !items(r.data).length && (
        <Card className="operations-empty">
          No users found.
        </Card>
      )}
      {editing && (
        <Modal
          title={
            editing.uuid || editing.id
              ? "Edit user permissions"
              : "Add server user"
          }
          onClose={() => setEditing(null)}
        >
          <Notice action={a} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              a.run(
                () =>
                  api(
                    `${base}/users${
                      editing.uuid || editing.id
                        ? "/" + (editing.uuid || editing.id)
                        : ""
                    }`,
                    json("POST", {
                      email: editing.email,
                      permissions: editing.permissions,
                    })
                  ),
                () => {
                  r.reload();
                  setEditing(null);
                }
              );
            }}
          >
            <Field label="Account email">
              <Input
                type="email"
                required
                disabled={!!(editing.uuid || editing.id)}
                value={editing.email || ""}
                onChange={(e) =>
                  setEditing({ ...editing, email: e.target.value })
                }
              />
            </Field>
            <p className="muted">
              Select the actions this account can perform on this server.
              Enable file.sftp to let them connect using their own SFTP password or SSH key.
            </p>
            {groups.map(([group, info]) => {
              const keys = Object.entries(
                info.keys || info.permissions || {}
              ).map(([k, v]) => ({
                key: `${group}.${k}`,
                description: String(
                  typeof v === "object" ? (v as any)?.description || k : v
                ),
              }));
              const allowed = keys.filter((k) => can(permissions, k.key));
              return (
                <fieldset key={group} className="permission-group">
                  <legend>{group}</legend>
                  <p className="muted">{info.description}</p>
                  {allowed.length > 0 && (
                    <Check
                      label="Select all in this group"
                      checked={allowed.every((k) =>
                        editing.permissions.includes(k.key)
                      )}
                      onChange={(v) =>
                        setEditing({
                          ...editing,
                          permissions: v
                            ? Array.from(
                                new Set([
                                  ...editing.permissions,
                                  ...allowed.map((k) => k.key),
                                ])
                              )
                            : editing.permissions.filter(
                                (key: string) =>
                                  !allowed.some((k) => k.key === key)
                              ),
                        })
                      }
                    />
                  )}
                  <div className="grid grid-2">
                    {keys.map((k) => (
                      <Check
                        key={k.key}
                        label={`${k.key}: ${k.description}`}
                        checked={editing.permissions.includes(k.key)}
                        disabled={!can(permissions, k.key)}
                        onChange={(v) =>
                          setEditing({
                            ...editing,
                            permissions: v
                              ? [...editing.permissions, k.key]
                              : editing.permissions.filter(
                                  (p: string) => p !== k.key
                                ),
                          })
                        }
                      />
                    ))}
                  </div>
                </fieldset>
              );
            })}
            <Button type="submit" disabled={a.busy || p.loading}>
              Save user
            </Button>
          </form>
        </Modal>
      )}
    </section>
  );
}
