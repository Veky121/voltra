import fs from 'node:fs';
import crypto from 'node:crypto';
const dir='.local/citadel-native',read=name=>JSON.parse(fs.readFileSync(dir+'/'+name+'.json'));
const first=read('first-stop'),last=read('reload-resumed-stop'),watch=read('reload-watch-resumed');
const before=read('snapshot-before-reinstall'),after=read('snapshot-after-reinstall'),final=read('snapshot-reload-stopped');
const preboot=read('preboot-report'),live=read('live-reload'),comparison=read('retention-comparison');
const firstSources=read('installed-source-first/manifest'),sources=read('installed-source-retention/manifest');
const profile=read('source-profile-retention'),generation=fs.readFileSync(dir+'/reload-terminal-generation.log','utf8');
const rows=[];function check(name,value,evidence,detail){if(!value)throw Error(name);rows.push({name,status:'passed',evidence,detail});}
for(const tag of ['first','retention']){const events=read(tag+'-installer-die-events');check('actual '+tag+' installer DIE0',events.events.length===1&&events.events[0].Actor.Attributes.exitCode==='0',[tag+'-installer-die-events.json']);}
check('actual anonymous Linux public build',preboot.release.appid===489650&&preboot.release.StateFlags===4&&preboot.release.buildid===6394339&&preboot.release.platform==='linux',['preboot-report.json']);
check('actual ELF64 and dependency inspection',preboot.native_binaries.some(x=>x.path.endsWith('CitadelServer-Linux-Shipping')&&x.header.startsWith('7f454c460201'))&&preboot.native_dependencies.status===0&&!preboot.native_dependencies.contains_missing_library,['preboot-report.json','preboot-ldd.log']);
check('fresh managed SDK ledger matches public bootstrap',preboot.sdk.target_sha256===preboot.sdk.source_sha256&&preboot.sdk.target_sha256===preboot.sdk.ledger.sha256&&!preboot.sdk.target_is_symlink,['preboot-report.json']);
check('full-path and ancestor legal discovery retained',preboot.legal_discovery.files.length===2&&!preboot.legal_discovery.game_specific_agreement_file_found,['preboot-files.json'],{scope:'Candidate discovery only; not legal absence or acceptance'});
for(const[name,value]of Object.entries(sources)){
 const pattern=new RegExp('cat > \\.voltra/'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+" <<'([^']+)'\\n([\\s\\S]*?)\\n\\1\\n");
 const match=profile.egg.scripts.installation.script.replace(/\r\n/g,'\n').match(pattern);
 check('current installed source '+name,!!match&&crypto.createHash('sha256').update(match[2]+'\n').digest('hex')===value.sha256&&firstSources[name].sha256===value.sha256,['installed-source-retention/'+name]);
}
check('strict actual Reinstall retention',comparison.sha_bytes_mode_uid_gid_equal&&JSON.stringify(before.files)===JSON.stringify(after.files)&&JSON.stringify(before.links)===JSON.stringify(after.links),['snapshot-before-reinstall.json','snapshot-after-reinstall.json','retention-comparison.json'],{files:Object.keys(before.files).length,mtime_changes_separate:comparison.mtimes_changed});
check('complete before and after raw state archives',read('archives/before-reinstall').files===22&&read('archives/reload-stopped').files===24,['archives/before-reinstall.tar.gz','archives/reload-stopped.tar.gz']);
check('actual current-generation readiness and stable observation',generation.includes('Steam Server initialized and registered with UWorks')&&watch.stable_observed_ms>=30000&&watch.phase==='stopped',['reload-current-generation.log','reload-watch-resumed.json']);
check('actual native argv and cwd',live.processes.some(x=>x.argv.includes('/Citadel/Binaries/Linux/CitadelServer-Linux-Shipping Citadel')&&x.cwd==='/home/container/Citadel/Binaries/Linux'),['live-reload.json']);
check('actual allocated gameplay/query UDP listeners',live.listeners.some(x=>x.protocol==='udp'&&x.port===28000)&&live.listeners.some(x=>x.protocol==='udp'&&x.port===28001),['live-reload.json']);
check('actual Panel running state',live.resources.attributes.current_state==='running',['live-reload.json']);
check('two normal Stop raw130 preserved without OOM',first.state.ExitCode===130&&!first.state.OOMKilled&&last.state.ExitCode===130&&!last.state.OOMKilled,['first-stop.json','reload-resumed-stop.json']);
check('actual native engine shutdown',generation.includes('LogExit: Game engine shut down')&&generation.includes('RequestExit(bForce=false, ReturnCode=130)'),['reload-terminal-generation.log']);
check('selected ports reflected in retained native INI',/ConnectionPort\s*=\s*28000/.test(final.configs['Config/Game.ini'])&&/QueryPort\s*=\s*28001/.test(final.configs['Config/Game.ini']),['snapshot-reload-stopped.json']);
const report={recipe:'citadel/egg-citadel-forged-with-fire.json',review_requested:true,recommended_classification:'runtime_partial',rows,
 resource_budget:{memory_mib:6144,disk_mib:16384,ports:2,observed_reload_memory_peak_bytes:Number(live.memory_peak.trim())},
 limitations:['No world persistence claim: native WorldData.sav/ClientData.sav initially absent; first and reload stopped snapshots contain zero SaveGames/world files. No synthetic world, player data or settings were injected.','Both normal Stops returned actual130, not0, with no OOM and native engine shutdown markers; no exit normalization or claim of save completion.','No query packets, authenticated administrator action, client join/gameplay, public listing or player content was tested. Allocated UDP listeners and genuine original UWorks marker are observed facts only.','Original four variable defaults and canonical source remain unchanged; per-instance QPORT28001/AUTO_UPDATE0 and private generated ADMIN_PASSWD used.','Initial scanner read_bytes failure, cap-drop root permission boundary, and stale-state watcher error remain preserved. Corrected read-only scanner used streaming hashes/same game UID; resumed watcher observed the same single authorized reload, not a second Start.'],
 evidence_root:dir,cleanup_status:fs.existsSync(dir+'/cleanup.json')?'owned resources removed; see cleanup receipt':'owned resources retained pending authorized cleanup',native_gameplay_tested:false};
if(fs.existsSync(dir+'/cleanup.json')){report.cleanup=read('cleanup');if(!Object.values(report.cleanup.checks).every(Boolean))throw Error('Cleanup incomplete');}
fs.writeFileSync('artifacts/citadel-native-partial-acceptance.json',JSON.stringify(report,null,2)+'\n');
console.log({rows:rows.length,classification_requested:'runtime_partial',world_files:final.world_files.length,cleanup:report.cleanup?'removed':'held'});
