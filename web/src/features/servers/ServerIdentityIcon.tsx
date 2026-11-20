import {useEffect, useState} from 'react';
import {getServerIconSources, type ServerIdentityArtwork} from './serverArtwork';
import './serverIdentity.css';
import {Server} from 'lucide-react';

type Source = {src: string; kind: 'server' | 'modpack' | 'game'};
// Shown when there is no picture to draw, or every picture failed to load.
function Initial({initial}: {initial: string}) {
  return (
    <span className="server-identity-icon server-identity-initial" data-icon-source="initial" aria-hidden="true">
      {initial}
    </span>
  );
}
function IconImage({
  sources,
  revision,
  lazy,
  initial,
}: {
  sources: Source[];
  revision: number;
  lazy: boolean;
  initial?: string;
}) {
  const [index, setIndex] = useState(0);
  const source = sources[index];
  if (!source)
    return initial ? <Initial initial={initial} /> : <Server className="server-identity-icon" aria-hidden="true" />;
  return (
    <img
      className="server-identity-icon"
      data-icon-source={source.kind}
      src={source.kind === 'game' ? source.src : `${source.src}?v=${revision}`}
      alt=""
      aria-hidden="true"
      width={64}
      height={64}
      loading={lazy ? 'lazy' : 'eager'}
      decoding="async"
      title={source.kind === 'server' ? 'Server icon' : source.kind === 'modpack' ? 'Modpack artwork' : 'Game icon'}
      onError={() => setIndex(value => value + 1)}
    />
  );
}

export function ServerIdentityIcon({
  artwork,
  lazy = false,
  fallback,
  initial,
}: {
  artwork?: ServerIdentityArtwork;
  lazy?: boolean;
  fallback?: string;
  initial?: string;
}) {
  const sources: Source[] = [
    ...getServerIconSources(artwork),
    ...(fallback ? [{src: fallback, kind: 'game' as const}] : []),
  ];
  const key = sources.map(source => source.src).join('|');
  const [revision, setRevision] = useState(() => Math.floor(Date.now() / 60000));
  useEffect(() => {
    if (!key) return;
    const refresh = () => {
      if (!document.hidden) setRevision(Math.floor(Date.now() / 60000));
    };
    const timer = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [key]);
  return sources.length ? (
    <IconImage key={`${key}:${revision}`} sources={sources} revision={revision} lazy={lazy} initial={initial} />
  ) : initial ? (
    <Initial initial={initial} />
  ) : null;
}
