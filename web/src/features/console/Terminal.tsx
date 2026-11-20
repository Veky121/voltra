import {confirmAction} from '../../ui/ConfirmAction';
import {IconButton} from '../../ui/IconButton';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../components/ui/dropdown-menu';
import {requestServerPower} from '../servers/serverPower';
import {memo, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {consoleViewport, consoleViewportChunks, type ConsoleRange} from './consoleViewport';
import {Icon} from '../../Icons';
import {can, Notice, useAction, useServer} from '../shared/common';
import {
  CONSOLE_HISTORY_LINES,
  CONSOLE_HISTORY_CHARACTERS,
  consoleHistoryText,
  type ConsoleHistory,
  type ConsoleHistoryChunk,
} from './consoleHistory';
import {stripConsoleControls} from './consoleOutput';
import type {InstallStage} from './installProgress';
import {InstallOverlay, useInstallOverlay} from './InstallOverlay';

const HistoryChunk = memo(function HistoryChunk({chunk}: {chunk: ConsoleHistoryChunk}) {
  return (
    <>
      {chunk.lines.map(line => (
        <span key={line.id} className={`console-line console-level-${line.formatted.level}`}>
          {line.formatted.segments.map((segment, i) => (
            <span key={i} style={segment.style}>
              {segment.text}
            </span>
          ))}
        </span>
      ))}
    </>
  );
});

export default function Terminal({
  history: logHistory,
  status,
  connection,
  busy,
  installStages,
  installScope,
  installSuccess,
  canReadInstallLog,
  installHistory,
  installStream,
  installAttempt,
  onClear,
  onSend,
}: {
  history: ConsoleHistory;
  status: string;
  connection: string;
  busy: boolean;
  installStages?: InstallStage[];
  installScope: string;
  installSuccess: 'Installed' | 'Server started';
  canReadInstallLog: boolean;
  installHistory: ConsoleHistory;
  installStream: ConsoleHistory;
  installAttempt: number;
  onClear: () => void;
  onSend: (command: string, done: () => void) => void;
}) {
  const {server, base, permissions} = useServer();
  const action = useAction();
  const [command, setCommand] = useState(''),
    [autoScroll, setAutoScroll] = useState(true),
    [history, setHistory] = useState<string[]>([]);
  const output = useRef<HTMLPreElement>(null),
    input = useRef<HTMLInputElement>(null),
    overlay = useRef<HTMLDivElement>(null);
  const {visible, exiting, engaged} = useInstallOverlay(installScope, !!installStages, installSuccess, overlay, output);
  const [toolsOpen, setToolsOpen] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false);
  const installerChunks = useMemo(
    () => installStream.chunks.map(chunk => ({...chunk, id: -1 - chunk.id})),
    [installStream]
  );
  const selectedHistory = useMemo(
    () =>
      engaged && canReadInstallLog && installStream.count
        ? {
            ...logHistory,
            chunks: [...installerChunks, ...logHistory.chunks],
            count: installStream.count + logHistory.count,
            characters: installStream.characters + logHistory.characters,
          }
        : logHistory,
    [engaged, canReadInstallLog, logHistory, installStream, installerChunks]
  );
  const historyIndex = useRef(-1),
    draft = useRef('');
  const [selection, setSelection] = useState<{
    display: ConsoleHistory;
    runtime: ConsoleHistory;
    canReadInstallLog: boolean;
  } | null>(null);
  const heldHistory = selection?.canReadInstallLog === canReadInstallLog ? selection : null;
  const currentHistory = useRef({display: selectedHistory, runtime: logHistory, canReadInstallLog}),
    pointerSelecting = useRef(false);
  const selectionWindow = useRef<ConsoleRange | null>(null);
  const [viewport, setViewport] = useState({top: 0, height: 400, lineHeight: 20.8, inset: 0});
  currentHistory.current = {display: selectedHistory, runtime: logHistory, canReadInstallLog};
  const displayed = heldHistory?.display ?? selectedHistory;
  const runtimeHistory = heldHistory?.runtime ?? logHistory;
  const range = consoleViewport(
    displayed.count,
    viewport.top - viewport.inset,
    viewport.height,
    viewport.lineHeight,
    heldHistory ? selectionWindow.current : null
  );
  const currentRange = useRef(range);
  currentRange.current = range;
  const visibleChunks = useMemo(() => consoleViewportChunks(displayed, range), [displayed, range.start, range.end]);
  const measureViewport = () => {
    const element = output.current;
    if (!element) return;
    const next = {
      top: element.scrollTop,
      height: element.clientHeight,
      inset: overlay.current?.offsetHeight ?? 0,
      lineHeight: parseFloat(getComputedStyle(element).lineHeight) || 20.8,
    };
    setViewport(old =>
      old.top === next.top &&
      old.height === next.height &&
      old.lineHeight === next.lineHeight &&
      old.inset === next.inset
        ? old
        : next
    );
  };
  useLayoutEffect(() => {
    measureViewport();
    const observer = new ResizeObserver(measureViewport);
    if (output.current) observer.observe(output.current);
    if (overlay.current) observer.observe(overlay.current);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    pointerSelecting.current = false;
    setSelection(null);
    setAutoScroll(true);
  }, [base]);
  useLayoutEffect(() => {
    if (output.current?.contains(window.getSelection()?.anchorNode ?? null)) window.getSelection()?.removeAllRanges();
    pointerSelecting.current = false;
    selectionWindow.current = null;
    setSelection(null);
  }, [installScope, installAttempt, canReadInstallLog]);
  const working = busy || action.busy,
    running = status === 'running';
  const plainLog = (log: ConsoleHistory) => stripConsoleControls(consoleHistoryText(log));
  function copyLog(log: ConsoleHistory, label: string) {
    void action.run(
      async () => {
        if (!navigator.clipboard)
          throw new Error('Clipboard access is unavailable. Use the Save option to keep a copy.');
        await navigator.clipboard.writeText(plainLog(log));
      },
      () => action.setSuccess(`${label} copied.`)
    );
  }
  useLayoutEffect(() => {
    if (autoScroll && !heldHistory && output.current) {
      output.current.scrollTop = output.current.scrollHeight;
      measureViewport();
    }
  }, [displayed, autoScroll, heldHistory, viewport.inset]);
  useEffect(() => {
    const selectionInOutput = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount || !output.current) return false;
      return selection.getRangeAt(0).intersectsNode(output.current);
    };
    const syncSelection = () => {
      if (pointerSelecting.current) return;
      if (selectionInOutput()) {
        selectionWindow.current ??= currentRange.current;
        setSelection(old => old ?? currentHistory.current);
        setAutoScroll(false);
      } else {
        selectionWindow.current = null;
        setSelection(null);
      }
    };
    const releasePointer = () => {
      pointerSelecting.current = false;
      syncSelection();
    };
    document.addEventListener('selectionchange', syncSelection);
    document.addEventListener('pointerup', releasePointer);
    document.addEventListener('pointercancel', releasePointer);
    return () => {
      document.removeEventListener('selectionchange', syncSelection);
      document.removeEventListener('pointerup', releasePointer);
      document.removeEventListener('pointercancel', releasePointer);
    };
  }, []);
  function saveLog(text: string, kind: 'console' | 'install') {
    setToolsOpen(false);
    const url = URL.createObjectURL(new Blob([text], {type: 'text/plain'}));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${server.name}-${kind}.log`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function recall(direction: number) {
    if (!history.length) return;
    if (historyIndex.current === -1) draft.current = command;
    historyIndex.current = Math.max(-1, Math.min(history.length - 1, historyIndex.current + direction));
    setCommand(historyIndex.current === -1 ? draft.current : history[historyIndex.current]);
  }
  return (
    <>
      <Notice action={action} />
      <div className="console-terminal">
        <div className="console-terminal-header">
          <span className="console-terminal-title">
            <Icon name="console" />
            Console
          </span>
          <div className="console-log-tools" role="toolbar" aria-label="Console tools">
            <span className={`console-connection connection-${connection.toLowerCase()}`} role="status">
              <span />
              {connection}
            </span>
            {!autoScroll && (
              <span className="console-paused">{heldHistory ? 'Selection held' : 'Auto-scroll paused'}</span>
            )}
            <IconButton
              type="button"
              className="console-icon-button"
              aria-label={autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
              title={autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
              aria-pressed={!autoScroll}
              onClick={() => {
                if (!autoScroll) {
                  window.getSelection()?.removeAllRanges();
                  setSelection(null);
                }
                setAutoScroll(v => !v);
              }}
            >
              <Icon name={autoScroll ? 'pause' : 'play'} />
            </IconButton>
            <IconButton
              type="button"
              className="console-icon-button"
              aria-label="Copy console output"
              title="Copy console output"
              disabled={!runtimeHistory.count || working}
              onClick={() => copyLog(runtimeHistory, 'Console output')}
            >
              <Icon name="copy" />
            </IconButton>
            <IconButton
              type="button"
              className="console-icon-button"
              aria-label="Clear console display"
              title="Clear display"
              disabled={!displayed.count}
              onClick={() => {
                setSelection(null);
                onClear();
              }}
            >
              <Icon name="trash" />
            </IconButton>
            <DropdownMenu open={toolsOpen} onOpenChange={setToolsOpen} modal={false}>
              <DropdownMenuTrigger
                render={
                  <IconButton
                    className="console-icon-button"
                    aria-label="More console tools"
                    title="More console tools"
                  />
                }
              >
                <Icon name="more" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="console-dropdown" align="end">
                <p className="console-history-budget">
                  {logHistory.count.toLocaleString()} / {CONSOLE_HISTORY_LINES.toLocaleString()} lines | up to{' '}
                  {(CONSOLE_HISTORY_CHARACTERS * 2) / 1024 ** 2} MB
                </p>
                <DropdownMenuItem
                  disabled={!runtimeHistory.count}
                  onClick={() => saveLog(plainLog(runtimeHistory), 'console')}
                >
                  <Icon name="download" />
                  Save console log
                </DropdownMenuItem>
                {canReadInstallLog && installHistory.count > 0 && (
                  <>
                    <DropdownMenuItem
                      disabled={working}
                      onClick={() => {
                        setToolsOpen(false);
                        copyLog(installHistory, 'Install log');
                      }}
                    >
                      <Icon name="copy" />
                      Copy install log
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => saveLog(plainLog(installHistory), 'install')}>
                      <Icon name="download" />
                      Save install log
                    </DropdownMenuItem>
                  </>
                )}
                {can(permissions, 'control.stop') && (
                  <DropdownMenuItem
                    className="console-force-stop"
                    disabled={working || !['running', 'starting', 'stopping'].includes(status)}
                    onClick={async () => {
                      if (
                        await confirmAction({
                          title: 'Force stop?',
                          description: 'Immediately kill the server process? Unsaved data may be lost.',
                          confirmLabel: 'Force stop',
                          danger: true,
                        })
                      )
                        void action.run(
                          () => requestServerPower(base, 'kill'),
                          () => action.setSuccess('Force stop requested.')
                        );
                    }}
                  >
                    <Icon name="stop" />
                    Force stop
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="console-terminal-body">
          {visible && (
            <InstallOverlay stages={installStages} success={installSuccess} exiting={exiting} overlayRef={overlay} />
          )}
          <pre
            ref={output}
            className="console-output"
            aria-label="Server console output"
            tabIndex={0}
            onPointerDown={event => {
              if (event.button === 0) {
                selectionWindow.current = currentRange.current;
                pointerSelecting.current = true;
                setSelection(old => old ?? currentHistory.current);
                setAutoScroll(false);
              }
            }}
            onScroll={() => {
              measureViewport();
              const element = output.current;
              if (element && !pointerSelecting.current && !heldHistory)
                setAutoScroll(element.scrollHeight - element.scrollTop - element.clientHeight < 32);
            }}
          >
            {viewport.inset > 0 && (
              <span className="console-spacer" aria-hidden="true" style={{height: viewport.inset}} />
            )}
            {displayed.count ? (
              <>
                <span
                  className="console-spacer"
                  aria-hidden="true"
                  style={{height: range.start * viewport.lineHeight}}
                />
                {visibleChunks.map(chunk => (
                  <HistoryChunk key={chunk.id} chunk={chunk} />
                ))}
                <span
                  className="console-spacer"
                  aria-hidden="true"
                  style={{height: (displayed.count - range.end) * viewport.lineHeight}}
                />
              </>
            ) : (
              <span className="console-empty">
                {visible && !canReadInstallLog
                  ? 'Installer output is visible to administrators.'
                  : 'Waiting for console output…'}
              </span>
            )}
          </pre>
        </div>
        {server.console_input_supported === false ? (
          <div className="console-readonly">
            This launcher provides logs only. Use Game Config and the power controls to manage the server.
          </div>
        ) : can(permissions, 'control.console') ? (
          <form
            className="console-command-bar"
            onSubmit={event => {
              event.preventDefault();
              if (!command.trim() || working || !running) return;
              const sent = command;
              onSend(sent, () => {
                setHistory(old => [sent, ...old.filter(c => c !== sent)].slice(0, 50));
                setCommand('');
                historyIndex.current = -1;
                draft.current = '';
                setHistoryOpen(false);
              });
            }}
          >
            <span className="console-prompt" aria-hidden="true">
              »
            </span>
            <input
              ref={input}
              type="text"
              className="console-command-input"
              aria-label="Console command"
              placeholder={running ? 'Type a command…' : 'Start the server to send commands…'}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={command}
              disabled={working}
              onChange={event => {
                setCommand(event.target.value);
                historyIndex.current = -1;
              }}
              onKeyDown={event => {
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  recall(event.key === 'ArrowUp' ? 1 : -1);
                }
              }}
            />
            <IconButton
              type="submit"
              className="console-icon-button console-send"
              aria-label="Send command"
              title="Send command · Enter"
              disabled={working || !running || !command.trim()}
            >
              <Icon name="send" />
            </IconButton>
            <DropdownMenu open={historyOpen} onOpenChange={setHistoryOpen} modal={false}>
              <DropdownMenuTrigger
                disabled={!history.length}
                render={
                  <IconButton
                    className="console-icon-button"
                    aria-label="Command history"
                    title={history.length ? 'Command history | Up / Down' : 'No commands sent in this session'}
                  />
                }
              >
                <Icon name="clock" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="console-dropdown console-dropdown-history"
                align="end"
                side="top"
                finalFocus={input}
                aria-label="Recent commands"
              >
                {history.map((entry, index) => (
                  <DropdownMenuItem
                    key={index}
                    onClick={() => {
                      setCommand(entry);
                      historyIndex.current = index;
                      setHistoryOpen(false);
                    }}
                  >
                    <Icon name="console" />
                    <code>{entry}</code>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </form>
        ) : (
          <div className="console-readonly">Read-only console access</div>
        )}
      </div>
    </>
  );
}
