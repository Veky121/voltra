import '../../../ui/sectionTabs.css';
import './infrastructure-ui.css';
import {ResourceList, mounts} from './resources';
export function Mounts() {
  return (
    <ResourceList
      title="Mounts"
      endpoint={mounts}
      base="/admin/mounts"
      columns={['name', 'source', 'target', 'read_only']}
    />
  );
}
