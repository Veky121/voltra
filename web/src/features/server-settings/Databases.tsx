import {CollectionSkeleton} from '../../ui/CollectionSkeleton';
import '../schedules/scheduleRows.css';
import {confirmAction} from '../../ui/ConfirmAction';
import {useEffect, useState} from 'react';
import {SettingsRow, SettingsSection} from '../../ui/Settings';
import {api, useAPI, Button, Input, Field, Card, Modal} from '../../lib';
import {can, items, json, Notice, PageError, useAction, useServer, value} from '../shared/common';
import type {Resource, ResourceList, ServerDatabase} from '../../types/api';
function DatabasePassword({base, database, revision}: {base: string; database: ServerDatabase; revision: unknown}) {
  const [revealed, setRevealed] = useState(false);
  const result = useAPI<Resource<ServerDatabase>>(
    revealed ? `${base}/databases/${database.id}?include=password` : null
  );
  useEffect(() => setRevealed(false), [revision]);
  const password = value(value(result.data)?.relationships?.password)?.password || '';
  return (
    <SettingsRow
      label="Password"
      control={
        <Input
          aria-label={`Password for ${database.name}`}
          type={revealed ? 'text' : 'password'}
          readOnly
          value={revealed ? password : '••••••••'}
          placeholder={result.loading ? 'Loading password…' : ''}
        />
      }
    >
      <Button variant="secondary" onClick={() => setRevealed(value => !value)}>
        {revealed ? 'Hide' : 'Show'} password
      </Button>
      {revealed && result.error && (
        <>
          <PageError error={result.error} />
          <Button variant="secondary" onClick={result.reload}>
            Retry password
          </Button>
        </>
      )}
    </SettingsRow>
  );
}

export function Databases() {
  const {base, permissions, server} = useServer();
  const r = useAPI<ResourceList<ServerDatabase>>(`${base}/databases`);
  const a = useAction();
  const [open, setOpen] = useState(false),
    [name, setName] = useState(''),
    [remote, setRemote] = useState('%');
  return (
    <section className="operations-page databases-page" aria-label="Databases">
      <div className="toolbar server-page-toolbar">
        <span className="server-limit-badge">Limit: {server.feature_limits?.databases ?? 'Unlimited'}</span>
        {can(permissions, 'database.create') && <Button onClick={() => setOpen(true)}>Create database</Button>}
        <Button variant="secondary" onClick={r.reload}>
          Refresh
        </Button>
      </div>
      <Notice action={a} />
      <PageError error={r.error} />
      {r.loading && !r.data && <CollectionSkeleton label="Loading databases" layout="databases" count={2} />}
      <div className="grid grid-2">
        {items(r.data).map(d => {
          const host = `${d.host?.address || ''}:${d.host?.port || 3306}`;
          return (
            <SettingsSection key={d.id} title={d.name} className="operations-database">
              <SettingsRow label="Host" control={<Input aria-label={`Host for ${d.name}`} readOnly value={host} />} />
              <SettingsRow
                label="Username"
                control={<Input aria-label={`Username for ${d.name}`} readOnly value={d.username} />}
              />
              <SettingsRow
                label="Connections from"
                control={<span className="settings-value">{d.connections_from}</span>}
              />
              {can(permissions, 'database.view_password') && (
                <DatabasePassword key={`${base}:${d.id}`} base={base} database={d} revision={r.data} />
              )}
              <div className="settings-actions operations-record-actions">
                {can(permissions, 'database.update') && (
                  <Button
                    variant="secondary"
                    disabled={a.busy}
                    onClick={async () => {
                      if (
                        await confirmAction({
                          title: 'Continue?',
                          description: 'Rotate this database password? Update game configuration afterwards.',
                          confirmLabel: 'Continue',
                          danger: false,
                        })
                      )
                        a.run(
                          () => api(`${base}/databases/${d.id}/rotate-password`, json('POST')),
                          () => {
                            r.reload();
                            a.setSuccess('Database password rotated.');
                          }
                        );
                    }}
                  >
                    Rotate password
                  </Button>
                )}
                {can(permissions, 'database.delete') && (
                  <Button
                    variant="danger"
                    disabled={a.busy}
                    onClick={async () => {
                      if (
                        await confirmAction({
                          title: 'Delete?',
                          description: `Permanently delete database ${d.name} and all its data?`,
                          confirmLabel: 'Delete',
                          danger: true,
                        })
                      )
                        a.run(() => api(`${base}/databases/${d.id}`, json('DELETE')), r.reload);
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
      {!r.loading && !items(r.data).length && <Card className="operations-empty">No databases provisioned.</Card>}
      {open && (
        <Modal title="Create database" onClose={() => setOpen(false)}>
          <Notice action={a} />
          <form
            onSubmit={e => {
              e.preventDefault();
              a.run(
                () => api(`${base}/databases?include=password`, json('POST', {database: name, remote})),
                () => {
                  setOpen(false);
                  setName('');
                  r.reload();
                }
              );
            }}
          >
            <Field label="Database name">
              <Input required pattern="[A-Za-z0-9_]+" value={name} onChange={e => setName(e.target.value)} />
            </Field>
            <Field label="Connections from" hint="Use % to allow any source, or enter an IP address.">
              <Input required value={remote} onChange={e => setRemote(e.target.value)} />
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
