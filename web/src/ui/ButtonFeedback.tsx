import type {ReactNode} from 'react';
import {TerminalSpinner} from './TerminalProgress';
import {Check} from 'lucide-react';
import './buttonFeedback.css';

export function ButtonFeedback({state, children}: {state: 'idle' | 'pending' | 'success'; children: ReactNode}) {
  return (
    <span className="button-feedback-icon" data-state={state} aria-hidden="true">
      {state === 'pending' ? (
        <TerminalSpinner />
      ) : state === 'success' ? (
        <Check className="button-feedback-check" />
      ) : (
        children
      )}
    </span>
  );
}
