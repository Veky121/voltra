import '../../../ui/sectionTabs.css';
import {useParams} from 'react-router-dom';
import './infrastructure-ui.css';
import {f} from '../shared';
import {ResourceEditor, locations} from './resources';
export function Location() {
  const {id = 'new'} = useParams();
  return (
    <ResourceEditor
      title="Group"
      id={id}
      endpoint={locations}
      base="/admin/locations"
      fields={[f('short', 'Group name', undefined, {required: true}), f('long', 'Description', 'textarea')]}
    />
  );
}
