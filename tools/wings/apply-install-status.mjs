// Usage: node tools/wings/apply-install-status.mjs <clean Wings v1.13.3 checkout>
// Only the pinned upstream source is accepted. No production service is changed.
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
const root=path.resolve(process.argv[2]||'');
const sha=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(sha!=='6987d5e6f0612133e031255a99655e822d30579a')throw Error('Expected Wings v1.13.3 pinned source');
const file=path.join(root,'server/install.go');let source=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
const begin=source.indexOf('\tselect {\n\tcase err := <-eChan:',source.indexOf('ip.client.ContainerWait(ctx, r.ID'));
const end=source.indexOf('\n\treturn r.ID, nil',begin);
if(begin<0||end<0||!source.slice(begin,end).includes('case <-sChan:'))throw Error('Expected original installer wait block');
source=source.slice(0,begin)+'\tif err := waitForInstallResult(ctx, sChan, eChan); err != nil {\n\t\treturn "", err\n\t}\n\tip.Server.Events().Publish(DaemonMessageEvent, "Installation process completed.")\n'+source.slice(end);
fs.writeFileSync(file,source);
for(const name of ['install_wait.go','install_wait_test.go'])fs.copyFileSync('tools/wings/'+name+'.txt',path.join(root,'server',name));
console.log('Patched installer result handling in pinned Wings source.');
