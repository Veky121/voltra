import '../../../ui/sectionTabs.css';
import './infrastructure-ui.css';
import {ResourceList, locations} from './resources';
export function Locations() {
  return (
    <ResourceList
      title="Groups"
      description="Organize nodes into groups such as Home or EU. Use groups to choose where new servers are created."
      endpoint={locations}
      base="/admin/locations"
      columns={['short', 'long']}
    />
  );
}
