import '../../../ui/sectionTabs.css';
import {useParams} from 'react-router-dom';
import {Loading} from '../../../lib';
import './infrastructure-ui.css';
import {Action, DataTable, Editor, ErrorMessage, Panel, f, rows, useAPI} from '../shared';
import {ResourceEditor, mounts} from './resources';
export function Mount() {
  const {id = 'new'} = useParams();
  return (
    <ResourceEditor
      title="Mount"
      endpoint={mounts}
      base="/admin/mounts"
      id={id}
      fields={[
        f('name', 'Name', undefined, {required: true}),
        f('description', 'Description', 'textarea'),
        f('source', 'Host source path', undefined, {required: true}),
        f('target', 'Container target path', undefined, {required: true}),
        f('read_only', 'Read only', 'checkbox', {default: true}),
        f('user_mountable', 'User mountable', 'checkbox'),
      ]}
    >
      {() => (
        <>
          <MountAssignments mountID={id} relation="nodes" />
          <MountAssignments mountID={id} relation="eggs" />
          <MountAssignments mountID={id} relation="servers" />
          <p className="muted">Only servers matching an allowed node and egg can attach this mount.</p>
        </>
      )}
    </ResourceEditor>
  );
}
function MountAssignments({mountID, relation}: {mountID: string; relation: 'nodes' | 'eggs' | 'servers'}) {
  const path = `${mounts}/${mountID}/${relation}`;
  const q = useAPI(path);
  return (
    <>
      <Panel title={`Assigned ${relation}`}>
        <ErrorMessage error={q.error} />
        {q.loading ? (
          <Loading />
        ) : (
          <DataTable
            empty={
              q.error ? 'Assignments could not be loaded. Refresh the page to try again.' : `No ${relation} assigned.`
            }
            data={q.data ? rows(q.data) : []}
            columns={[
              {label: 'Name', render: x => x.name},
              {label: 'ID', render: x => x.id},
              {
                label: 'Actions',
                render: x => (
                  <Action
                    path={`${path}/${x.id}`}
                    method="DELETE"
                    confirm={`Remove this ${relation.slice(0, -1)} assignment?`}
                    onDone={q.reload}
                  >
                    Remove
                  </Action>
                ),
              },
            ]}
          />
        )}
      </Panel>
      <Editor
        title={`Assign ${relation}`}
        endpoint={path}
        method="POST"
        fields={[f(relation, `${relation} IDs`, 'json', {default: []})]}
        onSaved={q.reload}
        submit="Assign"
      />
    </>
  );
}
