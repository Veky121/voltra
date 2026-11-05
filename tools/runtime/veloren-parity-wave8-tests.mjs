// Source fixtures only, executed on this Windows machine. No SSH, Docker,
// publisher download, game process or source mutation.
import fs from 'node:fs';
import {runVelorenSourceFixtures} from './test-veloren.mjs';
const dir='.local/game-parity-20261029/veloren-root-native';fs.mkdirSync(dir,{recursive:true});
const result=runVelorenSourceFixtures();
const log=(result.stdout||'')+(result.stderr||'');fs.writeFileSync(dir+'/source-tests.log',log);process.stdout.write(log);
if(result.error)throw Error('Local source fixtures could not run: '+result.error.message);
fs.writeFileSync('artifacts/game-parity-20261029/veloren-wave8-source-tests.json',JSON.stringify({at:new Date().toISOString(),runner:'tools/runtime/veloren-parity-wave8-tests.mjs',boundary:'Windows local Python, mocked acquisition/native subprocess; not Linux UID/GID or native acceptance',test_count:Number(/Ran (\d+) tests?/.exec(log)?.[1]||0),exit_code:result.status,no_ssh:true,no_docker:true,no_native_game:true,no_source_mutation:true,log:dir+'/source-tests.log'},null,2)+'\n');
process.exitCode=result.status??1;
