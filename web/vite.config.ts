import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {fileURLToPath,URL} from 'node:url';
import {compressedAssets} from './build/compressedAssets';
// Open tabs may request lazy chunks from an earlier build when switching panels.
// Retain hashed assets while publishing the new index. Only clean dist offline.
export default defineConfig({plugins:[react(),tailwindcss(),compressedAssets()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},server:{host:'127.0.0.1',port:5180,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:8088',ws:true},'/healthz':'http://127.0.0.1:8088'}},build:{target:'es2022',emptyOutDir:false}});
