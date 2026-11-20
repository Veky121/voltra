import {TerminalProgress} from '../../ui/TerminalProgress';
import {CollectionSkeleton} from '../../ui/CollectionSkeleton';
import {BackupOverview, backupDisplayName, backupOriginLabel, backupCreated} from './BackupOverview';
import {LockKeyhole} from 'lucide-react';
import './backups.css';
import {confirmAction} from '../../ui/ConfirmAction';
import {useEffect, useRef, useState} from 'react';
import {api, useAPI, Button, Input, Textarea, Field, Card, Modal} from '../../lib';
import {
  bytes,
  can,
  Check,
  download,
  items,
  json,
  Notice,
  PageError,
  Pager,
  useAction,
  useServer,
} from '../shared/common';
import type {BackupList} from '../../types/api';
function BackupState({pending, successful}: {pending: boolean; successful: boolean}) {
  const wasPending = useRef(pending);
  const [created, setCreated] = useState(false);
  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      setCreated(false);
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    if (!successful) return;
    setCreated(true);
    const timer = setTimeout(() => setCreated(false), 5000);
    return () => clearTimeout(timer);
  }, [pending, successful]);
  const label = pending ? 'In progress' : !successful ? 'Failed' : created ? 'Created' : '';
  return (
    <div role="status" hidden={!label}>
      {label && (
        <TerminalProgress label={label} value={null} state={pending ? 'running' : successful ? 'done' : 'failed'} />
      )}
    </div>
  );
}

export function Backups() {
  const {base, permissions, server} = useServer();
  const [page, setPage] = useState(1);
  const r = useAPI<BackupList>(`${base}/backups?page=${page}&per_page=20`);
  const [activeAction, setActiveAction] = useState<{id: string; label: string} | null>(null);
  const a = useAction();
  const [open, setOpen] = useState(false),
    [name, setName] = useState(''),
    [ignored, setIgnored] = useState(''),
    [locked, setLocked] = useState(false),
    [restore, setRestore] = useState<any>(null),
    [truncate, setTruncate] = useState(false);
  const runBackup = (id: string, label: string, success: string, fn: () => Promise<any>, done?: () => void) =>
    a.run(async () => {
      setActiveAction({id, label});
      try {
        const result = await fn();
        a.setSuccess(success);
        done?.();
        return result;
      } finally {
        setActiveAction(null);
      }
    });
  const perform = (id: string, action: string, body?: any, method = 'POST') =>
    runBackup(
      id,
      action === 'restore' ? 'Requesting restore...' : action === 'lock' ? 'Updating lock...' : 'Deleting backup...',
      action === 'restore' ? 'Restore requested' : action === 'lock' ? 'Lock updated' : 'Backup deleted',
      () => api(`${base}/backups/${id}${action ? '/' + action : ''}`, json(method, body)),
      () => {
        r.reload();
        setRestore(null);
      }
    );
  return (
    <section className="operations-page backups-page">
      <div className="toolbar server-page-toolbar">
        <div className="server-page-title">
          <h2>Backups</h2>
        </div>
        {can(permissions, 'backup.create') && <Button onClick={() => setOpen(true)}>Create backup</Button>}
      </div>
      <BackupOverview response={r.data} error={r.error} />
      <Notice action={a} />
      {server.status === 'restoring_backup' && <TerminalProgress label="Restoring backup" />}
      <PageError error={r.error} />
      {r.error && (
        <Button variant="secondary" onClick={r.reload}>
          Retry
        </Button>
      )}
      {r.loading && !r.data && <CollectionSkeleton label="Loading backups" layout="cards" count={3} />}
      <div className="backup-cards" role="list" aria-label="Backups">
        {items(r.data).map(b => {
          const created = backupCreated(b.created_at);
          const active = activeAction?.id === b.uuid ? activeAction : null;
          const pending = !b.completed_at;
          return (
            <Card
              key={b.uuid}
              className="backup-card"
              role="listitem"
              data-backup-active={active || pending ? '' : undefined}
              data-backup-state={active ? 'action' : pending ? 'creating' : b.is_successful ? 'completed' : 'failed'}
              aria-busy={!!active || pending}
            >
              <div className="backup-card-heading">
                <div className="backup-card-title">
                  <h3 title={backupDisplayName(b.name)}>{backupDisplayName(b.name)}</h3>
                  <p
                    className="backup-card-feedback"
                    role="status"
                    title={active?.label || backupOriginLabel(b.origin)}
                  >
                    {active?.label || (pending ? 'Creating backup...' : backupOriginLabel(b.origin))}
                  </p>
                </div>
                <div className="backup-card-status">
                  <span
                    className="backup-lock-indicator"
                    style={{visibility: b.is_locked ? 'visible' : 'hidden'}}
                    aria-hidden={!b.is_locked}
                  >
                    <LockKeyhole size={14} aria-hidden="true" />
                    Locked
                  </span>
                  <BackupState pending={pending} successful={!!b.is_successful} />
                </div>
              </div>
              <div className="backup-card-footer">
                <div className="backup-created">
                  <span className="backup-meta-label">Created</span>
                  <time dateTime={b.created_at}>
                    <strong>{created.time}</strong>
                    <span>{created.date}</span>
                  </time>
                </div>
                <div className="backup-card-size">
                  <span className="backup-meta-label">Size</span>
                  <strong>{b.completed_at ? bytes(b.bytes) : 'Pending'}</strong>
                </div>
                <div className="backup-card-actions">
                  {can(permissions, 'backup.download') && (
                    <Button
                      variant="secondary"
                      disabled={a.busy || !b.is_successful}
                      onClick={() =>
                        runBackup(b.uuid, 'Preparing download...', 'Download started', () =>
                          download(`${base}/backups/${b.uuid}/download`)
                        )
                      }
                    >
                      Download
                    </Button>
                  )}
                  {can(permissions, 'backup.restore') && (
                    <Button
                      variant="secondary"
                      disabled={a.busy || !b.is_successful}
                      onClick={() => {
                        setRestore(b);
                        setTruncate(false);
                      }}
                    >
                      Restore
                    </Button>
                  )}
                  {can(permissions, 'backup.delete') && (
                    <>
                      <Button variant="secondary" disabled={a.busy} onClick={() => perform(b.uuid, 'lock')}>
                        {b.is_locked ? 'Unlock' : 'Lock'}
                      </Button>
                      <Button
                        variant="danger"
                        disabled={a.busy || b.is_locked}
                        onClick={async () => {
                          if (
                            await confirmAction({
                              title: 'Delete backup?',
                              description: `Permanently delete backup ${b.name}?`,
                              confirmLabel: 'Delete',
                              danger: true,
                            })
                          )
                            perform(b.uuid, '', undefined, 'DELETE');
                        }}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {!r.loading && !r.error && !items(r.data).length && (
        <Card className="operations-empty">No backups have been created.</Card>
      )}
      <Pager data={r.data} page={page} setPage={setPage} />
      {open && (
        <Modal title="Create backup" onClose={() => setOpen(false)}>
          <form
            onSubmit={e => {
              e.preventDefault();
              a.run(
                () => api(`${base}/backups`, json('POST', {name, ignored, is_locked: locked})),
                () => {
                  setOpen(false);
                  setName('');
                  r.reload();
                }
              );
            }}
          >
            <Field label="Name (optional)">
              <Input value={name} onChange={e => setName(e.target.value)} />
            </Field>
            <Field label="Ignored files" hint="One file or glob per line. Leave empty to use .pteroignore.">
              <Textarea rows={5} value={ignored} onChange={e => setIgnored(e.target.value)} />
            </Field>
            <Check label="Lock backup against deletion" checked={locked} onChange={setLocked} />
            <Button type="submit" disabled={a.busy}>
              Start backup
            </Button>
          </form>
        </Modal>
      )}
      {restore && (
        <Modal title={`Restore ${restore.name}`} onClose={() => setRestore(null)}>
          <p>The server will stop. Existing files may be overwritten by this backup.</p>
          <Check label="Delete all existing files before restoring" checked={truncate} onChange={setTruncate} />
          <Button variant="danger" disabled={a.busy} onClick={() => perform(restore.uuid, 'restore', {truncate})}>
            Restore backup
          </Button>
        </Modal>
      )}
    </section>
  );
}
