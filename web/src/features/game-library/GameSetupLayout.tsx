import {TerminalSpinner} from '../../ui/TerminalProgress';
import {useState, type ComponentProps, type ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {Button, Card, ErrorBox} from '../../lib';
import {PageHeading} from '../../ui/PageHeading';
import {GameSwitch} from '../shared/GameSwitch';
import type {GameArtwork} from './GameLibraryCard';
import './gameSetupLayout.css';

export function GameSetupPage({name, children}: {name?: string; children: ReactNode}) {
  return (
    <div className="page workspace-page game-setup-page games-ui">
      <header className="page-header game-setup-header">
        <div>
          <Link className="game-setup-back" to="/game-library">
            ← Game Library
          </Link>
          <PageHeading title={name ? `Create a ${name} server` : 'Create a game server'} />
        </div>
      </header>
      {children}
    </div>
  );
}

/** First letters of the first two words, for a game without a square logo. */
export function gameMonogram(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

export function GameSetupArtwork({artwork, name}: {artwork?: GameArtwork; name: string}) {
  const [failed, setFailed] = useState('');
  // Library art is mostly a wide title banner, unreadable in a square; only
  // logos drawn to fit (data-fit=contain) are shown as the icon.
  return artwork && artwork.fit === 'contain' && failed !== artwork.src ? (
    <img
      className="game-setup-art"
      src={artwork.src}
      alt=""
      data-fit={artwork.fit}
      onError={() => setFailed(artwork.src)}
    />
  ) : (
    <span className="game-icon game-setup-monogram" aria-hidden="true">
      {gameMonogram(name)}
    </span>
  );
}

export function GameSetupIdentity({
  icon,
  selection,
  children,
}: {
  icon?: ReactNode;
  selection?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className={`game-setup-identity${selection ? ' has-selection' : ''}`}>
      {selection}
      <div className="game-setup-name">
        {icon}
        <div>{children}</div>
      </div>
    </Card>
  );
}

export function GameSetupSection({number, title, children}: {number: number; title: string; children: ReactNode}) {
  return (
    <Card>
      <div className="game-setup-section-heading">
        <span aria-hidden="true">{number}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </Card>
  );
}

export function GameSetupUnitInput({children}: {children: ReactNode}) {
  return (
    <div className="game-setup-unit-input">
      {children}
      <span>GB</span>
    </div>
  );
}

export function GameSetupAgreement({
  title,
  url,
  links,
  children,
  ...control
}: ComponentProps<typeof GameSwitch> & {
  title: string;
  url?: string;
  links?: {title: string; url: string}[];
  children?: ReactNode;
}) {
  const documents = links?.length ? links : [{title, url}];
  return (
    <div className="game-setup-agreement">
      <label className="check">
        <GameSwitch aria-label={`I agree to the ${title}`} {...control} />
        <span>
          I agree to the{' '}
          {documents.map((document, index) => (
            <span key={`${document.title}:${index}`}>
              {index > 0 && (index === documents.length - 1 ? ' and the ' : ', the ')}
              {document.url && /^https?:\/\//i.test(document.url) ? (
                <a href={document.url} target="_blank" rel="noreferrer">
                  {document.title}
                </a>
              ) : (
                document.title
              )}
            </span>
          ))}
          .
        </span>
      </label>
      {children}
    </div>
  );
}

export function GameSetupSummary({
  name,
  subtitle,
  icon,
  rows,
  agreements,
  readiness,
  error,
  children,
  install,
  disabled,
  busy,
  describedBy,
  note,
  about,
}: {
  name: string;
  subtitle: string;
  icon: ReactNode;
  rows: {label: string; value: ReactNode}[];
  agreements?: ReactNode;
  readiness?: ReactNode;
  error?: string;
  children?: ReactNode;
  install: string;
  disabled: boolean;
  busy: boolean;
  describedBy?: string;
  note: ReactNode;
  about?: ReactNode;
}) {
  return (
    <aside className="game-setup-summary mc-install-summary">
      <Card className="game-setup-install">
        <div className="game-setup-summary-heading">
          {icon}
          <div>
            <h2>{name}</h2>
            <p>{subtitle}</p>
          </div>
        </div>
        <dl>
          {rows.map(({label, value}) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {agreements}
        {readiness}
        <ErrorBox>{error}</ErrorBox>
        {children}
        <Button type="submit" disabled={disabled || busy} aria-busy={busy} aria-describedby={describedBy}>
          {busy && <TerminalSpinner />}
          {busy ? 'Creating server...' : install}
        </Button>
        <p className="muted game-setup-install-note">{note}</p>
      </Card>
      {about && <Card className="game-setup-about">{about}</Card>}
    </aside>
  );
}

export type GameSetupProblem = {field?: string; message: string};

/**
 * Why Install is disabled: each requirement links to the control that resolves
 * it, so a disabled button never leaves the user guessing.
 */
export function GameSetupReadiness({
  id,
  problems,
  onFocus,
}: {
  id: string;
  problems: GameSetupProblem[];
  onFocus: (field: string) => void;
}) {
  if (!problems.length) return null;
  return (
    <section id={id} className="template-readiness" aria-label="Setup requirements">
      <p role="status">
        {problems.length === 1
          ? 'Complete this requirement to install your server.'
          : `Complete these ${problems.length} requirements to install your server.`}
      </p>
      <ul>
        {problems.map(({field, message}, index) => (
          <li key={`${field}:${index}`}>
            {field ? (
              <a
                href={`#${field}`}
                onClick={event => {
                  event.preventDefault();
                  onFocus(field);
                }}
              >
                {message}
              </a>
            ) : (
              message
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Where the default memory and storage come from, with the source when known. */
export function GameSetupSizing({
  recommendation,
}: {
  recommendation?: {confidence: string; note: string; source: string};
}) {
  if (!recommendation || recommendation.confidence === 'none' || !recommendation.note) return null;
  return (
    <p className="muted game-setup-sizing">
      {recommendation.note}{' '}
      {/^https:\/\//i.test(recommendation.source) && (
        <a href={recommendation.source} target="_blank" rel="noreferrer">
          Sizing source
        </a>
      )}
    </p>
  );
}
