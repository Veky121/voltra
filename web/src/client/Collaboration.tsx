import { useEffect, useState } from "react";
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
    <section>
      <div className="toolbar">
        <h2>Databases</h2>
        <p className="muted">
          Limit: {server.feature_limits?.databases ?? "Unlimited"}
        </p>
        {can(permissions, "database.create") && (
          <Button onClick={() => setOpen(true)}>Create database</Button>
        )}
        <Button variant="secondary" onClick={r.reload}>
          Refresh
        </Button>
      </div>
      <Notice action={a} />
      <PageError error={r.error} />
      <div className="grid grid-2">
        {items(r.data).map((d) => {
          const password =
            value(d.relationships?.password)?.password || d.password || "";
          const host = `${d.host?.address || d.host?.host || d.host || ""}:${
            d.host?.port || 3306
          }`;
          return (
            <Card key={d.id}>
              <h3>{d.name || d.database}</h3>
              <Field label="Host">
                <Input readOnly value={host} />
              </Field>
              <Field label="Username">
                <Input readOnly value={d.username} />
              </Field>
              <p className="muted">
                Connections from: {d.connections_from || d.remote}
              </p>
              {can(permissions, "database.view_password") && (
                <>
                  <Field label="Password">
                    <Input
                      aria-label={`Password for ${d.name || d.database}`}
                      type={visible[d.id] ? "text" : "password"}
                      readOnly
                      value={password}
                    />
                  </Field>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setVisible((old) => ({ ...old, [d.id]: !old[d.id] }))
                    }
                  >
                    {visible[d.id] ? "Hide" : "Show"} password
                  </Button>
                </>
              )}
              <div className="actions">
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
            </Card>
          );
        })}
      </div>
      {!r.loading && !items(r.data).length && (
        <Card>No databases provisioned.</Card>
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
  minute: "*",
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
    <section>
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
      {items(r.data).map((s) => (
        <Card key={s.id}>
          <div className="toolbar">
            <h3>{s.name}</h3>
            <span className="badge">
              {s.is_processing
                ? "Processing"
                : s.is_active
                ? "Active"
                : "Disabled"}
            </span>
            <code>
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
          <div className="table-wrap">
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
        <Card>
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
            <div className="form-grid">
              {[
                ["minute", "Minute", "0–59"],
                ["hour", "Hour", "0–23"],
                ["day_of_month", "Day of month", "1–31"],
                ["month", "Month", "1–12"],
                ["day_of_week", "Day of week", "0–6"],
              ].map(([key, label, hint]) => (
                <Field
                  key={key}
                  label={label}
                  hint={`${hint}; * means every value`}
                >
                  <Input
                    required
                    value={editing[key]}
                    onChange={(e) =>
                      setEditing({ ...editing, [key]: e.target.value })
                    }
                  />
                </Field>
              ))}
            </div>
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
            <Button type="submit" disabled={a.busy}>
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
    <section>
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
      <div className="grid grid-2">
        {items(r.data).map((u) => (
          <Card key={u.uuid || u.id}>
            <h3>{u.username || u.email}</h3>
            <p>{u.email}</p>
            <p className="muted">
              {u.permissions?.length || 0} permissions · Created{" "}
              {date(u.created_at)}
            </p>
            <div className="actions">
              {can(permissions, "user.update") && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    setEditing({ ...u, permissions: u.permissions || [] })
                  }
                >
                  Edit permissions
                </Button>
              )}
              {can(permissions, "user.delete") && (
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
        <Card>
          No additional users. The server owner and administrators retain
          access.
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
