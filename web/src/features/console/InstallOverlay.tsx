import {useEffect, useState, type RefObject} from 'react';
import {TerminalProgress} from '../../ui/TerminalProgress';
import {installProgressDetail, type InstallStage} from './installProgress';

type Success = 'Installed' | 'Server started';
type CompletionPhase = 'pending' | 'exiting' | 'finished';

export function useInstallOverlay(
  scope: string,
  active: boolean,
  success: Success,
  overlay: RefObject<HTMLDivElement | null>,
  output: RefObject<HTMLPreElement | null>
) {
  const [completion, setCompletion] = useState<{scope: string; phase: CompletionPhase}>();
  const phase = completion?.scope === scope ? completion.phase : undefined;
  useEffect(() => {
    if (active) {
      if (phase !== 'pending') setCompletion({scope, phase: 'pending'});
      return;
    }
    if (phase === 'pending') {
      const timer = setTimeout(() => setCompletion({scope, phase: 'exiting'}), 1000);
      return () => clearTimeout(timer);
    }
  }, [active, phase, scope, success]);

  useEffect(() => {
    if (active || phase !== 'exiting') return;
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 120 : 450;
    const timer = setTimeout(() => {
      if (overlay.current?.contains(document.activeElement)) output.current?.focus({preventScroll: true});
      setCompletion({scope, phase: 'finished'});
    }, duration);
    return () => clearTimeout(timer);
  }, [active, phase, scope]);

  return {
    visible: active || phase === 'pending' || phase === 'exiting',
    exiting: !active && phase === 'exiting',
    engaged: active || phase !== undefined,
  };
}

export function InstallOverlay({
  stages,
  success,
  exiting,
  overlayRef,
}: {
  stages?: InstallStage[];
  success: Success;
  exiting: boolean;
  overlayRef: RefObject<HTMLDivElement | null>;
}) {
  const done = stages?.filter(stage => stage.state === 'done').length ?? 0;
  const current = stages?.find(stage => stage.state === 'failed') ?? stages?.find(stage => stage.state === 'running');
  const next = stages?.find(stage => stage.state === 'waiting');
  const announcement = !stages
    ? success
    : current?.state === 'failed'
      ? `${current.label} failed`
      : (current?.label ?? next?.label ?? '');
  return (
    <div ref={overlayRef} className="console-install" data-state={exiting ? 'exiting' : stages ? 'active' : 'success'}>
      <div className="console-install-inner">
        <span className="scn:sr-only" role="status">
          {announcement}
        </span>
        <ol role="list" aria-label="Installation stages" className="console-install-stages" aria-live="off">
          {!stages ? (
            <li>
              <TerminalProgress label={success} state="done" statusText="" />
            </li>
          ) : (
            <>
              {done > 0 && (
                <li>
                  <TerminalProgress
                    label={`${done} ${done === 1 ? 'step' : 'steps'} done`}
                    state="done"
                    statusText=""
                  />
                </li>
              )}
              {current && (
                <li>
                  <TerminalProgress
                    label={current.label}
                    state={current.state}
                    value={current.state === 'running' ? current.progress?.value : undefined}
                    detail={current.state === 'running' ? installProgressDetail(current.progress) : undefined}
                    width={12}
                  />
                </li>
              )}
              {next && (
                <li>
                  <TerminalProgress label={next.label} state="waiting" />
                </li>
              )}
            </>
          )}
        </ol>
      </div>
    </div>
  );
}
