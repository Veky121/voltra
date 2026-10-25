import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';
const dir='.local/jc3-native',read=n=>JSON.parse(fs.readFileSync(dir+'/'+n+'.json','utf8').replace(/^\uFEFF/,'')),rows=[];
const check=(name,value,evidence)=>{assert(value,name);rows.push({name,result:'pass',evidence});};
const first=read('first-boot'),compat=read('compatible-boot'),isolated=read('isolated-ready'),perf=read('perf'),packageFailure=read('package-first'),saved=read('snapshot-package-reinstall'),retained=read('verify-package-reinstall'),reload=read('package-reload-ready'),last=read('package-reload-stop'),final=read('snapshot-package-reload-final'),live=read('live-package-reload'),cleanup=read('cleanup'),metadata=read('metadata-review');
check('public Linux metadata fits4GiB budget',metadata.within_approved_disk&&metadata.metadata_installed_bytes===355876527,'metadata-review.json, pinned ValvePython VDF reader');
check('warm public updated SteamCMD only',read('steamcmd-cache-stage').shared_bootstrap_cache&&!read('steamcmd-cache-stage').game_download_cache_used,'steamcmd-cache-stage.json');
check('anonymous app619960 installed current public Linux build',saved.release.appid===619960&&saved.release.StateFlags===4&&saved.release.buildid===24903375&&saved.release.platform==='linux','snapshot-package-reinstall.json');
check('first GLIBC failure preserved',first.state.ExitCode===1&&!first.state.OOMKilled&&first.logs.includes('GLIBC_2.38'),'first-boot.json');
check('second private Python OpenSSL failure preserved',compat.state.ExitCode===1&&compat.logs.includes('OPENSSL_3.3.0'),'compatible-boot.json');
check('actual dependency resolution read-only and nonroot',read('runtime-compatibility-isolated').exit===0&&read('runtime-compatibility-isolated').user==='988:988','runtime-compatibility-isolated.json');
check('corrected native server readiness',isolated.logs.includes('Server successfully started up, awaiting connects...'),'isolated-ready.json');
check('publisher-shipped baseline packages loaded',isolated.logs.includes("Package 'chat' loaded.")&&isolated.logs.includes("Package 'spawn-menu' loaded.")&&isolated.logs.includes("Package 'freeroam' loaded."),'isolated-ready.json');
check('native Steam connected',isolated.logs.includes('Connected to Steam successfully'),'isolated-ready.json');
check('real dashboard perf response',perf.logs.includes('tickrate=60 frame=')&&perf.logs.includes('network                last='),'perf.json');
check('private Python library removed from actual native environment',live.processes.some(p=>p.executable==='Server'&&!p.LD_LIBRARY_PATH.includes('.voltra/python')),'live-package-reload.json');
check('unused image Xvfb disabled',live.processes.some(p=>p.executable==='Server'&&p.XVFB==='0')&&!live.processes.some(p=>p.executable==='Xvfb'),'live-package-reload.json');
check('initial package print-global fixture failure retained',packageFailure.state.ExitCode===139&&!packageFailure.state.OOMKilled&&packageFailure.logs.includes('ReferenceError: print is not defined'),'package-first.json; exact initial source retained');
check('corrected native package wrote durable generation2',saved.counter.generation===2,'snapshot-package-reinstall.json');
check('strict5-file bytes/mode/UID/GID preservation across APIReinstall',Object.keys(saved.files).length===5&&JSON.stringify(saved.files)===JSON.stringify(retained.files),'snapshot-package-reinstall.json + verify-package-reinstall.json');
check('native reload incremented retained generation2to3',reload.logs.includes('VOLTRA_NATIVE_SAVE generation=3')&&final.counter.generation===3,'package-reload-ready.json + snapshot-package-reload-final.json');
check('changed MAX_PLAYER actually applied',live.config.maxPlayers===4&&reload.logs.includes('max_connections=4'),'startup-controls.json + package-reload-ready.json');
check('changed TICK_RATE actually applied',live.config.maxTickRate===30&&reload.logs.includes('tickrate=30 frame='),'startup-controls.json + package-reload-ready.json');
check('original AUTO_UPDATE1 ran normal Steam update before native reload',reload.logs.includes("Success! App '619960' fully installed.")&&reload.logs.indexOf("Success! App '619960'")<reload.logs.indexOf('VOLTRA_NATIVE_SAVE generation=3'),'package-reload-ready.json');
check('actual allocated game/query/HTTP listeners',live.listeners.some(p=>p.port===28004&&p.protocol==='udp6')&&live.listeners.some(p=>p.port===28005&&p.protocol==='udp')&&live.listeners.some(p=>p.port===28007&&p.protocol==='tcp'),'live-package-reload.json');
check('native HTTP responded rather than inferred ready',live.http.status===404&&live.http.body==='not found','live-package-reload.json');
check('raw original SIGINT Stop130 retained without OOM',last.state.ExitCode===130&&!last.state.Running&&!last.state.OOMKilled,'package-reload-stop.json; no clean-zero/flush claim');
const sourcePhase='package-reinstall',manifest=read('installed-source-'+sourcePhase+'/manifest'),profile=read('source-profile-'+sourcePhase);let helpers=0;
for(const[name,value]of Object.entries(manifest)){
 const bytes=fs.readFileSync(dir+'/installed-source-'+sourcePhase+'/'+name),script=profile.egg.scripts.installation.script,marker=`cat > .voltra/${name} <<'VOLTRA_SOURCE'\n`,start=script.indexOf(marker)+marker.length,end=script.indexOf('VOLTRA_SOURCE\n',start);
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),value.sha256);assert(start>=marker.length&&end>start);assert.equal(bytes.toString(),script.slice(start,end));helpers++;
}
check('actual9 installed helper snapshots match exact approved profile',helpers===9,'installed-source-package-reinstall/manifest.json + source-profile-package-reinstall.json');
check('exact owned cleanup before queue release',Object.values(cleanup.checks).every(Boolean)&&read('cleanup-partial-exit').raw_exit===130,'cleanup.json + cleanup-partial-exit.json');
const report={recipe:'just_cause/just_cause_3/egg-j-c3-m-p.json',recommended_verification:'runtime_partial',root_review_required:true,build:saved.release,rows,source_fix:{helper_sha256:'9af3ae72ddd1b1fd810bc842566c2269ac5b089d0fd5ed3013d68ade9103b82f',runtime_image:read('runtime-compatibility-isolated').image,scope:'Root merged JC3-only Debian13 selection, native LD_LIBRARY_PATH isolation and hiddenXVFB0; Onset/LAC behavior unchanged.17offline family regressions and canonical runner passed.'},limitations:[
 'No first-pass success: first GLIBC failure, second Python/OpenSSL failure and initial test-package print-global defect/raw139 are retained.',
 'Original normal API SIGINT Stop exits130 without OOM or native cleanup marker. No clean flush/zero-exit guarantee. No supported graceful quit command found in primary docs; no guessed command or exit normalization introduced.',
 'Steam A2S query timed out in private announce=false configuration despite native query UDP socket. Query/browser behavior remains unverified; HTTP404 proves only the HTTP service responds.',
 'Current primary publisher configuration docs say steamPort is retained in default files but Steam initialization uses game port/queryPort. Fourth allocation conservatively retained; no fake Steam28006 listener claimed.',
 'Approved test-only package uses real native CommonJS VM and fsynced counter. Its directory replaces bundled-package fallback for persistence phases. No player/client assets or gameplay tested; this is package persistence, not a game-world save or shutdown-hook proof.',
 'No password-authenticated player join, DLC enforcement or public listing claim. Native publisher emits SteamNetworkingUtils-before-init warning.',
 'A host HTTP probe command had a local Node CommonJS/top-level-await formatting error before making a request. No host connectivity claim; native container HTTP/socket evidence is separate.'
],primary_sources:['https://just-cause.mp/docs/hosting/server-configuration','https://just-cause.mp/docs/developing/server-packages'],budget:{memory_mib:1024,disk_mib:4096,ports:4,actual_volume_bytes:final.actual_volume_bytes,final_runtime_peak_bytes:Number(live.memory_peak.trim())},cleanup:cleanup.checks,evidence_root:dir};
fs.writeFileSync('artifacts/jc3-native-partial-acceptance.json',JSON.stringify(report,null,2)+'\n');fs.writeFileSync('artifacts/jc3-native-cleanup.json',JSON.stringify(cleanup,null,2)+'\n');console.log({strict_rows:rows.length,recommended_verification:report.recommended_verification,cleanup:cleanup.checks});
