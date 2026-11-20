import {TerminalSpinner} from '../../../ui/TerminalProgress';
import {ActionButton as MiraAction} from '../../../ui/ActionButton';
import {useEffect, useRef, useState} from 'react';
import {useAPI as useCoreAPI} from '../../../lib';
import {Badge} from '../../../components/ui/badge';
import {Input as MiraInput} from '../../../components/ui/input';
import {
  Table as MiraTable,
  TableBody as MiraTableBody,
  TableCell as MiraTableCell,
  TableHead as MiraTableHead,
  TableHeader as MiraTableHeader,
  TableRow as MiraTableRow,
} from '../../../components/ui/table';
import {
  serverListPath,
  serverListRange,
  serverNodeName,
  serverOwnerName,
  serverState,
  shownServerList,
} from './serverListModel';
import '../../server-settings/serverAdminTools.css';
import {Link} from 'react-router-dom';
import {ErrorMessage, Heading, Panel, rows} from '../shared';
import type {AdminServer, ResourceList} from '../../../types/api';
// Paged and searched by the panel, so a large fleet does not load at once.
export function Servers() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const q = useCoreAPI<ResourceList<AdminServer>>(serverListPath({page, search: query}));
  // Keep the previous page on screen only while the next one loads. A failed
  // request, including a refusal, shows no rows rather than another query's.
  const shown = useRef<ResourceList<AdminServer> | null>(null);
  shown.current = shownServerList(q.data, shown.current, q.loading);
  const data = shown.current;
  // A page that no longer exists, e.g. after servers were deleted elsewhere,
  // moves to the last page there is.
  const lastPage = Number(q.data?.meta?.pagination?.total_pages) || 0;
  useEffect(() => {
    if (lastPage && page > lastPage) setPage(lastPage);
  }, [lastPage, page]);
  const list = data ? rows(data) : [];
  const range = serverListRange(data?.meta?.pagination);
  const loading = q.loading && !data;
  return (
    <div className="admin-management-page management-ui">
      <Heading title="Servers">
        <Link className="button" to="/admin/servers/new">
          Create server
        </Link>
        <MiraAction type="button" className="secondary" onClick={q.reload}>
          Refresh
        </MiraAction>
      </Heading>
      <ErrorMessage error={q.error} />
      <Panel>
        <div className="admin-data management-ui" aria-busy={q.loading}>
          <div className="toolbar admin-data-toolbar">
            <MiraInput
              type="search"
              aria-label="Search servers by name or identifier"
              placeholder="Search by name or identifier…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <span className="muted admin-record-count" role="status">
              {loading ? (
                <>
                  <TerminalSpinner /> Loading...
                </>
              ) : range.total ? (
                `${range.from}–${range.to} of ${range.total} ${range.total === 1 ? 'server' : 'servers'}`
              ) : (
                '0 servers'
              )}
            </span>
          </div>
          <div className="admin-table-scroll">
            <MiraTable className="table admin-server-table">
              <MiraTableHeader>
                <MiraTableRow>
                  {['Name', 'Identifier', 'Node', 'Owner', 'State'].map(label => (
                    <MiraTableHead scope="col" key={label}>
                      {label}
                    </MiraTableHead>
                  ))}
                </MiraTableRow>
              </MiraTableHeader>
              <MiraTableBody>
                {loading ? (
                  <MiraTableRow>
                    <MiraTableCell colSpan={5} className="admin-table-empty">
                      Loading servers...
                    </MiraTableCell>
                  </MiraTableRow>
                ) : (
                  list.map(server => {
                    const state = serverState(server);
                    return (
                      <MiraTableRow key={server.id}>
                        <MiraTableCell>
                          <Link to={`/server/${server.identifier || server.uuid}/runtime`}>
                            {server.name || `Server ${server.id}`}
                          </Link>
                        </MiraTableCell>
                        <MiraTableCell>
                          <code>{server.identifier}</code>
                        </MiraTableCell>
                        <MiraTableCell>{serverNodeName(server)}</MiraTableCell>
                        <MiraTableCell>{serverOwnerName(server)}</MiraTableCell>
                        <MiraTableCell>
                          <Badge
                            variant={
                              state.tone === 'problem'
                                ? 'destructive'
                                : state.tone === 'ready'
                                  ? 'secondary'
                                  : 'outline'
                            }
                          >
                            {state.tone === 'busy' && <TerminalSpinner />}
                            {state.label}
                          </Badge>
                        </MiraTableCell>
                      </MiraTableRow>
                    );
                  })
                )}
                {!loading && !list.length && (
                  <MiraTableRow>
                    <MiraTableCell colSpan={5} className="admin-table-empty">
                      {query ? 'No servers match this search.' : 'No servers yet.'}
                    </MiraTableCell>
                  </MiraTableRow>
                )}
              </MiraTableBody>
            </MiraTable>
          </div>
          {range.pages > 1 && (
            <div className="toolbar admin-data-pages">
              <MiraAction
                type="button"
                className="secondary"
                disabled={range.page <= 1 || q.loading}
                onClick={() => setPage(range.page - 1)}
              >
                Previous
              </MiraAction>
              <span className="muted admin-record-count">
                Page {range.page} of {range.pages}
              </span>
              <MiraAction
                type="button"
                className="secondary"
                disabled={range.page >= range.pages || q.loading}
                onClick={() => setPage(range.page + 1)}
              >
                Next
              </MiraAction>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
