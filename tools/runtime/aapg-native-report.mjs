import fs from 'node:fs';
import crypto from 'node:crypto';
const dir='.local/aapg-native',read=name=>JSON.parse(fs.readFileSync(dir+'/'+name+'.json'));
const profile=read('source-profile-name-fix'),files=read('snapshot-third-stopped'),source=read('installed-source-third/manifest'),preboot=read('preboot-report');
const query=read('query-third'),failedQuery=read('query-second'),live=read('live-third'),watch=read('third-watch');
const rows=[];function check(name,passed,evidence,detail){if(!passed)throw Error(name);rows.push({name,status:'passed',evidence,detail});}
check('anonymous Linux public acquisition',preboot.release.appid===203300&&preboot.release.StateFlags===4&&preboot.release.platform==='linux'&&preboot.release.buildid===8671920,['preboot-report.json']);
for(const tag of ['first','retention','name-fix']){const receipt=read(tag+'-installer-die-events');check('actual '+tag+' installer DIE0',receipt.events.length===1&&receipt.events[0].Actor.Attributes.exitCode==='0',[tag+'-installer-die-events.json']);}
check('actual original Linux ELF and dependencies',preboot.binary.header.startsWith('7f454c460201')&&preboot.binary.path==='Binaries/Linux/AAPG'&&preboot.native_dependencies.status===0&&!preboot.native_dependencies.contains_missing_library,['preboot-report.json','preboot-ldd.log']);
check('full ancestor legal candidate discovery retained',preboot.legal_discovery.all_candidates.length===118&&preboot.legal_discovery.game_candidates.length===0,['preboot-files.json'],{scope:'Candidate discovery; no blanket legal absence or terms acceptance claim'});
for(const [name,value]of Object.entries(source)){
 const pattern=new RegExp('cat > \\.voltra/'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+" <<'([^']+)'\\n([\\s\\S]*?)\\n\\1\\n");
 const match=profile.egg.scripts.installation.script.replace(/\r\n/g,'\n').match(pattern);
 check('actual installed source '+name,!!match&&crypto.createHash('sha256').update(match[2]+'\n').digest('hex')===value.sha256,['installed-source-third/'+name]);
}
const retention=read('retention-report'),namefix=read('name-fix-retention-report');
check('actual AAGame preservation correction and strict first Reinstall',retention.strict_equal&&retention.files===45&&retention.mtime_changes_separate.length===0,['retention-report.json','snapshot-first-stopped-full.json','snapshot-after-retention.json']);
check('strict second Reinstall before name fix boot',namefix.strict_equal&&namefix.files===49&&namefix.mtime_changes_separate.length===0,['name-fix-retention-report.json','snapshot-second-stopped.json','snapshot-after-name-fix.json']);
check('prior native name truncation retained',failedQuery.response&&failedQuery.fields.name==='Voltra'&&!failedQuery.name_matches,['query-second.json']);
check('corrected full native name and actual map query',query.response&&query.name_matches&&query.fields.name==='Voltra isolated AAPG'&&query.fields.map==='BDX_Shadowstep_EX'&&query.request_packets===1,['query-third.json']);
const terminal=fs.readFileSync(dir+'/third-terminal-generation.log','utf8');
check('third generation readiness and stable observation',terminal.includes('Finished loading level')&&watch.stable_observed_ms>=30000&&watch.phase==='stopped',['third-watch.json','third-terminal-generation.log']);
check('actual native argv and working directory',live.processes.some(p=>p.argv.includes('/Binaries/Linux/AAPG -port=28003 -SAP=28005 -SQP=28004 -servername="Voltra isolated AAPG"')&&p.cwd==='/home/container/Binaries/Linux'),['live-third.json']);
check('actual allocated gameplay and query UDP sockets',live.listeners.some(p=>p.protocol==='udp'&&p.port===28003)&&live.listeners.some(p=>p.protocol==='udp'&&p.port===28004),['live-third.json']);
check('Panel observed running',live.resources.attributes.current_state==='running',['live-third.json']);
for(const [tag,receipt]of [['first','first-stop'],['second','second-stop'],['third','third-stop']]){const actual=read(receipt);check('normal '+tag+' Stop raw0 without OOM',actual.state.ExitCode===0&&!actual.state.OOMKilled,[receipt+'.json']);}
check('actual native shutdown markers',terminal.includes('Exit: Game engine shut down')&&terminal.includes('Exit: Exiting.'),['third-terminal-generation.log']);
check('actual generated config and Cloud state retained',!!files.files['AAGame/Config/PCServerLinux-AAGame.ini']&&!!files.files['AAGame/Cloud/CloudStorage.ini']&&Object.keys(files.files).length===53,['snapshot-third-stopped.json']);
check('full raw state archives retained',read('archives/first-stopped-full').files===45&&read('archives/second-stopped').files===49&&read('archives/third-stopped').files===53,['archives/first-stopped-full.tar.gz','archives/second-stopped.tar.gz','archives/third-stopped.tar.gz']);
const report={recipe:'americas_army/proving_grounds/egg-america-s-army--proving-grounds.json',review_requested:true,classification:'root review pending',rows,evidence_root:dir,
 source_deltas:['Initial helper protected nonexistent legacy AAPG paths; root added only actual AAGame/Config, Cloud and Logs while retaining legacy paths. Corrected installed helper passed strict45-file Reinstall.','Initial full-name A2S probe exposed truncation to Voltra. Root restored original engine-quoted server-name operand. Corrected helper retained49 files through Reinstall and native A2S now returns exact full test name.'],
 resource_budget:{memory_mib:4096,disk_mib:16384,ports:3,observed_third_memory_peak_bytes:Number(live.memory_peak.trim())},
 limitations:['No authenticated client/player join, online backend authentication/ranking, public listing or gameplay proof. Client SteamAPI initialization and nonfatal PhysX/PunkBuster warnings remain in first-generation logs.','Original AUTH_PORT28005 was delivered in native argv but no corresponding listener was observed. Native TeamSpeak UDP8765 was observed inside its container and remains unmapped; no forwarding or speculative role substitution was performed.','Literal spaces in the original server name are now proven. Embedded quotes/backslashes and universal parser encoding remain unproven; no new input restrictions were silently imposed.','This is a round-based dedicated server: native generated configuration/Cloud/log state, strict Reinstall and clean process reload/Stop were tested. No fabricated world or player progress was injected.','Initial observer hit a transient absent container during asynchronous start. Its failed receipt is retained; resumed observation tracked the same single first Start. No automatic native retry occurred.','Optional source-driver node-container cat recovery returned127; actual Docker installer DIE0 and helper bytes independently establish installation.'],
 native_gameplay_tested:false,terms_accepted:false,cleanup_status:fs.existsSync(dir+'/cleanup.json')?'owned cleanup completed':'owned server551 stopped; awaiting root cleanup authorization'};
if(fs.existsSync(dir+'/cleanup.json'))report.cleanup=read('cleanup');
fs.writeFileSync('artifacts/aapg-native-acceptance.json',JSON.stringify(report,null,2)+'\n');
console.log({rows:rows.length,name_matches:true,normal_stops:3,cleanup:report.cleanup_status});
