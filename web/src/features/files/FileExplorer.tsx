import {TerminalSpinner} from '../../ui/TerminalProgress';
import {Feedback} from '../../notifications';
import {CollectionSkeleton} from '../../ui/CollectionSkeleton';
import {IconButton} from '../../ui/IconButton';
import {Checkbox} from '../../components/ui/checkbox';
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type RefObject,
} from 'react';
import {api, useAPI} from '../../lib';
import {folderSizeRequests, folderSizeResults, nextFileSort, searchFileTree, sortFiles} from './fileListing';
import type {FileSort} from './fileListing';
import {fullWindow, rowWindow, ROW_WINDOW_THRESHOLD, type RowWindow} from './fileRowWindow';
import {Icon} from '../../Icons';
import {bytes, can, items} from '../shared/common';
import {plainFileClick, type FileEntry} from './fileManagerModel';
import {fileEntrySize, fileEntryType, fileModifiedDate} from './fileMetadata';
import './fileMetadata.css';
import type {ResourceList} from '../../types/api';

type Controls = {
  selected: string[];
  onSelect: (path: string) => void;
  onMenu: (path: string, anchor: HTMLButtonElement) => void;
};
type SearchResult = {term: string; entries: Map<string, FileEntry[]>; folders: Set<string>};
type ScanControls = {
  sizes: Record<string, number>;
  failed: Record<string, true>;
  report: (requested: string[], sizes: Record<string, number>, failed: string[]) => void;
};
type Shared = {
  sort: FileSort;
  scan: ScanControls;
  searchResult: SearchResult;
  base: string;
  activeFile: string;
  activeDirectory?: string;
  refreshToken: string;
  dirty: boolean;
  filter: string;
  permissions: string[];
  onOpen: (path: string) => void;
  onDirectory?: (path: string) => void;
  onEntries?: (path: string, files: FileEntry[]) => void;
  controls?: Controls & {membership: ReadonlySet<string>};
};
function EntryCheck({path, controls}: {path: string; controls?: Controls & {membership: ReadonlySet<string>}}) {
  return (
    controls && (
      <label className="explorer-check-target" title={`Select ${path}`}>
        <Checkbox
          className="explorer-check"
          aria-label={`Select ${path}`}
          checked={controls.membership.has(path)}
          onCheckedChange={() => controls.onSelect(path)}
        />
      </label>
    )
  );
}
function EntryMenu({path, controls}: {path: string; controls?: Controls}) {
  return (
    controls && (
      <IconButton
        type="button"
        className="explorer-menu"
        aria-label={`Options for ${path}`}
        aria-haspopup="menu"
        onClick={event => controls.onMenu(path, event.currentTarget)}
      >
        <Icon name="more" />
      </IconButton>
    )
  );
}
const modifiedFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const modifiedTitleFormat = new Intl.DateTimeFormat(undefined, {dateStyle: 'short', timeStyle: 'medium'});
const EntryMetadata = memo(function EntryMetadata({
  entry,
  path,
  folderSize,
  folderError,
}: {
  entry: FileEntry;
  path?: string;
  folderSize?: number;
  folderError?: boolean;
}) {
  const modified = fileModifiedDate(entry.modified_at),
    size = fileEntrySize(entry),
    type = fileEntryType(entry);
  return (
    <span className="explorer-metadata">
      <span
        className="explorer-modified"
        title={modified ? modifiedTitleFormat.format(modified) : 'Date modified unavailable'}
      >
        {modified ? <time dateTime={modified.toISOString()}>{modifiedFormat.format(modified)}</time> : '—'}
      </span>
      <span className="explorer-type" title={type}>
        {type}
      </span>
      <span
        className="explorer-size"
        aria-label={path ? `Folder size for ${path}` : undefined}
        title={
          folderError
            ? 'Folder size unavailable. Refresh to retry.'
            : path
              ? 'Total nested file size, excluding symbolic links. Cached for one minute.'
              : size === null
                ? 'Size unavailable'
                : `${size.toLocaleString()} bytes`
        }
      >
        {!entry.is_file && !entry.is_symlink && path
          ? folderError
            ? '—'
            : folderSize === undefined
              ? '…'
              : bytes(folderSize)
          : size === null
            ? '—'
            : bytes(size)}
      </span>
    </span>
  );
});

// Keep unchanged file rows out of selection, draft and parent status updates.
const FileRow = memo(function FileRow({
  entry,
  path,
  depth,
  selected,
  active,
  dirty,
  compact,
  readable,
  onOpen,
  onSelect,
  onMenu,
}: {
  entry: FileEntry;
  path: string;
  depth: number;
  selected: boolean;
  active: boolean;
  dirty: boolean;
  compact: boolean;
  readable: boolean;
  onOpen: Shared['onOpen'];
  onSelect?: Controls['onSelect'];
  onMenu?: Controls['onMenu'];
}) {
  return (
    <li className={`explorer-file-row${selected ? ' is-selected' : ''}`} data-entry={entry.name}>
      {onSelect && (
        <label className="explorer-check-target" title={`Select ${path}`}>
          <Checkbox
            className="explorer-check"
            aria-label={`Select ${path}`}
            checked={selected}
            onCheckedChange={() => onSelect(path)}
          />
        </label>
      )}
      <button
        type="button"
        className={`explorer-row explorer-file${active ? ' is-active' : ''}`}
        style={{paddingLeft: 30 + depth * 14}}
        aria-label={`Open ${path}`}
        aria-current={active ? 'page' : undefined}
        disabled={!readable}
        title={path}
        onClick={event => {
          if (onSelect && !plainFileClick(event)) {
            onSelect(path);
            return;
          }
          onOpen(path);
        }}
      >
        <Icon name="file" />
        <span>{entry.name}</span>
        {active && dirty && <i className="explorer-draft-dot" aria-label="Unsaved changes" />}
      </button>
      {!compact && <EntryMetadata entry={entry} />}
      {onMenu && (
        <IconButton
          type="button"
          className="explorer-menu"
          aria-label={`Options for ${path}`}
          aria-haspopup="menu"
          onClick={event => onMenu(path, event.currentTarget)}
        >
          <Icon name="more" />
        </IconButton>
      )}
    </li>
  );
});

// One batched read for up to 50 child folders of a listing. The shared read
// cache refreshes it after file changes, like the listing itself.
function FolderSizeBatch({
  url,
  directories,
  refreshToken,
  report,
}: {
  url: string;
  directories: string[];
  refreshToken: string;
  report: ScanControls['report'];
}) {
  const read = useAPI(url);
  useEffect(() => {
    if (read.data) {
      const result = folderSizeResults(read.data);
      report(directories, result.sizes, result.failed);
      return;
    }
    if (read.error) report(directories, {}, directories);
  }, [read.data, read.error, url, report]);
  const refreshed = useRef(refreshToken);
  useEffect(() => {
    if (refreshed.current === refreshToken) return;
    refreshed.current = refreshToken;
    read.reload();
  }, [refreshToken, read.reload]);
  return null;
}

const quantum = 272; // About eight rows: the view only re-renders after that much scrolling.
// Render only the rows near the viewport of the explorer's scroll area once a
// folder holds more than ROW_WINDOW_THRESHOLD rows.
function useRowWindow(
  list: RefObject<HTMLUListElement | null>,
  keys: string[],
  pinnedKeys: ReadonlySet<string>
): RowWindow {
  const enabled = keys.length > ROW_WINDOW_THRESHOLD;
  const heights = useRef(new Map<string, number>()),
    rowHeight = useRef(34);
  const [view, setView] = useState({top: 0, bottom: quantum * 3}),
    [measured, setMeasured] = useState(0);
  const pinned = useMemo(() => {
    if (!enabled || !pinnedKeys.size) return [];
    const out: number[] = [];
    keys.forEach((key, index) => {
      if (pinnedKeys.has(key)) out.push(index);
    });
    return out;
  }, [enabled, keys, pinnedKeys]);
  const inView = useMemo(
    () =>
      enabled
        ? rowWindow({
            count: keys.length,
            heightOf: index => heights.current.get(keys[index]) ?? rowHeight.current,
            viewTop: view.top,
            viewBottom: view.bottom,
            pinned,
          })
        : fullWindow(keys.length),
    [enabled, keys, view, pinned, measured]
  );
  const measure = useCallback(() => {
    const element = list.current,
      container = element?.closest<HTMLElement>('.file-explorer-tree');
    if (!element || !container) return;
    let changed = false;
    for (const child of Array.from(element.children)) {
      const key = (child as HTMLElement).dataset?.entry;
      if (key === undefined) continue;
      const height = child.getBoundingClientRect().height;
      if (!(height > 0)) continue;
      if (child.classList.contains('explorer-file-row') && Math.abs(rowHeight.current - height) > 0.5) {
        rowHeight.current = height;
        changed = true;
      }
      if (Math.abs((heights.current.get(key) ?? -1) - height) > 0.5) {
        heights.current.set(key, height);
        changed = true;
      }
    }
    if (changed) setMeasured(value => value + 1);
    const top = element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    const viewTop = container.scrollTop - top,
      viewBottom = viewTop + container.clientHeight;
    const next = {top: Math.floor(viewTop / quantum) * quantum, bottom: Math.ceil(viewBottom / quantum) * quantum};
    setView(old => (old.top === next.top && old.bottom === next.bottom ? old : next));
  }, [list]);
  // Measure the rows this window rendered; ResizeObserver covers later changes.
  useLayoutEffect(() => {
    if (enabled) measure();
  }, [enabled, inView, measure]);
  useEffect(() => {
    const element = list.current,
      container = element?.closest<HTMLElement>('.file-explorer-tree');
    if (!enabled || !element || !container) return;
    let frame = 0;
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
    };
    container.addEventListener('scroll', schedule, {passive: true});
    // Expanding a child folder changes this list's height without rendering it.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(element);
    observer?.observe(container);
    return () => {
      container.removeEventListener('scroll', schedule);
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled, list, measure]);
  return inView;
}

function Folder({
  path,
  label,
  entry,
  depth = 0,
  onExpandedChange,
  ...shared
}: Shared & {
  path: string;
  label: string;
  entry?: FileEntry;
  depth?: number;
  onExpandedChange?: (name: string, expanded: boolean) => void;
}) {
  const activePath = shared.activeFile || shared.activeDirectory || '/';
  const containsActive = path === '/' || activePath === path || activePath.startsWith(path + '/');
  const [expanded, setExpanded] = useState(containsActive);
  const searching = !!shared.filter.trim();
  const open = expanded || searching;
  useEffect(() => {
    if (containsActive) setExpanded(true);
  }, [activePath, containsActive]);
  // A long parent list keeps expanded folders rendered while they scroll away.
  useEffect(() => {
    if (entry) onExpandedChange?.(entry.name, expanded);
  }, [expanded, entry?.name, onExpandedChange]);
  const listing = useAPI<ResourceList<FileEntry>>(
    expanded && !searching ? `${shared.base}/files/list?directory=${encodeURIComponent(path)}` : null
  );

  // Refresh expanded listings in place so rows and nested expansion survive.
  const refreshed = useRef(shared.refreshToken);
  useEffect(() => {
    if (!expanded || refreshed.current === shared.refreshToken) return;
    refreshed.current = shared.refreshToken;
    listing.reload();
  }, [expanded, shared.refreshToken, listing.reload]);
  const prefix = path === '/' ? '' : path;
  const searchReady = searching && shared.searchResult.term === shared.filter.trim().toLocaleLowerCase();
  const entries = useMemo(
    () =>
      searching
        ? searchReady
          ? shared.searchResult.entries.get(path) || []
          : []
        : (items(listing.data) as FileEntry[]),
    [searching, searchReady, shared.searchResult, path, listing.data]
  );
  useEffect(() => {
    if (entries.length || listing.data || searchReady) shared.onEntries?.(path, entries);
  }, [entries, path, shared.onEntries, listing.data, searchReady]);
  const visible = useMemo(() => {
    const filter = shared.filter.trim().toLocaleLowerCase();
    const sizes = Object.fromEntries(entries.map(entry => [entry.name, shared.scan.sizes[`${prefix}/${entry.name}`]]));
    return sortFiles(
      entries.filter(
        entry =>
          !filter ||
          (entry.is_file
            ? entry.name.toLocaleLowerCase().includes(filter)
            : searchReady && shared.searchResult.folders.has(`${prefix}/${entry.name}`))
      ),
      shared.sort,
      sizes
    );
  }, [entries, shared.filter, shared.sort, shared.scan.sizes, shared.searchResult, searchReady, prefix]);

  // Child folder sizes load in batches for the whole listing, not one read per row.
  const sizeTargets = useMemo(
    () =>
      open && !shared.activeFile
        ? visible
            .filter(child => !child.is_file && !child.is_symlink && depth < 32)
            .map(child => `${prefix}/${child.name}`)
        : [],
    [open, shared.activeFile, visible, depth, prefix]
  );
  const sizeRequests = useMemo(() => folderSizeRequests(shared.base, sizeTargets), [shared.base, sizeTargets]);
  const failedSizes = sizeTargets.filter(target => shared.scan.failed[target]);

  const list = useRef<HTMLUListElement>(null);
  const [expandedChildren, setExpandedChildren] = useState<ReadonlySet<string>>(() => new Set());
  const childExpanded = useCallback(
    (name: string, value: boolean) =>
      setExpandedChildren(old => {
        if (old.has(name) === value) return old;
        const next = new Set(old);
        if (value) next.add(name);
        else next.delete(name);
        return next;
      }),
    []
  );
  const [focused, setFocused] = useState<string | null>(null);
  const activeChild = activePath.startsWith(prefix + '/') ? activePath.slice(prefix.length + 1).split('/')[0] : '';
  const pinnedKeys = useMemo(() => {
    const keys = new Set(expandedChildren);
    if (focused) keys.add(focused);
    if (activeChild) keys.add(activeChild);
    return keys;
  }, [expandedChildren, focused, activeChild]);
  const rowKeys = useMemo(() => visible.map(child => child.name), [visible]);
  const rowsInView = useRowWindow(list, rowKeys, pinnedKeys);
  const windowed = rowKeys.length > ROW_WINDOW_THRESHOLD;
  // Keep the focused row rendered, so focus is not lost when it scrolls away.
  const ownRow = (target: EventTarget | null) => {
    let node = target as HTMLElement | null;
    while (node && node.parentElement !== list.current) node = node.parentElement;
    return node?.dataset?.entry ?? null;
  };
  const focusEvents = windowed
    ? {
        onFocus: (event: FocusEvent<HTMLUListElement>) => {
          const name = ownRow(event.target);
          if (name === null) return;
          setFocused(name);
          // When a row next to the focused one is not rendered, bring the focused
          // row to the middle of the view, so the rows Tab and Shift+Tab reach
          // next are rendered. Pinned rows elsewhere in the list do not count.
          const index = visible.findIndex(child => child.name === name);
          const rendered = new Set(rowsInView.rows.map(slice => slice.index));
          const missing = (neighbour: number) =>
            neighbour >= 0 && neighbour < visible.length && !rendered.has(neighbour);
          if (index >= 0 && (missing(index - 1) || missing(index + 1)))
            (event.target as HTMLElement).scrollIntoView?.({block: 'center'});
        },
        onBlur: (event: FocusEvent<HTMLUListElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(null);
        },
      }
    : undefined;

  const row = (child: FileEntry) => {
    const entryPath = `${prefix}/${child.name}`;
    return child.is_file || child.is_symlink || depth >= 32 ? (
      <FileRow
        entry={child}
        path={entryPath}
        depth={depth + 1}
        selected={shared.controls?.membership.has(entryPath) || false}
        active={shared.activeFile === entryPath}
        dirty={shared.activeFile === entryPath && shared.dirty}
        compact={!!shared.activeFile}
        readable={can(shared.permissions, 'file.read-content')}
        onOpen={shared.onOpen}
        onSelect={shared.controls?.onSelect}
        onMenu={shared.controls?.onMenu}
      />
    ) : (
      <Folder
        {...shared}
        path={entryPath}
        label={child.name}
        entry={child}
        depth={depth + 1}
        onExpandedChange={childExpanded}
      />
    );
  };
  return (
    <li className="explorer-folder" data-entry={entry?.name}>
      <Feedback
        tone="error"
        message={
          failedSizes.length
            ? `Could not load the size of ${failedSizes.length === 1 ? failedSizes[0] : `${failedSizes.length} folders in ${path}`}. Refresh to retry.`
            : ''
        }
      />
      {sizeRequests.map(request => (
        <FolderSizeBatch
          key={request.url}
          url={request.url}
          directories={request.directories}
          refreshToken={shared.refreshToken}
          report={shared.scan.report}
        />
      ))}
      <div
        className={`explorer-folder-row${shared.activeDirectory === path && !shared.activeFile ? ' is-current' : ''}${shared.controls?.membership.has(path) ? ' is-selected' : ''}`}
      >
        {path !== '/' && <EntryCheck path={path} controls={shared.controls} />}
        {shared.onDirectory && (
          <button
            type="button"
            className="explorer-toggle"
            style={{left: 10 + depth * 14 + (shared.controls && path !== '/' ? 40 : 0)}}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${path}`}
            onClick={() => setExpanded(v => !v)}
          >
            <span className={`explorer-chevron${expanded ? ' is-expanded' : ''}`} aria-hidden="true">
              ›
            </span>
          </button>
        )}
        <button
          type="button"
          className={`explorer-row explorer-folder-button${path === '/' ? ' explorer-root' : ''}`}
          aria-expanded={shared.onDirectory ? undefined : expanded}
          aria-label={shared.onDirectory ? `Browse ${path}` : `${expanded ? 'Collapse' : 'Expand'} ${path}`}
          aria-current={shared.activeDirectory === path && !shared.activeFile ? 'page' : undefined}
          style={{paddingLeft: shared.onDirectory ? 28 + depth * 14 : 10 + depth * 14}}
          title={path}
          onClick={event => {
            if (shared.controls && !plainFileClick(event) && path !== '/') {
              shared.controls.onSelect(path);
              return;
            }
            if (shared.onDirectory) {
              setExpanded(value => (shared.activeDirectory === path ? !value : true));
              shared.onDirectory(path);
            } else setExpanded(v => !v);
          }}
        >
          {!shared.onDirectory && (
            <span className={`explorer-chevron${expanded ? ' is-expanded' : ''}`} aria-hidden="true">
              ›
            </span>
          )}
          <Icon name="files" />
          <span>{label}</span>
        </button>
        {entry && !shared.activeFile && (
          <EntryMetadata
            entry={entry}
            path={path}
            folderSize={shared.scan.sizes[path]}
            folderError={!!shared.scan.failed[path]}
          />
        )}
        {path !== '/' && <EntryMenu path={path} controls={shared.controls} />}
      </div>
      {open && (
        <ul ref={list} {...focusEvents}>
          {!searching && listing.loading && !listing.data ? (
            <li>
              <CollectionSkeleton layout="files" label="Loading folder" count={5} />
            </li>
          ) : !searching && !listing.data && listing.error ? (
            <>
              <Feedback tone="error" message={<>Could not load this folder.</>} />
              <button type="button" onClick={listing.reload}>
                Retry
              </button>
            </>
          ) : (
            <>
              {!searching && listing.loading && (
                <li className="button-feedback-sr" role="status">
                  Refreshing folder…
                </li>
              )}

              {!searching && listing.error && (
                <>
                  <Feedback tone="error" message={<>Could not refresh this folder.</>} />
                  <button type="button" onClick={listing.reload}>
                    Retry
                  </button>
                </>
              )}
              {rowsInView.rows.map(({index, gap}) => {
                const child = visible[index];
                return (
                  <Fragment key={child.name}>
                    {gap > 0 && <li className="explorer-spacer" aria-hidden="true" style={{height: gap}} />}
                    {row(child)}
                  </Fragment>
                );
              })}
              {rowsInView.tail > 0 && (
                <li className="explorer-spacer" aria-hidden="true" style={{height: rowsInView.tail}} />
              )}
              {!visible.length && (
                <li className="explorer-message">{shared.filter ? 'No matching files' : 'Empty folder'}</li>
              )}
            </>
          )}
        </ul>
      )}
    </li>
  );
}

const FileExplorer = memo(function FileExplorer({
  base,
  activeFile,
  activeDirectory,
  dirty,
  permissions,
  onOpen,
  onBrowse,
  onDirectory,
  refreshKey = 0,
  onEntries,
  controls,
}: {
  base: string;
  activeFile: string;
  activeDirectory?: string;
  dirty: boolean;
  permissions: string[];
  onOpen: (path: string) => void;
  onBrowse: () => void;
  onDirectory?: (path: string) => void;
  refreshKey?: number;
  onEntries?: Shared['onEntries'];
  controls?: Controls;
}) {
  const membership = useMemo(() => new Set(controls?.selected), [controls?.selected]);
  const treeControls = useMemo(() => (controls ? {...controls, membership} : undefined), [controls, membership]);
  const [filter, setFilter] = useState(''),
    [version, setVersion] = useState(0);
  const [sort, setSort] = useState<FileSort>(null),
    [sizes, setSizes] = useState<Record<string, number>>({}),
    [failed, setFailed] = useState<Record<string, true>>({});
  const [searchResult, setSearchResult] = useState<SearchResult>({term: '', entries: new Map(), folders: new Set()}),
    [searching, setSearching] = useState(false),
    [searchError, setSearchError] = useState('');
  const report = useCallback((requested: string[], measured: Record<string, number>, unavailable: string[]) => {
    const missing = new Set(unavailable);
    setSizes(old => {
      let next: Record<string, number> | null = null;
      for (const path of requested) {
        const size = measured[path];
        if (size !== undefined ? old[path] === size : !missing.has(path) || !(path in old)) continue;
        next ??= {...old};
        if (size === undefined) delete next[path];
        else next[path] = size;
      }
      return next ?? old;
    });
    setFailed(old => {
      let next: Record<string, true> | null = null;
      for (const path of requested) {
        if (missing.has(path) === !!old[path]) continue;
        next ??= {...old};
        if (missing.has(path)) next[path] = true;
        else delete next[path];
      }
      return next ?? old;
    });
  }, []);
  useEffect(() => {
    setSizes(old => (Object.keys(old).length ? {} : old));
    setFailed(old => (Object.keys(old).length ? {} : old));
  }, [base, version, refreshKey]);
  const list = async (path: string, signal: AbortSignal): Promise<FileEntry[]> =>
    items(await api<ResourceList<FileEntry>>(`${base}/files/list?directory=${encodeURIComponent(path)}`, {signal}));
  useEffect(() => {
    const controller = new AbortController(),
      term = filter.trim().toLocaleLowerCase();
    setSearchError('');
    setSearching(!!term);
    if (!term) {
      setSearchResult(old => (old.term ? {term: '', entries: new Map(), folders: new Set()} : old));
      return () => controller.abort();
    }
    const timer = globalThis.setTimeout(async () => {
      try {
        const result = await searchFileTree('/', term, list, controller.signal);
        if (!controller.signal.aborted) {
          setSearchResult({term, entries: result.entries as Map<string, FileEntry[]>, folders: result.folders});
          setSearchError(result.errors.length ? `Search is incomplete. ${result.errors.slice(0, 3).join(' ')}` : '');
        }
      } catch {
        if (!controller.signal.aborted) setSearchError('Could not search folders. Refresh and try again.');
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      globalThis.clearTimeout(timer);
      controller.abort();
    };
  }, [base, filter, version, refreshKey]);
  const scan = useMemo<ScanControls>(() => ({sizes, failed, report}), [sizes, failed, report]);
  const header = (key: NonNullable<FileSort>['key'], label: string) => (
    <button
      type="button"
      className="explorer-sort"
      onClick={() => setSort(nextFileSort(sort, key))}
      aria-label={`${label}: ${sort?.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'default order'}. Click to change sorting.`}
      title="Cycle ascending, descending and default order"
    >
      {label}
      {sort?.key === key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  );

  return (
    <aside className={`file-explorer ${activeFile ? 'is-compact' : 'has-metadata'}`} aria-label="File explorer">
      <div className="file-explorer-header">
        <span>Explorer</span>
        <div>
          <button
            type="button"
            className="file-icon-button"
            aria-label="Refresh file explorer"
            title="Refresh files"
            onClick={() => setVersion(v => v + 1)}
          >
            <Icon name="restart" />
          </button>
          <button
            type="button"
            className="file-icon-button"
            aria-label="Open full file browser"
            title="Open full file browser"
            onClick={onBrowse}
          >
            <Icon name="files" />
          </button>
        </div>
      </div>
      <div className="file-explorer-search">
        <Icon name="search" />
        <input
          type="search"
          aria-label="Filter explorer files"
          placeholder="Filter files…"
          value={filter}
          onChange={event => setFilter(event.target.value)}
        />
      </div>
      <Feedback tone="error" message={searchError} />
      {searching && (
        <p className="explorer-message" role="status">
          <TerminalSpinner /> Searching inside folders…
        </p>
      )}
      {filter.trim() && (
        <p className="explorer-message">Matching files and their folders. Symbolic links are not searched.</p>
      )}
      <nav aria-label="Server files" className="file-explorer-tree">
        <div className="explorer-columns">
          <span>{header('name', 'Name')}</span>
          <span className="explorer-metadata">
            <span className="explorer-modified">{header('modified_at', 'Date modified')}</span>
            <span className="explorer-type">Type</span>
            <span className="explorer-size">{header('size', 'Size')}</span>
          </span>
          <span className="explorer-action-space" />
        </div>
        <ul>
          <Folder
            key={base}
            sort={sort}
            scan={scan}
            searchResult={searchResult}
            refreshToken={`${version}:${refreshKey}`}
            path="/"
            label="/ home / container"
            base={base}
            activeFile={activeFile}
            activeDirectory={activeDirectory}
            dirty={dirty}
            filter={filter}
            permissions={permissions}
            onOpen={onOpen}
            onDirectory={onDirectory}
            onEntries={onEntries}
            controls={treeControls}
          />
        </ul>
      </nav>
    </aside>
  );
});
export default FileExplorer;
