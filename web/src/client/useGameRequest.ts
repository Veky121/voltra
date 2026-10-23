import {useCallback, useEffect, useState} from 'react';
import {api, unwrap} from '../lib';

// A path change must never show the previous server's settings or permissions.
export function useGameRequest<T>(path: string | null, poll = 0) {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{path: string | null; data: T | null; error: string; loading: boolean}>({path, data: null, error: '', loading: !!path});
  const reload = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    if (!path) {setResult({path, data: null, error: '', loading: false}); return;}
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function read() {
      setResult(previous => ({path, data: previous.path === path ? previous.data : null, error: '', loading: true}));
      try {
        const data = unwrap(await api(path!, {signal: abort.signal})) as T;
        if (active) setResult({path, data, error: '', loading: false});
      } catch (error) {
        if (active) setResult(previous => ({path, data: previous.path === path ? previous.data : null, error: error instanceof Error ? error.message : String(error), loading: false}));
      } finally {
        if (active && poll) timer = setTimeout(read, poll);
      }
    }
    void read();
    return () => {active = false; clearTimeout(timer); abort.abort();};
  }, [path, version, poll]);
  return {...(result.path === path ? result : {data: null, error: '', loading: !!path}), reload};
}
