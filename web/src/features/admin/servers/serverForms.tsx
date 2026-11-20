import {TerminalProgress, TerminalSpinner} from '../../../ui/TerminalProgress';
import {ReinstallServerButton} from '../../server-settings/ReinstallServerButton';
import {accountNickname} from '../../account/accountProfile';
import {confirmAction} from '../../../ui/ConfirmAction';
import {ActionButton as MiraAction} from '../../../ui/ActionButton';
import {SectionTabs} from '../../../ui/SectionTabs';
import {useState} from 'react';
import {formatDateTime} from '../../../format';
import '../../server-settings/serverAdminTools.css';
import {Link, useNavigate} from 'react-router-dom';
import {SettingsRow, SettingsSection, useSettingsLayout} from '../../../ui/Settings';
import {
  Action,
  DataTable,
  Editor,
  ErrorMessage,
  Fields,
  Panel,
  api,
  f,
  rows,
  unwrap,
  useAPI,
  type RecordData,
} from '../shared';
import type {Allocation, Egg, Mount, Node, Resource, ResourceList, ServerTransfer, User} from '../../../types/api';
export const servers = '/api/application/servers';
const limits = [
  f('memory', 'Memory limit (GB)', 'number', {default: 1024, unit: 'GB', hint: '0 means unlimited memory.'}),
  f('swap', 'Swap (GB)', 'number', {
    unit: 'GB',
    swapSentinel: true,
    hint: '0 disables swap. -1 allows unlimited swap.',
  }),
  f('disk', 'Disk limit (GB)', 'number', {default: 10240, unit: 'GB', hint: '0 means unlimited storage.'}),
  f('io', 'IO weight', 'number', {default: 500}),
  f('cpu', 'CPU limit (%)', 'number', {default: 100}),
  f('threads', 'CPU pinning'),
  f('oom_disabled', 'Disable OOM killer', 'checkbox'),
];
const features = [
  f('database_limit', 'Database limit', 'number'),
  f('allocation_limit', 'Additional allocation limit', 'number'),
  f('backup_limit', 'Backup limit', 'number'),
];
export function ServerSettingsTabs({
  tabs,
  active,
  onChange,
  scope = 'server-settings',
}: {
  tabs: readonly (readonly [string, string])[];
  active: string;
  onChange: (tab: string) => void;
  scope?: string;
}) {
  return (
    <SectionTabs
      label="Server settings"
      scope={scope}
      className="server-settings-tabs"
      items={tabs.map(([id, label]) => ({id, label}))}
      active={active}
      onChange={onChange}
    />
  );
}
export function Details({record, onSaved}: {record: any; onSaved: () => void}) {
  const q = useAPI<ResourceList<User>>('/api/application/users?per_page=100');
  return (
    <Editor
      title="Server details"
      endpoint={`${servers}/${record.id}/details`}
      initial={{...record, user: record.user ?? record.owner_id}}
      fields={[
        f('name', 'Name', undefined, {required: true}),
        f('description', 'Description', 'textarea'),
        f('user', 'Owner', 'select', {
          required: true,
          options: q.data
            ? rows(q.data).map(x => ({
                value: x.id,
                label: accountNickname(x),
              }))
            : [],
        }),
        f('external_id', 'External ID'),
      ]}
      transform={v => ({
        name: v.name,
        description: v.description,
        user: Number(v.user),
        external_id: v.external_id || null,
      })}
      onSaved={onSaved}
    />
  );
}
export function Build({record, onSaved}: {record: any; onSaved: () => void}) {
  const settings = useSettingsLayout();
  const allocations = useAPI<ResourceList<Allocation>>(
    `/api/application/nodes/${record.node ?? record.node_id}/allocations?per_page=100`
  );
  return (
    <Editor
      title="Build configuration"
      groups={
        settings
          ? [
              {title: 'Resource limits', keys: limits.map(field => field.key)},
              {title: 'Feature limits', keys: features.map(field => field.key)},
              {title: 'Network allocations', keys: ['allocation', 'add_allocations', 'remove_allocations']},
            ]
          : undefined
      }
      endpoint={`${servers}/${record.id}/build`}
      initial={{
        ...record,
        ...record.limits,
        database_limit: record.feature_limits?.databases ?? record.database_limit,
        allocation_limit: record.feature_limits?.allocations ?? record.allocation_limit,
        backup_limit: record.feature_limits?.backups ?? record.backup_limit,
        allocation: record.allocation ?? record.allocation_id,
        add_allocations: [],
        remove_allocations: [],
      }}
      fields={[
        ...limits,
        ...features,
        f('allocation', 'Primary allocation', 'select', {
          options: allocations.data
            ? rows(allocations.data)
                .filter(x => x.server_id === record.id || x.id === record.allocation)
                .map(x => ({value: x.id, label: `${x.ip}:${x.port}`}))
            : [],
        }),
        f('add_allocations', 'Additional allocations to attach', 'multiselect', {
          default: [],
          options: allocations.data
            ? rows(allocations.data)
                .filter(x => !x.assigned && !x.server_id)
                .map(x => ({
                  value: x.id,
                  label: String(x.ip) + ':' + String(x.port),
                }))
            : [],
        }),
        f('remove_allocations', 'Allocations to remove', 'multiselect', {
          default: [],
          options: allocations.data
            ? rows(allocations.data)
                .filter(x => x.server_id === record.id && x.id !== record.allocation)
                .map(x => ({
                  value: x.id,
                  label: String(x.ip) + ':' + String(x.port),
                }))
            : [],
        }),
      ]}
      transform={v => ({
        allocation: Number(v.allocation),
        ...Object.fromEntries(limits.map(x => [x.key, v[x.key]])),
        feature_limits: {
          databases: Number(v.database_limit),
          allocations: Number(v.allocation_limit),
          backups: Number(v.backup_limit),
        },
        add_allocations: v.add_allocations,
        remove_allocations: v.remove_allocations,
      })}
      onSaved={onSaved}
    />
  );
}
export function RuntimeAssignment({record, onSaved}: {record: any; onSaved: () => void}) {
  const eggID = record.egg ?? record.egg_id;
  return (
    <section className="server-runtime-assignment">
      <Editor
        title="Startup command and template"
        endpoint={`${servers}/${record.id}/startup`}
        initial={{
          startup: record.container?.startup_command ?? record.startup,
          egg: eggID,
          skip_scripts: record.container?.skip_scripts ?? record.skip_scripts,
        }}
        fields={[
          f('startup', 'Startup command', 'textarea'),
          f('egg', 'Template ID', 'number', {hint: 'Changing the template may require a separate reinstall.'}),
          f('skip_scripts', 'Skip installation script', 'checkbox'),
        ]}
        onSaved={onSaved}
        submit="Save server assignment"
      />
    </section>
  );
}
export function Startup({
  record,
  onSaved,
  contextual = false,
  restrictedOnly = false,
}: {
  record: any;
  onSaved: () => void;
  contextual?: boolean;
  restrictedOnly?: boolean;
}) {
  const eggID = record.egg ?? record.egg_id;
  const q = useAPI<Resource<Egg>>(`/api/admin/eggs/${eggID}`);
  const egg = q.data ? unwrap(q.data) : null;
  const farming = egg?.features?.includes('voltra_fs25');
  const vars = egg
    ? rows(egg.relationships?.variables).filter(
        variable =>
          (!farming || !['GAME_SERIAL', 'DLC_PRODUCT_KEY'].includes(variable.env_variable)) &&
          (!restrictedOnly || variable.user_viewable === false || variable.user_editable === false)
      )
    : [];
  const existing = record.relationships?.variables ? rows(record.relationships.variables) : [];
  const environment = Object.fromEntries(
    vars.map(x => [
      x.env_variable,
      existing.find(v => v.env_variable === x.env_variable)?.server_value ?? x.default_value,
    ])
  );
  if (contextual) {
    if (q.loading)
      return (
        <p role="status">
          <TerminalSpinner /> Loading runtime settings...
        </p>
      );
    if (!egg || q.error) return <ErrorMessage error={q.error || 'Runtime settings are unavailable.'} />;
    if (restrictedOnly && vars.length === 0) return null;
    const current = {...environment, ...record.container?.environment};
    const secret = (variable: RecordData) =>
      variable.secret ||
      variable.is_secret ||
      variable.field_type === 'password' ||
      variable.user_viewable === false ||
      /password|passwd|secret|token|api_?key|credential/i.test(variable.env_variable);
    return (
      <>
        {!restrictedOnly && (
          <p className="muted">
            Runtime changes apply on the next start. Saving does not restart or reinstall this server.
          </p>
        )}
        <Editor
          title={restrictedOnly ? 'Restricted template options' : 'Image and environment'}
          endpoint={`${servers}/${record.id}/startup`}
          initial={{
            ...(!restrictedOnly ? {image: record.container?.image ?? record.image} : {}),
            ...Object.fromEntries(
              vars.map(variable => [
                `env:${variable.env_variable}`,
                secret(variable) ? '' : (current[variable.env_variable] ?? ''),
              ])
            ),
          }}
          fields={[
            ...(!restrictedOnly ? [f('image', 'Docker image')] : []),
            ...vars.map(variable =>
              f(
                `env:${variable.env_variable}`,
                variable.name || variable.env_variable,
                secret(variable) ? 'password' : variable.field_type === 'textarea' ? 'textarea' : undefined,
                {
                  hint: `${variable.description || variable.env_variable}${secret(variable) ? ' Leave blank to keep the saved value.' : ''}`,
                }
              )
            ),
          ]}
          transform={v => ({
            ...(!restrictedOnly ? {image: v.image} : {}),
            environment: Object.fromEntries(
              vars
                .filter(
                  variable =>
                    Object.hasOwn(v, `env:${variable.env_variable}`) &&
                    (!secret(variable) || v[`env:${variable.env_variable}`] !== '') &&
                    v[`env:${variable.env_variable}`] !== current[variable.env_variable]
                )
                .map(variable => [variable.env_variable, v[`env:${variable.env_variable}`]])
            ),
          })}
          onSaved={onSaved}
          submit="Save for next start"
        />
        {!restrictedOnly && <RuntimeAssignment record={record} onSaved={onSaved} />}
      </>
    );
  }
  return (
    <>
      <ErrorMessage error={q.error} />
      <Editor
        title="Startup and environment"
        endpoint={`${servers}/${record.id}/startup`}
        initial={{
          startup: record.container?.startup_command ?? record.startup,
          image: record.container?.image ?? record.image,
          egg: eggID,
          skip_scripts: record.container?.skip_scripts ?? record.skip_scripts,
          environment: {...environment, ...record.container?.environment},
        }}
        fields={[
          f('startup', 'Startup command', 'textarea'),
          f('image', 'Docker image'),
          f('egg', 'Egg ID', 'number'),
          f('skip_scripts', 'Skip installation script', 'checkbox'),
          f('environment', 'Environment variables', 'json', {
            hint: vars.map(x => `${x.env_variable}: ${x.description ?? x.name}`).join('\n'),
          }),
        ]}
        onSaved={onSaved}
      />
      <p className="muted">Changing an egg or its installer may require reinstalling the server.</p>
    </>
  );
}
export function Manage({record, onSaved}: {record: any; onSaved: () => void}) {
  return (
    <>
      <ServerLifecycle record={record} onSaved={onSaved} />
      <Transfer record={record} onSaved={onSaved} />
    </>
  );
}
export function ServerLifecycle({record, onSaved}: {record: any; onSaved: () => void}) {
  return (
    <Panel title="Server lifecycle">
      <div className="settings-options-grid">
        <SettingsRow
          label={record.status === 'suspended' ? 'Unsuspend server' : 'Suspend server'}
          description="Control whether this server can run."
          control={
            <Action
              path={`${servers}/${record.id}/${record.status === 'suspended' ? 'unsuspend' : 'suspend'}`}
              confirm={record.status === 'suspended' ? undefined : `Suspend ${record.name} and stop it?`}
              onDone={onSaved}
            >
              {record.status === 'suspended' ? 'Unsuspend server' : 'Suspend server'}
            </Action>
          }
        />
        <SettingsRow
          label="Reinstall server"
          description="Runs the installer again and may overwrite files."
          control={<ReinstallServerButton server={record} onDone={onSaved} />}
        />
        <SettingsRow
          label="Installation state"
          description={
            record.container?.installed ? 'Currently marked as installed.' : 'Currently marked as not installed.'
          }
          control={
            <Action
              path={`/api/admin/servers/${record.id}/install`}
              body={{installed: !record.container?.installed}}
              confirm={`Change the installation state for ${record.name} manually?`}
              onDone={onSaved}
            >
              Toggle installation state
            </Action>
          }
        />
      </div>
    </Panel>
  );
}
export function Transfer({record, onSaved}: {record: any; onSaved: () => void}) {
  const endpoint = `/api/admin/servers/${record.id}/transfer`;
  const nodes = useAPI<ResourceList<Node>>('/api/application/nodes?per_page=100'),
    history = useAPI<ResourceList<ServerTransfer>>(endpoint);
  const [value, setValue] = useState<RecordData>({
    node_id: '',
    allocation_id: '',
    allocation_additional: [],
  });
  const allocations = useAPI<ResourceList<Allocation>>(
    value.node_id ? `/api/application/nodes/${value.node_id}/allocations?per_page=100` : null
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const available = allocations.data
    ? rows(allocations.data)
        .filter(x => !x.assigned && !x.server_id)
        .map(x => ({value: x.id, label: `${x.ip}:${x.port}`}))
    : [];
  const fields = [
    f('node_id', 'Destination node', 'select', {
      required: true,
      options: nodes.data
        ? rows(nodes.data)
            .filter(x => x.id !== (record.node ?? record.node_id))
            .map(x => ({value: x.id, label: x.name}))
        : [],
    }),
    f('allocation_id', 'Primary allocation', 'select', {
      required: true,
      options: available,
    }),
    f('allocation_additional', 'Additional allocations', 'multiselect', {
      options: available.filter(x => x.value !== value.allocation_id),
    }),
  ];
  return (
    <>
      <Panel title="Transfer to another node">
        <ErrorMessage error={error || nodes.error || allocations.error} />
        <form
          onSubmit={async e => {
            e.preventDefault();
            if (
              !(await confirmAction({
                title: 'Transfer server?',
                description: `Transfer ${record.name} to the selected node? The server will stop while its files are copied.`,
                confirmLabel: 'Transfer server',
                danger: false,
              }))
            )
              return;
            setBusy(true);
            setError('');
            try {
              await api(endpoint, {
                method: 'POST',
                body: JSON.stringify(value),
              });
              history.reload();
              onSaved();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Fields
            fields={fields}
            value={value}
            onChange={next =>
              setValue({
                ...next,
                ...(next.node_id !== value.node_id ? {allocation_id: '', allocation_additional: []} : {}),
              })
            }
          />
          <div className="actions admin-form-actions">
            <MiraAction disabled={busy}>
              {busy && <TerminalSpinner />}
              {busy ? 'Transferring…' : 'Start transfer'}
            </MiraAction>
          </div>
        </form>
      </Panel>
      <Panel title="Transfer history">
        <ErrorMessage error={history.error} />
        <DataTable
          loading={history.loading}
          empty="No transfers yet."
          data={history.data ? rows(history.data) : []}
          columns={[
            {label: 'Created', render: x => formatDateTime(x.created_at)},
            {label: 'Source node', render: x => x.old_node},
            {label: 'Destination node', render: x => x.new_node},
            {
              label: 'Status',
              render: x =>
                x.successful == null && x.archived ? (
                  'Cancelled'
                ) : (
                  <TerminalProgress
                    label={x.successful === true ? 'Completed' : x.successful === false ? 'Failed' : 'In progress'}
                    state={x.successful === true ? 'done' : x.successful === false ? 'failed' : 'running'}
                    value={null}
                  />
                ),
            },
          ]}
        />
        <Action
          path={endpoint}
          method="DELETE"
          confirm="Cancel this active server transfer?"
          onDone={() => {
            history.reload();
            onSaved();
          }}
        >
          Cancel transfer
        </Action>
      </Panel>
    </>
  );
}
export function DeleteServer({record, returnTo = '/admin/servers'}: {record: any; returnTo?: string}) {
  const navigate = useNavigate();
  return (
    <Panel title="Delete server" className="admin-danger-panel">
      <div className="settings-options-grid">
        <SettingsRow
          label="Delete server"
          description="Permanently deletes files, backups, databases and panel configuration."
          control={
            <Action
              path={`${servers}/${record.id}`}
              method="DELETE"
              danger
              confirm={`Permanently delete ${record.name} and its data?`}
              onDone={() => navigate(returnTo)}
            >
              Delete server
            </Action>
          }
        />
        <SettingsRow
          label="Force delete"
          description="Removes the panel record even if Wings is unreachable. Files may remain on the node."
          control={
            <Action
              path={`${servers}/${record.id}/force`}
              method="DELETE"
              danger
              confirm={`Force-delete ${record.name} even if Wings cannot be reached? Daemon files may remain.`}
              onDone={() => navigate(returnTo)}
            >
              Force delete
            </Action>
          }
        />
      </div>
    </Panel>
  );
}
export function ServerMounts({record, contextual = false}: {record: any; contextual?: boolean}) {
  const endpoint = `/api/admin/servers/${record.id}/mounts`;
  const q = useAPI<ResourceList<Mount>>(endpoint);
  if (contextual) {
    const mounts = q.data ? rows(q.data) : [];
    return (
      <>
        <ErrorMessage error={q.error} />
        <SettingsSection title="Mounts" className="server-mounts-section">
          {q.loading ? (
            <p className="settings-section-note" role="status">
              <TerminalSpinner /> Loading mounts...
            </p>
          ) : !mounts.length ? (
            <p className="settings-section-note">No mounts available for this server.</p>
          ) : (
            mounts.map(mount => (
              <SettingsRow
                key={mount.id}
                label={mount.name}
                description={mount.read_only ? 'Read-only access' : 'Read and write access'}
                control={
                  mount.attached ? (
                    <Action
                      path={`${endpoint}/${mount.id}`}
                      method="DELETE"
                      confirm="Detach this mount? Restart the server to apply."
                      onDone={q.reload}
                    >
                      Detach
                    </Action>
                  ) : (
                    <Action path={endpoint} body={{mount_id: mount.id}} onDone={q.reload}>
                      Attach
                    </Action>
                  )
                }
              >
                <dl className="settings-paths">
                  <div>
                    <dt>Source</dt>
                    <dd>
                      <code>{mount.source}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Target</dt>
                    <dd>
                      <code>{mount.target}</code>
                    </dd>
                  </div>
                </dl>
              </SettingsRow>
            ))
          )}
        </SettingsSection>
      </>
    );
  }
  return (
    <>
      <ErrorMessage error={q.error} />
      <Panel title="Available mounts">
        <DataTable
          loading={q.loading}
          empty="No mounts available for this server."
          data={q.data ? rows(q.data) : []}
          columns={[
            {
              label: 'Name',
              render: x => (contextual ? x.name : <Link to={`/admin/mounts/${x.id}`}>{x.name}</Link>),
            },
            {label: 'Source', render: x => x.source},
            {label: 'Target', render: x => x.target},
            {
              label: 'Actions',
              render: x =>
                x.attached ? (
                  <Action
                    path={`${endpoint}/${x.id}`}
                    method="DELETE"
                    confirm="Detach this mount? Restart the server to apply."
                    onDone={q.reload}
                  >
                    Detach
                  </Action>
                ) : (
                  <Action path={endpoint} body={{mount_id: x.id}} onDone={q.reload}>
                    Attach
                  </Action>
                ),
            },
          ]}
        />
      </Panel>
      <Editor
        title="Attach mount"
        endpoint={endpoint}
        method="POST"
        fields={[f('mount_id', 'Mount ID', 'number', {required: true})]}
        onSaved={q.reload}
        submit="Attach mount"
      />
    </>
  );
}
