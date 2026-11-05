// Compatibility entrypoint. Canonical source owns future profile generation.
import {spawnSync}from 'node:child_process';
const r=spawnSync(process.execPath,['tools/runtime/stage-factorio-native-authority.mjs',...process.argv.slice(2)],{stdio:'inherit',windowsHide:true});if(r.error)throw r.error;process.exitCode=r.status??1;
