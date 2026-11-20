import '../../../ui/sectionTabs.css';
import './infrastructure-ui.css';
import {ResourceList, hosts} from './resources';
export function Hosts() {
  return (
    <ResourceList
      title="Database hosts"
      endpoint={hosts}
      base="/admin/database-hosts"
      columns={['name', 'host', 'port', 'username']}
    />
  );
}
