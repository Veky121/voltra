import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const server=await createServer({root,configFile:false,plugins:[react()],server:{host:'127.0.0.1',port:5193,strictPort:true},appType:'custom'});
server.middlewares.use(async(req,res)=>{
 if(req.url?.startsWith('/api/')){res.writeHead(500);res.end('Fixture request escaped interception');return;}
 const html=await server.transformIndexHtml('/', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Minecraft content fixture</title></head><body><div id="root"></div><script type="module" src="/tests/browser/minecraft-content-ui.tsx"></script></body></html>');
 res.writeHead(200,{'Content-Type':'text/html'});res.end(html);
});
await server.listen();console.log('Isolated Minecraft content fixture: http://127.0.0.1:5193');

