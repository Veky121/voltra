import {Feedback} from '../../notifications';
import useRemoteTransfers, {type RemoteOptions} from '../servers/useRemoteTransfers';
import {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react';
import Uppy from '@uppy/core';
import Tus from '@uppy/tus';
import Dashboard from '@uppy/react/dashboard';
import {useUppyState} from '@uppy/react';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '../../components/ui/collapsible';
import {Button} from '../../components/ui/button';
import {TerminalProgress} from '../../ui/TerminalProgress';
import {bytesProgressValue, formatBytesProgress} from '../../ui/terminalProgressModel';
import {api} from '../../lib';
import type {Resource} from '../../types/api';
import {can} from '../shared/common';
import {transferIdentity, uploadTarget} from './fileTransferPaths';
import '@uppy/core/css/style.min.css';
import '@uppy/dashboard/css/style.min.css';
import './fileTransfers.css';

type TransferMeta = {
  name: string;
  type?: string;
  filename?: string;
  directory?: string;
  relativePath?: string | null;
  filetype?: string;
  scope?: string;
};
type TransferBody = Record<string, unknown>;
type Queue = Uppy<TransferMeta, TransferBody>;
type Finalization = {
  id: string;
  name: string;
  directory: string;
  url: string;
  state: 'saving' | 'failed' | 'complete';
  error?: string;
};
export type FileTransfersHandle = {
  addRemote: (options: RemoteOptions) => Promise<void>;
  addFiles: (files: File[], folder?: boolean, targetDirectory?: string) => Promise<void>;
};
export type FileTransfersProps = {
  base: string;
  directory: string;
  permissions: string[];
  onComplete: () => void;
  onPendingChange?: (pending: boolean) => void;
};

function UploadProgress({queue, perFile = false}: {queue: Queue; perFile?: boolean}) {
  const files = useUppyState(queue, state => state.files);
  const totalProgress = useUppyState(queue, state => state.totalProgress);
  const started = Object.values(files).filter(file => file.progress.uploadStarted && !file.progress.uploadComplete);
  if (!started.length) return null;
  const failed = started.every(file => !!file.error);
  const paused = started.every(file => file.isPaused || !!file.error);
  if (!perFile)
    return (
      <div className="file-upload-progress">
        <TerminalProgress
          label={failed ? 'Upload failed' : paused ? 'Uploads paused' : 'Uploading files'}
          ariaLabel="Uploading files"
          statusText=""
          value={totalProgress}
          state={failed ? 'failed' : paused ? 'waiting' : 'running'}
          width={18}
        />
      </div>
    );
  return (
    <Collapsible className="file-upload-progress">
      <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>Per-file progress</CollapsibleTrigger>
      <CollapsibleContent>
        {started.map(file => {
          const {bytesUploaded, bytesTotal} = file.progress;
          const sent = bytesUploaded === false ? null : bytesUploaded;
          return (
            <TerminalProgress
              key={file.id}
              label={file.name}
              ariaLabel={`Uploading ${file.name}`}
              statusText={file.isPaused && !file.error ? 'Paused' : undefined}
              value={bytesProgressValue(sent, bytesTotal)}
              detail={formatBytesProgress(sent, bytesTotal)}
              state={file.error ? 'failed' : file.isPaused ? 'waiting' : 'running'}
              width={18}
            />
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}

const FileTransfers = forwardRef<FileTransfersHandle, FileTransfersProps>(function FileTransfers(props, ref) {
  const current = useRef(props);
  current.current = props;
  const remote = useRemoteTransfers(props.base, props.permissions, props.onComplete);
  const [uppy, setUppy] = useState<Queue | null>(null),
    [error, setError] = useState(''),
    [expanded, setExpanded] = useState(false),
    [count, setCount] = useState(0);
  const [finalizations, setFinalizations] = useState<Record<string, Finalization>>({});
  const records = useRef<Record<string, Finalization>>({});
  const finalizeRef = useRef<(entry: Finalization) => Promise<void>>(async () => {});
  useEffect(() => {
    let mounted = true;

    records.current = {};
    setFinalizations({});
    const reportPending = () =>
      current.current.onPendingChange?.(
        queue.getFiles().some(f => !f.progress.uploadComplete) ||
          Object.values(records.current).some(f => f.state !== 'complete')
      );
    const update = (entry: Finalization) => {
      records.current = {...records.current, [entry.id]: entry};
      if (mounted) {
        setFinalizations(records.current);
        reportPending();
      }
    };
    // While another tab's session change is being checked, nothing is sent:
    // uploads pause and finished ones wait to be saved. They resume only once
    // the same account is confirmed; a different account remounts the page.
    let held = false;
    let waiting: Finalization[] = [];
    const finalize = async (entry: Finalization) => {
      if (held) {
        waiting = [...waiting.filter(other => other.id !== entry.id), entry];
        return;
      }
      if (records.current[entry.id]?.state === 'saving') return;
      update({...entry, state: 'saving', error: undefined});
      try {
        // Saving through api() refreshes the server's file reads; onComplete is
        // for remote downloads, which finish without a request from this page.
        await api(`${entry.url}/complete`, {method: 'POST'});
        update({...entry, state: 'complete'});
      } catch (cause) {
        update({...entry, state: 'failed', error: cause instanceof Error ? cause.message : String(cause)});
      }
    };
    finalizeRef.current = finalize;
    const queue = new Uppy<TransferMeta, TransferBody>({
      id: `file-transfers-${props.base}`,
      autoProceed: false,
      onBeforeFileAdded(file) {
        if (!can(current.current.permissions, 'file.create'))
          throw new Error('You do not have permission to upload files.');
        const directory = uploadTarget(
          String(file.meta.directory || current.current.directory),
          String(file.meta.relativePath || ''),
          file.name || ''
        );
        return {
          ...file,
          id: transferIdentity(props.base, directory, file.id),
          meta: {...file.meta, directory, filename: file.name, filetype: file.type, scope: props.base},
        };
      },
    });
    queue.use(Tus, {
      endpoint: `${props.base}/files/transfers`,
      chunkSize: 8 * 1024 * 1024,
      limit: 3,
      withCredentials: true,
      allowedMetaFields: ['filename', 'directory', 'filetype'],
      retryDelays: [0, 1000, 3000, 5000, 10000],
      onShouldRetry(err, _attempt, _options, next) {
        const status = err.originalResponse?.getStatus();
        return status === 401 || status === 403 ? false : next(err);
      },
    });
    queue.on('file-added', () => {
      if (mounted) {
        setCount(queue.getFiles().length);
        setExpanded(true);
        setError('');
        reportPending();
      }
    });
    queue.on('file-removed', file => {
      if (mounted) {
        setCount(queue.getFiles().length);
        reportPending();
      }
      const url = file.response?.uploadURL || file.tus?.uploadUrl;
      if (url && !records.current[file.id])
        void fetch(url, {method: 'DELETE', credentials: 'same-origin', headers: {'Tus-Resumable': '1.0.0'}}).catch(
          () => {}
        );
    });
    queue.on('upload-success', (file, response) => {
      if (!file) return;
      const url = response.uploadURL;
      if (!url) {
        if (mounted) setError('The upload finished without a transfer URL. Please retry the file.');
        return;
      }
      void finalize({
        id: file.id,
        name: file.name || 'File',
        directory: String(file.meta.directory || '/'),
        url,
        state: 'failed',
      });
    });
    queue.on('upload-error', (_file, cause) => {
      if (mounted) setError(cause.message || 'Upload failed. Retry the file to resume.');
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        queue.getFiles().some(f => !f.progress.uploadComplete) ||
        Object.values(records.current).some(f => f.state !== 'complete')
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    const hold = () => {
      held = true;
      queue.pauseAll();
    };
    const release = () => {
      if (!held) return;
      held = false;
      queue.resumeAll();
      const next = waiting;
      waiting = [];
      next.forEach(entry => void finalize(entry));
    };
    window.addEventListener('panel-session-elsewhere', hold);
    window.addEventListener('panel-session-confirmed', release);
    setUppy(queue);
    void api<Resource<{max_file_size?: number}>>(`${props.base}/files/transfers`)
      .then(result => {
        const max = result?.attributes?.max_file_size;
        if (mounted && typeof max === 'number' && max > 0) queue.setOptions({restrictions: {maxFileSize: max}});
      })
      .catch(cause => {
        if (mounted) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('panel-session-elsewhere', hold);
      window.removeEventListener('panel-session-confirmed', release);
      queue.destroy();
      current.current.onPendingChange?.(false);
      setUppy(null);
    };
  }, [props.base]);
  useImperativeHandle(
    ref,
    () => ({
      async addRemote(options) {
        setExpanded(true);
        await remote.start(options);
      },
      async addFiles(files, folder = false, targetDirectory = current.current.directory) {
        if (!uppy) throw new Error('Upload queue is starting. Please try again.');
        if (!can(current.current.permissions, 'file.create'))
          throw new Error('You do not have permission to upload files.');
        setExpanded(true);
        setError('');
        const errors: string[] = [];
        for (const file of files) {
          try {
            uppy.addFile({
              name: file.name,
              type: file.type,
              data: file,
              meta: {
                name: file.name,
                directory: targetDirectory,
                relativePath: folder
                  ? file.webkitRelativePath || (file as File & {relativePath?: string}).relativePath
                  : undefined,
              },
            });
          } catch (cause) {
            errors.push(cause instanceof Error ? cause.message : String(cause));
          }
        }
        if (errors.length) setError(errors.join(' '));
      },
    }),
    [uppy, remote.start]
  );
  async function discard(entry: Finalization) {
    try {
      const response = await fetch(entry.url, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: {'Tus-Resumable': '1.0.0'},
      });
      if (!response.ok && response.status !== 404) throw new Error(`Could not discard transfer (${response.status}).`);
      const next = {...records.current};
      delete next[entry.id];
      records.current = next;
      setFinalizations(next);
      if (uppy?.getFile(entry.id)) uppy.removeFile(entry.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  const pending = Object.values(finalizations).filter(entry => entry.state !== 'complete');
  if (!can(props.permissions, 'file.create') && !count && !pending.length) return null;
  return (
    <section className="file-transfers" aria-label="File transfers">
      <button
        type="button"
        className="file-transfers-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded(v => !v)}
      >
        <span>Uploads{count ? ` (${count})` : ''}</span>
        <span>
          {pending.length ? `${pending.length} awaiting save` : 'Files from this browser'} {expanded ? 'Hide' : 'Show'}
        </span>
      </button>
      {error && <Feedback tone="error" message={<>{error}</>} />}
      <div hidden={!expanded}>
        <p className="file-transfers-help">
          Files go to the folder open when you add them. Keep this page open to preserve your queue. Paused uploads
          resume from their last uploaded chunk. Uploaded files appear after saving to the server finishes.
        </p>
        {uppy && (
          <>
            <UploadProgress queue={uppy} />
            <Dashboard
              uppy={uppy}
              theme="dark"
              height={320}
              width="100%"
              proudlyDisplayPoweredByUppy={false}
              hideProgressDetails={false}
              hideRetryButton={false}
              hidePauseResumeButton={false}
              hideCancelButton={false}
              disabled={!can(props.permissions, 'file.create')}
              note={`Add files to ${props.directory}`}
            />
            <UploadProgress queue={uppy} perFile />
          </>
        )}
        {Object.values(finalizations).map(entry => (
          <div key={entry.id} className={`file-transfer-result is-${entry.state}`}>
            <span>
              <strong>{entry.name}</strong>
              <small>{entry.directory}</small>
            </span>
            <div className="file-transfer-state" role="status">
              <TerminalProgress
                label={
                  entry.state === 'saving'
                    ? 'Saving to server…'
                    : entry.state === 'complete'
                      ? 'Saved to server'
                      : 'Save failed'
                }
                state={entry.state === 'complete' ? 'done' : entry.state === 'failed' ? 'failed' : 'running'}
                value={null}
              />
            </div>
            {entry.state === 'failed' && <Feedback title={entry.name} message={entry.error} tone="error" />}
            {entry.state === 'failed' && (
              <>
                <button type="button" onClick={() => void finalizeRef.current(entry)}>
                  Retry save
                </button>
                <button type="button" onClick={() => void discard(entry)}>
                  Discard
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
});
export default FileTransfers;
