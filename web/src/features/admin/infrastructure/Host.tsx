import '../../../ui/sectionTabs.css';
import {useParams} from 'react-router-dom';
import './infrastructure-ui.css';
import {Action, Panel, f, rows, useAPI} from '../shared';
import type {Node, ResourceList as List} from '../../../types/api';
import {ResourceEditor, hosts, nodes} from './resources';
export function Host() {
  const {id = 'new'} = useParams();
  const n = useAPI<List<Node>>(nodes);
  return (
    <ResourceEditor
      title="Database host"
      endpoint={hosts}
      base="/admin/database-hosts"
      id={id}
      fields={[
        f('name', 'Name', undefined, {required: true}),
        f('host', 'Host', undefined, {required: true}),
        f('port', 'Port', 'number', {default: 3306}),
        f('username', 'Database administrator username', undefined, {
          required: true,
        }),
        f('password', 'Database administrator password', 'password', {
          hint: 'Leave blank to keep the current password when editing.',
        }),
        f('node_id', 'Linked node', 'select', {
          options: n.data ? rows(n.data).map(x => ({value: x.id, label: x.name})) : [],
        }),
        f('max_databases', 'Maximum databases', 'number', {default: ''}),
      ]}
    >
      {() => (
        <Panel title="Connectivity">
          <Action path={`${hosts}/${id}/test`}>Test connection</Action>
        </Panel>
      )}
    </ResourceEditor>
  );
}
