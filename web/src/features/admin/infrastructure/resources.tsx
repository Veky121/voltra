import '../../../ui/sectionTabs.css';
import type {ComponentProps} from 'react';
import './infrastructure-ui.css';
import {ResourceEditor as SharedResourceEditor, ResourceList as SharedResourceList} from '../shared';
export function ResourceList(props: ComponentProps<typeof SharedResourceList>) {
  return (
    <div className="admin-infrastructure">
      <SharedResourceList {...props} />
    </div>
  );
}
export function ResourceEditor(props: ComponentProps<typeof SharedResourceEditor>) {
  return (
    <div className="admin-infrastructure">
      <SharedResourceEditor {...props} />
    </div>
  );
}

export const locations = '/api/application/locations',
  nodes = '/api/application/nodes';
export const mounts = '/api/admin/mounts';
export const hosts = '/api/admin/database-hosts';
