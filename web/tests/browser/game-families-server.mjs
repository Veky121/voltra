import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const server = await createServer({root, configFile:false, plugins:[react()], server:{host:'127.0.0.1',port:5196,strictPort:true,fs:{allow:[workspace]}}});
// No API proxy. Tests intercept catalog requests and reject all mutations.
server.middlewares.use('/api', (_request, response) => {response.writeHead(500, {'Content-Type':'application/json'});response.end(JSON.stringify({errors:[{detail:'Fixture API interception failed; no backend is connected.'}]}));});
await server.listen();
console.log('Game grouping isolated fixture: http://127.0.0.1:5196/tests/browser/game-families-ui.html?suite=1');
