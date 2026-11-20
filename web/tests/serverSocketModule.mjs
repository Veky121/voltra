// Loads src/features/servers/serverSocket.ts for fixtures that run a component with fake
// globals, so the shared Wings socket uses the same fake socket, timers and api.
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(
  readFileSync(new URL('../src/features/servers/serverSocket.ts', import.meta.url), 'utf8'),
  {compilerOptions: {module: ts.ModuleKind.CommonJS}}
).outputText;
export function loadServerSocket({api, window, WebSocket, location, setTimeout, clearTimeout}) {
  const exports = {};
  new Function('require', 'exports', 'window', 'WebSocket', 'location', 'setTimeout', 'clearTimeout', source)(
    name => (name === '../../lib' ? {api} : {}),
    exports,
    window,
    WebSocket,
    location,
    setTimeout,
    clearTimeout
  );
  return exports;
}
