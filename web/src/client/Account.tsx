import {SectionTabs} from "../ui/SectionTabs";
import {DesktopAppInfo} from '../desktop';
import {NavIcon} from "../Icons";
import DesktopApps from "./DesktopApps";
import SFTPPassword from './SFTPPassword';
import Appearance from './Appearance';
import {SettingsRow,SettingsSection} from '../ui/Settings';
import {accountNickname} from './accountProfile';
import './accountProfile.css';
import { useState } from "react";
import { Route, Routes } from "react-router-dom";
import {
  api,
  useAPI,
  useTranslation,
  Button,
  Input,
  Textarea,
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
    <section className="operations-page activity-page">
      <div className="toolbar server-page-toolbar">
        <h2>Activity</h2>
        <Button variant="secondary" onClick={r.reload}>
          Refresh
        </Button>
      </div>
      <div className="toolbar operations-filters">
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
      <div className="table-wrap operations-table">
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
        <p className="operations-empty">No activity found.</p>
      )}
      <Pager data={r.data} page={page} setPage={setPage} />
    </section>
  );
}
function Profile() {
  const r = useAPI("/api/client/account");
  const user = value(r.data) || {};
  const a = useAction();
  const [nickname, setNickname] = useState<string|null>(null);
  const currentNickname = nickname ?? accountNickname(user);
  return (
    <section className="settings-page">
      <PageError error={r.error} />
      <Notice action={a} />
      <SettingsSection title="Profile" action={user.id&&<span className="account-profile-role">{user.admin || user.root_admin ? "Administrator" : "User"}</span>}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          a.run(
            () =>
              api(
                "/api/client/account",
                json("PATCH", {
                  nickname: currentNickname.trim(),
                })
              ),
            () => {
              r.reload();
              window.dispatchEvent(new Event('account-profile-updated'));
              a.setSuccess("Nickname saved.");
            }
          );
        }}
      >
        <SettingsRow label="Email" control={<span className="settings-value">{user.email||'—'}</span>}/>
        <SettingsRow label="Username" control={<span className="settings-value">{user.username||'—'}</span>}/>
        <SettingsRow label="Nickname" control={<Input aria-label="Nickname" name="nickname" autoComplete="nickname" required maxLength={64} value={currentNickname} onChange={event=>setNickname(event.target.value)} disabled={r.loading||a.busy}/>}/>
        <div className="settings-actions">
        <Button type="submit" disabled={r.loading||a.busy||!currentNickname.trim()||currentNickname.trim()===accountNickname(user)}>
          {a.busy?'Saving…':'Save'}
        </Button>
        </div>
      </form>
      </SettingsSection>
    </section>
  );
}
function APIKeys() {
  const r = useAPI("/api/client/account/api-keys");
  const a = useAction();
  const [description, setDescription] = useState(""),
    [ips, setIPs] = useState(""),
    [secret, setSecret] = useState("");
  return (
    <section className="operations-page account-credentials">
      <div className="operations-heading"><h2>API keys</h2><p>Create keys for apps that use your account's API access.</p></div>
      <Notice action={a} />
      <PageError error={r.error} />
      {secret && (
        <SettingsSection title="New API key" className="account-secret">
          <SettingsRow label="Copy your key" description="This secret is only shown once." control={
          <Input
            aria-label="New API key"
            readOnly
            value={secret}
            onFocus={(e) => e.target.select()}
          />}/>
          <div className="settings-actions">
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
          </div>
        </SettingsSection>
      )}
      <div className="grid grid-2">
        <SettingsSection title="Create API key">
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
            <SettingsRow label="Description" control={
              <Input
                aria-label="API key description"
                required
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />}/>
            <SettingsRow
              label="Allowed IP addresses"
              description="One IP or CIDR per line. Leave empty to allow any source."
              control={<Textarea aria-label="Allowed IP addresses" value={ips} onChange={(e) => setIPs(e.target.value)} />}
            />
            <div className="settings-actions">
            <Button type="submit" disabled={a.busy}>
              Create key
            </Button>
            </div>
          </form>
        </SettingsSection>
        <SettingsSection title="Your API keys" plain>
          {items(r.data).map((k) => (
            <Card key={k.identifier} className="operations-record">
              <h3>{k.description || k.memo}</h3>
              <code>{k.identifier}</code>
              <p className="muted">
                Created {date(k.created_at)} · Last used {date(k.last_used_at)}
              </p>
              <p className="operations-value">{(k.allowed_ips || []).join(", ") || "Any IP address"}</p>
              <div className="actions operations-record-actions">
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
              </div>
            </Card>
          ))}
          {r.loading && <p className="operations-empty" role="status">Loading API keys...</p>}
          {!r.loading && !items(r.data).length && <Card className="operations-empty">No API keys yet.</Card>}
        </SettingsSection>
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
    <section className="operations-page account-credentials">
      <div className="operations-heading"><h2>SSH keys</h2>
      <p>
        Use public keys for SFTP access. Keep your private key on your device.
      </p></div>
      <Notice action={a} />
      <PageError error={r.error} />
      <div className="grid grid-2">
        <SettingsSection title="Add SSH key">
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
            <SettingsRow label="Name" control={
              <Input
                aria-label="SSH key name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />}/>
            <SettingsRow label="Public key" control={
              <Textarea
                aria-label="SSH public key"
                required
                rows={6}
                placeholder="ssh-ed25519 AAAA..."
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />}/>
            <div className="settings-actions">
            <Button type="submit" disabled={a.busy}>
              Add SSH key
            </Button>
            </div>
          </form>
        </SettingsSection>
        <SettingsSection title="Your SSH keys" plain>
          {items(r.data).map((k) => (
            <Card key={k.fingerprint} className="operations-record">
              <h3>{k.name}</h3>
              <p>
                <code>{k.fingerprint}</code>
              </p>
              <details>
                <summary>Public key</summary>
                <pre>{k.public_key}</pre>
              </details>
              <p className="muted">Created {date(k.created_at)}</p>
              <div className="actions operations-record-actions"><Button
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
              </div>
            </Card>
          ))}
          {r.loading && <p className="operations-empty" role="status">Loading SSH keys...</p>}
          {!r.loading && !items(r.data).length && <Card className="operations-empty">No SSH keys yet.</Card>}
        </SettingsSection>
      </div>
    </section>
  );
}
export function Account() {
  return (
    <div className="page account-page">
      <h1>Your account</h1>
      <SectionTabs label="Account settings" items={[
        {id:'profile',label:<><NavIcon name="users"/><span>Profile</span></>,to:'/account',end:true},
        {id:'appearance',label:<><NavIcon name="settings"/><span>Appearance</span></>,to:'/account/appearance'},
        {id:'api',label:<><NavIcon name="key"/><span>API keys</span></>,to:'/account/api'},
        {id:'ssh',label:<><NavIcon name="console"/><span>SSH keys</span></>,to:'/account/ssh'},
        {id:'sftp',label:<><NavIcon name="key"/><span>SFTP password</span></>,to:'/account/sftp'},
        {id:'desktop',label:<><NavIcon name="console"/><span>Desktop apps</span></>,to:'/account/desktop'},
        ...(import.meta.env.VITE_DESKTOP==='true'?[{id:'app',label:<><NavIcon name="settings"/><span>App &amp; updates</span></>,to:'/account/app'}]:[]),
        {id:'activity',label:<><NavIcon name="activity"/><span>Activity</span></>,to:'/account/activity'},
      ]}/>
      <Routes>
        <Route index element={<Profile />} />
        <Route path="appearance" element={<Appearance />} />
        <Route path="api" element={<APIKeys />} />
        <Route path="ssh" element={<SSHKeys />} />
        <Route path="sftp" element={<SFTPPassword />} />
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
