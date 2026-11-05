import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {fileURLToPath,URL} from 'node:url';
import {compressedAssets} from './build/compressedAssets';
// Open tabs may request lazy chunks from an earlier build when switching panels.
// Retain hashed assets while publishing the new index. Only clean dist offline.
const devAPI=process.env.VOLTRA_DEV_API_URL??'http://127.0.0.1:18089';
const devTarget=new URL(devAPI);
if(devTarget.protocol!=='http:'||devTarget.hostname!=='127.0.0.1'||devTarget.username||devTarget.password)throw new Error('Vite development API must be a loopback HTTP endpoint.');
export default defineConfig({plugins:[react(),tailwindcss(),compressedAssets()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},server:{host:'127.0.0.1',port:5181,strictPort:true,proxy:{'/api':{target:devAPI,ws:true},'/healthz':devAPI,'/locales':devAPI}},build:{target:'es2022',emptyOutDir:false}});
