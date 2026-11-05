import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:[new URL('../src/hooks/readPolicy.ts',import.meta.url).pathname.replace(/^\/(.:)/,'$1')],bundle:true,write:false,format:'esm',platform:'node'});
const {readPolicy,matchesReadChange}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const base='/api/client/servers/one';
test('forms, secrets, bytes and machine APIs remain on demand',()=>{
 for(const path of ['configuration','startup','game-settings','quick-setup','java','files/contents?file=x','files/preview?file=x','files/download-stream?file=x','databases?include=password','backups/b/download','websocket','steam/private?token=x'])assert.equal(readPolicy(`${base}/${path}`),null,path);
 for(const path of ['/api/auth/session','/api/remote/servers','/api/wings/1/download/file','/api/admin/settings','/api/admin/integrations','/api/admin/nodes/1/configuration','/api/admin/users/1','/api/admin/api-keys','/api/admin/node-installer','/api/admin/proxy-gateways/1/config/frps'])assert.equal(readPolicy(path),null,path);
});
test('watched list families reconcile conservatively and cross-user permission changes refresh them',()=>{
 for(const suffix of ['backups?page=2','schedules?include=tasks','databases','network/allocations','users','steam/private/jobs','activity']){
  assert.equal(readPolicy(`${base}/${suffix}`).reconcileMs,60000);
  assert.equal(matchesReadChange(`${base}/${suffix}`,['access']),true);
 }
 assert.equal(readPolicy(`${base}/files/list?directory=%2Fworld`).reconcileMs,15000);
 assert.equal(matchesReadChange(`${base}/schedules?include=tasks`,['backups']),false);
 assert.equal(matchesReadChange('/api/client?summary=overview',['steam']),false);
 assert.equal(matchesReadChange('/api/client?summary=overview',['servers']),true);
 assert.equal(matchesReadChange('/api/admin/new-list',['all']),true);
});
