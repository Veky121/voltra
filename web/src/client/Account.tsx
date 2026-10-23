import {DesktopAppInfo} from '../desktop';
import {NavIcon} from "../Icons";
import DesktopApps from "./DesktopApps";
import { useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import {
  api,
  useAPI,
  useTranslation,
  Button,
  Input,
  Textarea,
  Field,
  Card,
} from "../lib";
import {
  date,
  items,
  json,
  Notice,
  PageError,
  Pager,
  useAction,
  value,
} from "./common";

export function Activity({ path }: { path: string }) {
  const t = useTranslation("activity");
  const [event, setEvent] = useState(""),
    [ip, setIP] = useState(""),
    [page, setPage] = useState(1);
  const r = useAPI(
    `${path}?page=${page}&per_page=25&include=actor&sort=-timestamp&filter[event]=${encodeURIComponent(
      event
    )}&filter[ip]=${encodeURIComponent(ip)}`
  );
  return (
    <section>
      <div className="toolbar server-page-toolbar">
        <h2>Activity</h2>
        <Button variant="secondary" onClick={r.reload}>
          Refresh
        </Button>
      </div>
      <div className="toolbar">
        <Input
          aria-label="Filter events"
          value={event}
          placeholder="Filter events"
          onChange={(e) => {
            setEvent(e.target.value);
            setPage(1);
          }}
        />
        <Input
          aria-label="Filter IP address"
          value={ip}
          placeholder="Filter IP address"
          onChange={(e) => {
            setIP(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <PageError error={r.error} />
      {r.loading && <p role="status">Loading activity...</p>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Actor</th>
              <th>IP address</th>
              <th>When</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {items(r.data).map((a, i) => (
              <tr key={a.id || i}>
                <td>
                  <div>
                    {t(
                      a.event.replace(":", "."),
                      a.properties || {},
                      a.description || a.event
                    )}
                  </div>
                  <small className="muted">
                    <code>{a.event}</code>
                  </small>
                </td>
                <td>
                  {value(a.relationships?.actor)?.username ||
                    a.actor?.username ||
                    a.actor_id ||
                    "System"}
                </td>
                <td>{a.ip}</td>
                <td>{date(a.timestamp || a.created_at)}</td>
                <td>
                  <details>
                    <summary>Properties</summary>
                    <pre>{JSON.stringify(a.properties, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!r.loading && !items(r.data).length && (
        <p className="muted">No activity found.</p>
      )}
      <Pager data={r.data} page={page} setPage={setPage} />
    </section>
  );
}
function Profile() {
  const r = useAPI("/api/client/account");
  const user = value(r.data) || {};
  const a = useAction();
  const [fields, setFields] = useState<Record<string, string>>({});
  return (
    <Card>
      <h2>Account</h2>
      <PageError error={r.error} />
      <Notice action={a} />
      <dl>
        <dt>Username</dt>
        <dd>{user.username}</dd>
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Access</dt>
        <dd>{user.admin || user.root_admin ? "Administrator" : "User"}</dd>
        <dt>ID</dt>
        <dd>
          {user.id} · {user.uuid}
        </dd>
      </dl>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          a.run(
            () =>
              api(
                "/api/client/account",
                json("PATCH", {
                  first_name: fields.first_name ?? user.first_name ?? "",
                  last_name: fields.last_name ?? user.last_name ?? "",
                  language: fields.language ?? user.language ?? "en",
                })
              ),
            () => {
              r.reload();
              a.setSuccess("Account updated.");
            }
          );
        }}
      >
        <div className="form-grid">
          {[
            ["first_name", "First name"],
            ["last_name", "Last name"],
            ["language", "Language code"],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <Input
                value={fields[key] ?? user[key] ?? ""}
                onChange={(e) =>
                  setFields((old) => ({ ...old, [key]: e.target.value }))
                }
              />
            </Field>
          ))}
        </div>
        <Button type="submit" disabled={a.busy}>
          Save profile
        </Button>
      </form>
    </Card>
  );
}
function APIKeys() {
  const r = useAPI("/api/client/account/api-keys");
  const a = useAction();
  const [description, setDescription] = useState(""),
    [ips, setIPs] = useState(""),
    [secret, setSecret] = useState("");
  return (
    <section>
      <h2>API keys</h2>
      <Notice action={a} />
      <PageError error={r.error} />
      {secret && (
        <Card>
          <h3>Copy your new API key</h3>
          <p>This secret is only shown once.</p>
          <Input
            aria-label="New API key"
            readOnly
            value={secret}
            onFocus={(e) => e.target.select()}
          />
          <Button
            variant="secondary"
            onClick={() =>
              a.run(
                () => navigator.clipboard.writeText(secret),
                () => a.setSuccess("API key copied.")
              )
            }
          >
            Copy key
          </Button>
          <Button variant="secondary" onClick={() => setSecret("")}>
            Dismiss
          </Button>
        </Card>
      )}
      <div className="grid grid-2">
        <Card>
          <h3>Create API key</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              a.run(
                () =>
                  api(
                    "/api/client/account/api-keys",
                    json("POST", {
                      description,
                      allowed_ips: ips
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  ),
                (res) => {
                  setSecret(
                    res.meta?.secret_token ||
                      value(res)?.secret_token ||
                      value(res)?.token ||
                      ""
                  );
                  setDescription("");
                  r.reload();
                }
              );
            }}
          >
            <Field label="Description">
              <Input
                required
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Field
              label="Allowed IP addresses"
              hint="One IP or CIDR per line. Leave empty to allow any source."
            >
              <Textarea value={ips} onChange={(e) => setIPs(e.target.value)} />
            </Field>
            <Button type="submit" disabled={a.busy}>
              Create key
            </Button>
          </form>
        </Card>
        <div>
          {items(r.data).map((k) => (
            <Card key={k.identifier}>
              <h3>{k.description || k.memo}</h3>
              <code>{k.identifier}</code>
              <p className="muted">
                Created {date(k.created_at)} · Last used {date(k.last_used_at)}
              </p>
              <p>{(k.allowed_ips || []).join(", ") || "Any IP address"}</p>
              <Button
                variant="danger"
                disabled={a.busy}
                onClick={() => {
                  if (confirm(`Revoke API key ${k.identifier}?`))
                    a.run(
                      () =>
                        api(
                          `/api/client/account/api-keys/${k.identifier}`,
                          json("DELETE")
                        ),
                      r.reload
                    );
                }}
              >
                Revoke
              </Button>
            </Card>
          ))}
          {!r.loading && !items(r.data).length && <Card>No API keys yet.</Card>}
        </div>
      </div>
    </section>
  );
}
function SSHKeys() {
  const r = useAPI("/api/client/account/ssh-keys");
  const a = useAction();
  const [name, setName] = useState(""),
    [key, setKey] = useState("");
  return (
    <section>
      <h2>SSH keys</h2>
      <p className="muted">
        Use public keys for SFTP access. Keep your private key on your device.
      </p>
      <Notice action={a} />
      <PageError error={r.error} />
      <div className="grid grid-2">
        <Card>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              a.run(
                () =>
                  api(
                    "/api/client/account/ssh-keys",
                    json("POST", { name, public_key: key })
                  ),
                () => {
                  setName("");
                  setKey("");
                  r.reload();
                }
              );
            }}
          >
            <Field label="Name">
              <Input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Public key">
              <Textarea
                required
                rows={6}
                placeholder="ssh-ed25519 AAAA..."
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={a.busy}>
              Add SSH key
            </Button>
          </form>
        </Card>
        <div>
          {items(r.data).map((k) => (
            <Card key={k.fingerprint}>
              <h3>{k.name}</h3>
              <p>
                <code>{k.fingerprint}</code>
              </p>
              <details>
                <summary>Public key</summary>
                <pre>{k.public_key}</pre>
              </details>
              <p className="muted">Created {date(k.created_at)}</p>
              <Button
                variant="danger"
                disabled={a.busy}
                onClick={() => {
                  if (confirm(`Remove SSH key ${k.name}?`))
                    a.run(
                      () =>
                        api(
                          "/api/client/account/ssh-keys/remove",
                          json("POST", { fingerprint: k.fingerprint })
                        ),
                      r.reload
                    );
                }}
              >
                Remove
              </Button>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
export function Account() {
  return (
    <div className="page account-page">
      <h1>Your account</h1>
      <nav className="tabs account-tabs" aria-label="Account settings">
        <NavLink end to="/account">
          <NavIcon name="users"/><span>Profile</span>
        </NavLink>
        <NavLink to="/account/api"><NavIcon name="key"/><span>API keys</span></NavLink>
        <NavLink to="/account/ssh"><NavIcon name="console"/><span>SSH keys</span></NavLink>
        <NavLink to="/account/desktop"><NavIcon name="console"/><span>Desktop apps</span></NavLink>
        {import.meta.env.VITE_DESKTOP==='true'&&<NavLink to="/account/app"><NavIcon name="settings"/><span>App &amp; updates</span></NavLink>}
        <NavLink to="/account/activity"><NavIcon name="activity"/><span>Activity</span></NavLink>
      </nav>
      <Routes>
        <Route index element={<Profile />} />
        <Route path="api" element={<APIKeys />} />
        <Route path="ssh" element={<SSHKeys />} />
        <Route path="desktop" element={<DesktopApps />} />
        {import.meta.env.VITE_DESKTOP==='true'&&<Route path="app" element={<DesktopAppInfo />} />}
        <Route
          path="activity"
          element={<Activity path="/api/client/account/activity" />}
        />
      </Routes>
    </div>
  );
}
