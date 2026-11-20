import '../../../ui/sectionTabs.css';
import {Checkbox} from '../../../components/ui/checkbox';
import {ActionButton as MiraAction} from '../../../ui/ActionButton';
import {Input as MiraInput} from '../../../components/ui/input';
import {formatMiBGB} from '../../../resourceUnits';
import {useState} from 'react';
import {Link, useParams} from 'react-router-dom';
import {Loading} from '../../../lib';
import {NodeConnection} from './node-pairing';
import './infrastructure-ui.css';
import {Action, DataTable, DownloadJSON, Editor, ErrorMessage, JsonView, Panel, api, f, rows, useAPI} from '../shared';
import type {AdminServer, Allocation, Location, ResourceList as List, UnknownRecord} from '../../../types/api';
import {ResourceEditor, locations, nodes} from './resources';
export function Node() {
  const {id = 'new'} = useParams();
  const l = useAPI<List<Location>>(`${locations}?per_page=100`);
  const fields = [
    f('name', 'Name', undefined, {required: true}),
    f('description', 'Description', 'textarea'),
    f('location_id', 'Group', 'select', {
      required: true,
      options: l.data
        ? rows(l.data).map(x => ({
            value: x.id,
            label: `${x.short} · ${x.long}`,
          }))
        : [],
    }),
    f('fqdn', 'Hostname or IP address', undefined, {required: true}),
    f('scheme', 'Protocol', 'select', {
      default: 'http',
      options: [
        {value: 'http', label: 'HTTP'},
        {value: 'https', label: 'HTTPS'},
      ],
    }),
    f('behind_proxy', 'Behind a reverse proxy', 'checkbox'),
    f('public', 'Allow automatic deployment', 'checkbox', {default: true}),
    f('memory', 'Memory capacity (GB)', 'number', {required: true, unit: 'GB', positive: true}),
    f('memory_overallocate', 'Memory overallocation (%)', 'number'),
    f('disk', 'Disk capacity (GB)', 'number', {required: true, unit: 'GB', positive: true}),
    f('disk_overallocate', 'Disk overallocation (%)', 'number'),
    f('upload_size', 'Maximum upload (GB)', 'number', {default: 100, unit: 'GB', positive: true}),
    f('daemon_listen', 'Wings HTTP port', 'number', {default: 8080}),
    f('daemon_sftp', 'Wings SFTP port', 'number', {default: 2022}),
    f('daemon_base', 'Server data directory', undefined, {
      default: '/var/lib/voltra/volumes',
    }),
    f('maintenance_mode', 'Maintenance mode', 'checkbox'),
    f('allowed_origins', 'Additional allowed origins', 'json', {default: []}),
  ];
  return (
    <ResourceEditor title="Node" id={id} endpoint={nodes} base="/admin/nodes" fields={fields}>
      {node => <NodeExtras node={node} />}
    </ResourceEditor>
  );
}
function NodeExtras({node}: {node: any}) {
  const path = `${nodes}/${node.id}`;
  const a = useAPI<List<Allocation>>(`${path}/allocations?per_page=100`);
  // The Wings configuration file, shown as it is.
  const config = useAPI<UnknownRecord>(`${path}/configuration`);
  const servers = useAPI<List<AdminServer>>('/api/application/servers?per_page=100');
  const [rotated, setRotated] = useState<any>(null);
  const [selection, setSelection] = useState<number[]>([]);
  return (
    <>
      <NodeConnection nodeId={node.id} nodeName={node.name} />
      <NodeDiagnostics node={node} />
      <Panel title="Wings configuration">
        <p className="muted">Save this configuration on the node. It contains the node's machine credential.</p>
        <ErrorMessage error={config.error} />
        {config.loading && <Loading />}
        {config.data && (
          <>
            <JsonView value={rotated ?? config.data} />
            <div className="actions">
              <DownloadJSON value={rotated ?? config.data} name={`wings-${node.id}.json`} />
            </div>
          </>
        )}
        <div className="infrastructure-token-action">
          <Action
            path={`/api/admin/nodes/${node.id}/reset-token`}
            confirm="Rotate the Wings token? Update the daemon configuration afterwards."
            onDone={r => {
              setRotated(r);
              config.reload();
            }}
          >
            Rotate daemon token
          </Action>
        </div>
      </Panel>
      <Panel title="Allocations">
        <ErrorMessage error={a.error} />
        {a.loading ? (
          <Loading />
        ) : (
          <>
            <DataTable
              empty={
                a.error
                  ? 'Allocations could not be loaded. Refresh the page to try again.'
                  : 'No allocations. Create an address and port range below.'
              }
              data={a.data ? rows(a.data) : []}
              columns={[
                {
                  label: 'Select',
                  render: x => (
                    <Checkbox
                      aria-label={`Select allocation ${x.id}`}
                      checked={selection.includes(x.id)}
                      onCheckedChange={checked =>
                        setSelection(checked ? [...selection, x.id] : selection.filter(y => y !== x.id))
                      }
                    />
                  ),
                },
                {label: 'Address', render: x => `${x.ip}:${x.port}`},
                {
                  label: 'Alias',
                  render: x => <AllocationAlias node={node.id} allocation={x} onSaved={a.reload} />,
                },
                {
                  label: 'Server',
                  render: x =>
                    x.server_id ? (
                      <Link to={`/admin/servers/${x.server_id}`}>#{x.server_id}</Link>
                    ) : x.assigned ? (
                      'Assigned'
                    ) : (
                      'Available'
                    ),
                },
                {
                  label: 'Actions',
                  render: x => (
                    <Action
                      path={`${path}/allocations/${x.id}`}
                      method="DELETE"
                      confirm="Delete this allocation?"
                      onDone={a.reload}
                      danger
                    >
                      Delete
                    </Action>
                  ),
                },
              ]}
            />
            {selection.length > 0 && (
              <Action
                path={`/api/admin/nodes/${node.id}/allocations`}
                method="DELETE"
                body={{allocations: selection}}
                confirm={`Delete ${selection.length} selected allocations?`}
                onDone={() => {
                  a.reload();
                  setSelection([]);
                }}
                danger
              >
                Delete selected allocations
              </Action>
            )}
          </>
        )}
      </Panel>
      <Editor
        title="Create allocations"
        endpoint={`${path}/allocations`}
        method="POST"
        fields={[
          f('ip', 'IP address or CIDR', undefined, {required: true}),
          f('alias', 'IP alias'),
          f('ports', 'Ports and ranges', 'json', {
            default: ['25565'],
            hint: 'Example: ["25565", "25570-25580"]',
          }),
        ]}
        onSaved={a.reload}
        submit="Create allocations"
      />
      <Panel title="Servers on this node">
        <ErrorMessage error={servers.error} />
        {servers.loading ? (
          <Loading />
        ) : (
          <DataTable
            empty={
              servers.error ? 'Servers could not be loaded. Refresh the page to try again.' : 'No servers on this node.'
            }
            data={servers.data ? rows(servers.data).filter(x => String(x.node) === String(node.id)) : []}
            columns={[
              {
                label: 'Name',
                render: x => <Link to={`/admin/servers/${x.id}`}>{x.name}</Link>,
              },
              {
                label: 'Memory',
                render: x =>
                  Number(x.limits?.memory ?? x.memory) === 0
                    ? 'Unlimited'
                    : formatMiBGB(Number(x.limits?.memory ?? x.memory)),
              },
              {label: 'Status', render: x => x.status ?? 'Ready'},
            ]}
          />
        )}
      </Panel>
    </>
  );
}
function NodeDiagnostics({node}: {node: any}) {
  const [system, setSystem] = useState<any>(null),
    [token, setToken] = useState<any>(null);
  return (
    <Panel title="Node diagnostics and deployment">
      <div className="actions">
        <Action path={`/api/admin/nodes/${node.id}/system-information`} method="GET" onDone={setSystem}>
          Check Wings connection
        </Action>
        <Action path={`/api/admin/nodes/${node.id}/deploy-token`} onDone={setToken}>
          Generate deployment token
        </Action>
      </div>
      {system && <JsonView value={system} />}
      {token && (
        <>
          <p className="muted">
            Run this command on the node. Revoke the deployment key from Application API keys after configuration.
          </p>
          <pre style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>
            wings configure --panel-url {window.location.origin} --token {token.token} --node {token.node}
          </pre>
          <MiraAction className="secondary" onClick={() => setToken(null)}>
            Dismiss token
          </MiraAction>
        </>
      )}
    </Panel>
  );
}
function AllocationAlias({node, allocation, onSaved}: {node: number; allocation: any; onSaved: () => void}) {
  const [alias, setAlias] = useState(allocation.alias ?? allocation.ip_alias ?? '');
  const [err, setErr] = useState('');
  return (
    <form
      className="infrastructure-allocation-alias"
      onSubmit={async e => {
        e.preventDefault();
        try {
          await api(`/api/admin/nodes/${node}/allocations/${allocation.id}`, {
            method: 'PATCH',
            body: JSON.stringify({alias}),
          });
          onSaved();
        } catch (error) {
          setErr(String(error));
        }
      }}
    >
      <MiraInput
        aria-label={`Alias for ${allocation.ip}:${allocation.port}`}
        value={alias}
        onChange={e => setAlias(e.target.value)}
      />
      <MiraAction className="secondary">Save alias</MiraAction>
      <ErrorMessage error={err} />
    </form>
  );
}
