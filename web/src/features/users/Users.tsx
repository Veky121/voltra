import {CollectionSkeleton} from '../../ui/CollectionSkeleton';
import '../schedules/scheduleRows.css';
import {accountNickname} from '../account/accountProfile';
import {confirmAction} from '../../ui/ConfirmAction';
import {useState} from 'react';
import {api, useAPI, Button, Input, Field, Card, Modal} from '../../lib';
import {can, Check, date, items, json, Notice, PageError, useAction, useServer, value} from '../shared/common';
import type {RecordData} from '../shared/common';
import type {PermissionCatalog, Resource, ResourceList, Subuser} from '../../types/api';
export function Users() {
  const {base, permissions} = useServer();
  const r = useAPI<ResourceList<Subuser>>(`${base}/users`);
  const p = useAPI<Resource<PermissionCatalog>>('/api/client/permissions');
  const a = useAction();
  const [editing, setEditing] = useState<RecordData | null>(null);
  const permissionGroups = value(p.data)?.permissions || value(p.data) || {};
  const groups = Object.entries(permissionGroups).filter(([, v]) => typeof v === 'object' && v !== null) as [
    string,
    any,
  ][];
  return (
    <section className="operations-page server-users-page">
      <div className="toolbar server-page-toolbar">
        <h2>Server users</h2>
        {can(permissions, 'user.create') && (
          <Button onClick={() => setEditing({username: '', permissions: []})}>Add user</Button>
        )}
        <Button variant="secondary" onClick={r.reload}>
          Refresh
        </Button>
      </div>
      <Notice action={a} />
      <PageError error={r.error} />
      <PageError error={p.error} />
      {r.loading && !r.data && <CollectionSkeleton label="Loading users" layout="users" count={2} />}
      <div className="grid grid-2">
        {items(r.data).map(u => (
          <Card key={u.uuid || u.id} className="operations-record">
            <h3>
              {accountNickname(u)}
              {u.is_current_user && ' (you)'}
            </h3>
            <p className="muted">
              {u.inherited_access
                ? `${u.is_owner ? 'Server owner' : 'Administrator'} · Full access`
                : `${u.permissions?.length || 0} permissions`}{' '}
              · Created {date(u.created_at)}
            </p>
            <div className="actions operations-record-actions">
              {!u.inherited_access && can(permissions, 'user.update') && (
                <Button variant="secondary" onClick={() => setEditing({...u, permissions: u.permissions || []})}>
                  Edit permissions
                </Button>
              )}
              {!u.inherited_access && can(permissions, 'user.delete') && (
                <Button
                  variant="danger"
                  disabled={a.busy}
                  onClick={async () => {
                    if (
                      await confirmAction({
                        title: 'Remove?',
                        description: `Remove ${accountNickname(u)} from this server?`,
                        confirmLabel: 'Remove',
                        danger: true,
                      })
                    )
                      a.run(() => api(`${base}/users/${u.uuid || u.id}`, json('DELETE')), r.reload);
                  }}
                >
                  Remove user
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
      {!r.loading && !items(r.data).length && <Card className="operations-empty">No users found.</Card>}
      {editing && (
        <Modal
          title={editing.uuid || editing.id ? 'Edit user permissions' : 'Add server user'}
          onClose={() => setEditing(null)}
        >
          <Notice action={a} />
          <form
            onSubmit={e => {
              e.preventDefault();
              a.run(
                () =>
                  api(
                    `${base}/users${editing.uuid || editing.id ? '/' + (editing.uuid || editing.id) : ''}`,
                    json('POST', {
                      username: editing.username,
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
            {editing.uuid || editing.id ? (
              <p>{accountNickname(editing)}</p>
            ) : (
              <Field label="Account username">
                <Input
                  required
                  autoComplete="off"
                  value={editing.username || ''}
                  onChange={e => setEditing({...editing, username: e.target.value})}
                />
              </Field>
            )}
            <p className="muted">
              Select the actions this account can perform on this server. Enable file.sftp to let them connect using
              their own SFTP password or SSH key.
            </p>
            {groups.map(([group, info]) => {
              const keys = Object.entries(info.keys || info.permissions || {}).map(([k, v]) => ({
                key: `${group}.${k}`,
                description: String(typeof v === 'object' ? (v as any)?.description || k : v),
              }));
              const allowed = keys.filter(k => can(permissions, k.key));
              return (
                <fieldset key={group} className="permission-group">
                  <legend>{group}</legend>
                  <p className="muted">{info.description}</p>
                  {allowed.length > 0 && (
                    <Check
                      label="Select all in this group"
                      checked={allowed.every(k => editing.permissions.includes(k.key))}
                      onChange={v =>
                        setEditing({
                          ...editing,
                          permissions: v
                            ? Array.from(new Set([...editing.permissions, ...allowed.map(k => k.key)]))
                            : editing.permissions.filter((key: string) => !allowed.some(k => k.key === key)),
                        })
                      }
                    />
                  )}
                  <div className="grid grid-2">
                    {keys.map(k => (
                      <Check
                        key={k.key}
                        label={`${k.key}: ${k.description}`}
                        checked={editing.permissions.includes(k.key)}
                        disabled={!can(permissions, k.key)}
                        onChange={v =>
                          setEditing({
                            ...editing,
                            permissions: v
                              ? [...editing.permissions, k.key]
                              : editing.permissions.filter((p: string) => p !== k.key),
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
