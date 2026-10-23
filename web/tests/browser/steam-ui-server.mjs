// Isolated fixture only. All /api requests are intercepted in the browser, with
// no proxy or backend connection. Never use real servers or reset panel auth.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const server = await createServer({root, configFile:false, plugins:[react()], server:{host:'127.0.0.1',port:5189,strictPort:true}, appType:'custom'});
server.middlewares.use(async (request, response) => {
  if (request.url?.startsWith('/api/')) {response.writeHead(500, {'Content-Type':'application/json'}); response.end(JSON.stringify({errors:[{detail:'Fixture API interception failed; no real backend is connected.'}]})); return;}
  try {
    const html = await server.transformIndexHtml(request.url || '/', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Steam UI isolated tests</title></head><body><div id="root"></div><script type="module" src="/tests/browser/steam-ui.tsx"></script></body></html>');
    response.writeHead(200, {'Content-Type':'text/html'}); response.end(html);
  } catch (error) {response.writeHead(500); response.end(String(error));}
});
await server.listen();
console.log('Isolated Steam UI fixture: http://127.0.0.1:5189/?suite=1');
