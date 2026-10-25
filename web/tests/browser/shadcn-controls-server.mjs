import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const server=await createServer({root,configFile:false,plugins:[react(),tailwindcss()],resolve:{alias:{'@':fileURLToPath(new URL('../../src',import.meta.url))}},server:{host:'127.0.0.1',port:5195,strictPort:true},appType:'custom'});
server.middlewares.use(async(req,res)=>{if(req.url?.startsWith('/api/')){res.writeHead(500);res.end('No live API allowed');return}const html=await server.transformIndexHtml('/','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/browser/shadcn-controls.tsx"></script></body></html>');res.writeHead(200,{'Content-Type':'text/html'});res.end(html)});
await server.listen();console.log('Controls fixture http://127.0.0.1:5195');
