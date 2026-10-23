import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const base='internal/panel/game_library/scripts/';
const sources=[['STEAM_SOURCE','steam-template.py'],['RUST_SOURCE','rust-runtime.py'],['INSTALL_SOURCE','rust-install.py'],['KEEPER_SOURCE','core-keeper-runtime.py']];
const script=sources.map(([key,file])=>key+'='+JSON.stringify(fs.readFileSync(base+file,'utf8'))).join('\n')+'\n'+fs.readFileSync('tools/runtime/test-survival.py','utf8');
const docker=process.argv.includes('--docker-owner-test');
const result=spawnSync(docker?'docker':'wsl.exe',docker?['run','--rm','-i','--pull','never','--network','none','python:3.13-slim','python3','-B','-','SurvivalTests.test_metadata_install_preserves_volume_owner','SurvivalTests.test_directory_quarantine_preserves_game_owner_and_private_backup_access']:['-d','Ubuntu','--','python3','-'],{input:script,encoding:'utf8',maxBuffer:1024*1024});
console.log(result.stdout+result.stderr);process.exitCode=result.status??1;
