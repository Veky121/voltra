import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],build:{outDir:'../.local/file-manager/web',rollupOptions:{input:{app:'index.html',transfers:'tests/transfers-browser.html'}}}});
