import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const server=await createServer({root,configFile:false,plugins:[react()],server:{host:'127.0.0.1',port:5197,strictPort:true}});
server.middlewares.use('/api',(_req,res)=>{res.writeHead(500);res.end('No backend in this fixture')});
await server.listen();
console.log('Console fixture http://127.0.0.1:5197/tests/browser/console-history-ui.html');
