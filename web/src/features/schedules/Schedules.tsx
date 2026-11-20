import {CollectionSkeleton} from '../../ui/CollectionSkeleton';
import {ButtonFeedback} from '../../ui/ButtonFeedback';
import {Archive, Terminal, Power, ChevronRight} from 'lucide-react';
import {Collapsible, CollapsibleTrigger, CollapsibleContent} from '../../components/ui/collapsible';
import './scheduleRows.css';
import {describeSchedule} from './scheduleTimingModel';
import {confirmAction} from '../../ui/ConfirmAction';
import {useEffect, useState} from 'react';
import {ScheduleTiming} from './ScheduleTiming';
import type {ScheduleCron} from './scheduleTimingModel';
import {api, useAPI, Button, Input, Textarea, Select, Field, Card, Modal} from '../../lib';
import {can, Check, date, items, json, Notice, PageError, useAction, useServer} from '../shared/common';
import type {RecordData} from '../shared/common';
import type {ResourceList, Schedule} from '../../types/api';
const emptySchedule = {
  name: '',
  minute: '0',
  hour: '*',
  day_of_month: '*',
  month: '*',
  day_of_week: '*',
  is_active: true,
  only_when_online: false,
};
const cronFields = ['minute', 'hour', 'day_of_month', 'month', 'day_of_week'] as const;
export function Schedules() {
  const {base, permissions} = useServer();
  const r = useAPI<ResourceList<Schedule>>(`${base}/schedules?include=tasks`);
  const a = useAction();
  const [editing, setEditing] = useState<RecordData | null>(null),
    [task, setTask] = useState<RecordData | null>(null);
  const [runFeedback, setRunFeedback] = useState<{id: number; state: 'pending' | 'success'} | null>(null);
  useEffect(() => {
    if (runFeedback?.state !== 'success') return;
    const timer = setTimeout(() => setRunFeedback(null), 2500);
    return () => clearTimeout(timer);
  }, [runFeedback]);
  const saveSchedule = () =>
    a.run(
      () => api(`${base}/schedules${editing?.id ? '/' + editing.id : ''}`, json('POST', editing)),
      () => {
        r.reload();
        setEditing(null);
      }
    );
  const saveTask = () =>
    a.run(
      () =>
        api(
          `${base}/schedules/${task?.schedule_id}/tasks${task?.id ? '/' + task.id : ''}`,
          json('POST', {
            action: task?.action,
            payload: task?.payload,
            ...(task?.sequence_id ? {sequence_id: Number(task.sequence_id)} : {}),
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
        {can(permissions, 'schedule.create') && (
          <Button onClick={() => setEditing({...emptySchedule})}>Create schedule</Button>
        )}
        <Button variant="secondary" onClick={r.reload}>
          Refresh
        </Button>
      </div>
      <Notice action={a} />
      <PageError error={r.error} />
      {r.loading && !r.data && <CollectionSkeleton label="Loading schedules" layout="schedules" />}
      <div className="schedule-list">
        {items(r.data).map(s => {
          const tasks = items(s.relationships?.tasks);
          const first = tasks[0];
          const Icon = first?.action === 'backup' ? Archive : first?.action === 'power' ? Power : Terminal;
          const action =
            first?.action === 'backup'
              ? 'Backup'
              : first?.action === 'power'
                ? `${String(first.payload).charAt(0).toUpperCase()}${String(first.payload).slice(1)}`
                : first?.action === 'command'
                  ? 'Command'
                  : 'No tasks';
          const timing = describeSchedule(
            Object.fromEntries(cronFields.map(key => [key, s.cron?.[key] ?? '*'])) as ScheduleCron
          );
          return (
            <Collapsible key={s.id} className="schedule-entry">
              <div className="schedule-line">
                <CollapsibleTrigger className="schedule-open" aria-label={`Manage ${s.name}`}>
                  <span className="schedule-icon">
                    <Icon size={18} strokeWidth={1.6} />
                  </span>
                  <span className="schedule-identity">
                    <strong>{s.name}</strong>
                    <span>
                      {action}
                      {tasks.length > 1 ? ` + ${tasks.length - 1} more` : ''}
                    </span>
                  </span>
                  <span className="schedule-when">{timing}</span>
                  <span className={`schedule-state ${s.is_active ? 'is-active' : ''}`}>
                    <i />
                    {s.is_processing ? 'Running' : s.is_active ? 'Active' : 'Paused'}
                  </span>
                  <ChevronRight size={16} className="schedule-arrow" />
                </CollapsibleTrigger>
                <div className="actions schedule-row-actions">
                  {can(permissions, 'schedule.update') && (
                    <Button
                      variant="secondary"
                      disabled={a.busy || s.is_processing}
                      aria-busy={runFeedback?.id === s.id && runFeedback?.state === 'pending'}
                      onClick={async () => {
                        setRunFeedback({id: s.id, state: 'pending'});
                        let accepted = false;
                        await a.run(
                          () => api(`${base}/schedules/${s.id}/execute`, json('POST')),
                          () => {
                            accepted = true;
                            r.reload();
                            a.setSuccess(`${s.name}: execution requested.`);
                            setRunFeedback({id: s.id, state: 'success'});
                          }
                        );
                        if (!accepted) setRunFeedback(null);
                      }}
                    >
                      {runFeedback?.id === s.id && (
                        <ButtonFeedback state={runFeedback?.state ?? 'idle'}>
                          <span />
                        </ButtonFeedback>
                      )}
                      {runFeedback?.id === s.id
                        ? runFeedback?.state === 'pending'
                          ? 'Requesting...'
                          : 'Requested'
                        : 'Run now'}
                    </Button>
                  )}

                  {can(permissions, 'schedule.update') && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setEditing({
                          id: s.id,
                          name: s.name,
                          is_active: s.is_active,
                          only_when_online: s.only_when_online,
                          ...Object.fromEntries(cronFields.map(k => [k, s.cron?.[k] || '*'])),
                        })
                      }
                    >
                      Edit
                    </Button>
                  )}
                  {can(permissions, 'schedule.delete') && (
                    <Button
                      variant="danger"
                      disabled={a.busy}
                      onClick={async () => {
                        if (
                          await confirmAction({
                            title: `Delete ${s.name}?`,
                            description: 'This also deletes every task in the schedule.',
                            confirmLabel: 'Delete schedule',
                            danger: true,
                          })
                        )
                          a.run(() => api(`${base}/schedules/${s.id}`, json('DELETE')), r.reload);
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </div>{' '}
              </div>
              <CollapsibleContent className="schedule-editor">
                <div className="schedule-editor-heading">
                  <strong>Tasks in this schedule</strong>{' '}
                  {can(permissions, 'schedule.update') && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setTask({
                          schedule_id: s.id,
                          action: 'command',
                          payload: '',
                          time_offset: 0,
                          continue_on_failure: false,
                        })
                      }
                    >
                      Add task
                    </Button>
                  )}
                </div>
                <div className="schedule-compact-tasks">
                  {items(s.relationships?.tasks)
                    .sort((a, b) => a.sequence_id - b.sequence_id)
                    .map(t => (
                      <div className="schedule-compact-task" key={t.id}>
                        <span className="muted">{t.sequence_id}</span>
                        <div className="schedule-compact-task-label">
                          <span>
                            {t.action === 'backup'
                              ? 'Create backup'
                              : t.action === 'power'
                                ? `${String(t.payload).charAt(0).toUpperCase()}${String(t.payload).slice(1)} server`
                                : 'Send command'}
                          </span>
                          {t.payload && t.action !== 'power' && <pre>{t.payload}</pre>}
                          {Number(t.time_offset) > 0 && <span className="muted">After {t.time_offset}s</span>}
                          {t.continue_on_failure && <span className="muted">Continue on failure</span>}
                          {t.is_queued && <span className="badge">Queued</span>}
                        </div>
                        {can(permissions, 'schedule.update') && (
                          <div className="actions">
                            <Button variant="secondary" onClick={() => setTask({...t, schedule_id: s.id})}>
                              Edit
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
                <div className="schedule-compact-settings">
                  <div className="schedule-run-info">
                    <span>{s.last_run_at ? `Last run: ${date(s.last_run_at)}` : 'This schedule has never run'}</span>
                    {s.only_when_online && <span>Only runs while the server is online</span>}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
      {!r.loading && !items(r.data).length && (
        <Card className="operations-empty">
          No schedules configured. Add a schedule to automate commands, power actions, or backups.
        </Card>
      )}
      {editing && (
        <Modal title={editing.id ? 'Edit schedule' : 'Create schedule'} onClose={() => setEditing(null)}>
          <Notice action={a} />
          <form
            onSubmit={e => {
              e.preventDefault();
              saveSchedule();
            }}
          >
            <Field label="Name">
              <Input required value={editing.name} onChange={e => setEditing({...editing, name: e.target.value})} />
            </Field>
            <ScheduleTiming value={editing as ScheduleCron} onChange={cron => setEditing({...editing, ...cron})} />
            <Check
              label="Schedule enabled"
              checked={editing.is_active}
              onChange={v => setEditing({...editing, is_active: v})}
            />
            <Check
              label="Only run when server is online"
              checked={editing.only_when_online}
              onChange={v => setEditing({...editing, only_when_online: v})}
            />
            <Button type="submit" disabled={a.busy || !editing.day_of_week.trim()}>
              Save schedule
            </Button>
          </form>
        </Modal>
      )}
      {task && (
        <Modal title={task.id ? 'Edit task' : 'Add task'} onClose={() => setTask(null)}>
          <Notice action={a} />
          <form
            onSubmit={e => {
              e.preventDefault();
              saveTask();
            }}
          >
            <Field label="Action">
              <Select value={task.action} onChange={e => setTask({...task, action: e.target.value, payload: ''})}>
                <option value="command">Send command</option>
                <option value="power">Power action</option>
                <option value="backup">Create backup</option>
              </Select>
            </Field>
            <Field label={task.action === 'backup' ? 'Ignored files (one per line)' : 'Payload'}>
              {task.action === 'power' ? (
                <Select required value={task.payload} onChange={e => setTask({...task, payload: e.target.value})}>
                  <option value="">Choose action</option>
                  {['start', 'stop', 'restart', 'kill'].map(p => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              ) : (
                <Textarea
                  required={task.action === 'command'}
                  rows={4}
                  value={task.payload}
                  onChange={e => setTask({...task, payload: e.target.value})}
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
                  onChange={e => setTask({...task, sequence_id: Number(e.target.value)})}
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
                onChange={e => setTask({...task, time_offset: e.target.value})}
              />
            </Field>
            <Check
              label="Continue remaining tasks if this task fails"
              checked={task.continue_on_failure}
              onChange={v => setTask({...task, continue_on_failure: v})}
            />
            <div className="actions schedule-task-form-actions">
              <Button type="submit" disabled={a.busy}>
                Save task
              </Button>
              {task.id && (
                <Button
                  variant="danger"
                  disabled={a.busy}
                  onClick={async () => {
                    if (
                      await confirmAction({
                        title: 'Delete task?',
                        description: 'This task will be removed from the schedule.',
                        confirmLabel: 'Delete task',
                        danger: true,
                      })
                    ) {
                      a.run(
                        () => api(`${base}/schedules/${task.schedule_id}/tasks/${task.id}`, json('DELETE')),
                        () => {
                          r.reload();
                          setTask(null);
                        }
                      );
                    }
                  }}
                >
                  Delete task
                </Button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
