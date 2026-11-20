import {TerminalSpinner} from '../../../ui/TerminalProgress';
import '../../server-settings/serverAdminTools.css';
import {Navigate, useParams} from 'react-router-dom';
import {ErrorMessage, unwrap, useAPI} from '../shared';
import type {AdminServer, Resource} from '../../../types/api';
import {servers} from './serverForms';
export function Server() {
  const {id = 'new'} = useParams();
  const q = useAPI<Resource<AdminServer>>(
    id === 'new' ? null : `${servers}/${id}?include=allocations,variables,user,node,egg`
  );
  if (id === 'new') return <Navigate to="/game-library" replace />;
  const record = q.data ? unwrap(q.data) : null;
  if (q.error) return <ErrorMessage error={q.error} />;
  if (!record)
    return (
      <p role="status">
        <TerminalSpinner /> Loading server...
      </p>
    );
  return <Navigate to={`/server/${record.identifier || record.uuid}/runtime`} replace />;
}
