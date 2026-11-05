import fs from 'node:fs';
import crypto from 'node:crypto';
const dir='artifacts/game-parity-20261029/moria-owner';
const recipe='return_to_moria/egg-the-lord-of-the-rings--return-to-moria.json';
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const staged=JSON.parse(fs.readFileSync(dir+'/profile.json'));
if(Object.keys(staged).length!==1||!staged[recipe])throw Error('Nonexclusive fragment');
const original=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===recipe).egg;
for(const variable of original.variables){
 const retained=staged[recipe].egg.variables.find(v=>v.env_variable===variable.env_variable);
 for(const key of ['default_value','rules','user_viewable','user_editable'])if(retained?.[key]!==variable[key])throw Error('Original control changed: '+variable.env_variable+'/'+key);
}
const hashes=JSON.parse(fs.readFileSync(dir+'/embedded-hashes.json'));
for(const [file,expected]of Object.entries(hashes))if(sha('internal/panel/game_library/scripts/'+file)!==expected)throw Error('Stale embedded source '+file);
const checklist=fs.readFileSync('artifacts/game-parity-20261029/GAME-AGENT-CHECKLIST.md','utf8');
const ids=[...checklist.matchAll(/\*\*([A-Z]+-\d+)\*\*/g)].map(m=>m[1]);
const files=['internal/panel/game_library/scripts/moria-native.py','tools/runtime/test-moria-native.py','tools/runtime/stage-moria-native.mjs','tools/runtime/report-moria-native.mjs',dir+'/profile.json',dir+'/embedded-hashes.json'];
const report={
 recipe,owner:'moria-owner',outcome:'partial',created_at:new Date().toISOString(),
 historical_receipt:'artifacts/fantasy-survival-servers-source-acceptance.json',
 historical_scope:'Preserved 16 offline fixtures and preservation/redaction claims, not rerun and not native acceptance.',
 changes:'Moria-only wrapper validates settings, INI ambiguity, licence and typed prerequisites before Steam updates; seeds missing settings once and retains native operator authority except allocation-owned ListenPort; native-file password added to both redaction paths. Shared stop/save transport and readiness quarantine unchanged.',
 source_tests:{command:'python tools/runtime/test-moria-native.py',passed:5,failed:0,scope:'Windows offline fixtures; os.fchown mocked because unavailable on Windows; Linux ownership not newly verified'},
 stage_checks:{exclusive_recipe:true,current_embeds:Object.keys(hashes).length,original_defaults_rules_permissions:true},
 files:files.map(path=>({path,sha256:sha(path)})),
 manifest:{
  retrieved:'2026-10-30',sources:['https://www.returntomoria.com/news-updates/dedicated-server','https://northbeachgames.freshdesk.com/support/solutions/articles/154000217137-getting-started-'],
  distribution:'Publisher guide offers free dedicated SteamCMD distribution without a Steam account. Existing recipe AppID3349480 Windows executable retained; Wine/vcrun2022 compatibility is recipe behavior, not publisher-supported Linux proof.',
  licence:'Free server availability is not Microsoft runtime licence consent. ACCEPT_WINDOWS_RUNTIME_LICENSES remains false by default. No credentials requested or supplied; no payload acquired.',
  resources:'Existing staged 4096MiB RAM/8192MiB disk retained. Reviewed publisher pages give no RAM/disk/CPU recommendation. These defaults are not newly measured. No reduction to fit the campaign.',
  ports:'Existing one-port footprint retained. Publisher guide names default 7777; transport/auxiliary listeners not established from this page or native evidence. No extra ports exposed.',
  files:['MoriaServerConfig.ini','MoriaServerPermissions.txt','MoriaServerRules.txt','Moria/Saved/SaveGamesDedicated','Moria/Saved/Config/Status.json','Moria/Saved/Logs/Moria.log','Moria/Content/Paks/~mods','Moria/Plugins'],
  precedence:'Existing native keys win over stale creation environment; missing original keys seeded; allocation owns Host.ListenPort. Unknown keys, world selection, passwords and operator Console.Enabled retained. Edit native settings while stopped.',
  operations:'Publisher documents exit as save-and-stop and SIGINT as save-before-exit. Existing SIGINT transport retained, Wine delivery/save/exit remains native-unverified. Publisher identifies Status.json for headless hosting status; exact schema and log readiness not observed, so no guessed online marker added.'
 },
 checks:ids.map(id=>({id,status:id==='DELIVERY-3'?'pass':'blocked',evidence:id==='DELIVERY-3'?'tools/runtime/test-moria-native.py':null,limitation:id==='DELIVERY-3'?'Focused source tests only.':id.startsWith('FACT-')?'Publisher facts reviewed as described in manifest; exact artifact, resources, transport or native runtime facts remain incomplete.':'Requires relevant integrated served build/native fixture. Source-only and historical evidence are retained separately.'})),
 blockers:[
  'Activation was rejected and is not retried. PID45220 remains the observed authoritative process; staged wrapper is unserved. No alternative activation path used.',
  'Pinned runtime image ghcr.io/ptero-eggs/yolks@sha256:eedeb0ff1684592ee0f28119d7111f7ba14488dfa9537c99689dfe7a33ba2553 is not cached: docker image inspect returned No such image. Cached-images-only policy prevents native bootstrap.',
  'No explicit Microsoft runtime licence acknowledgement supplied. Default false preserved.',
  'No native lease or installer slot requested because prerequisites already fail. Campaign 20GiB RAM/128GiB disk, host reserves and single installer policy remain unchanged.',
  'Shared Game settings dispatch/parser integration is integration-owner scope. Native file authority is fixed in the staged wrapper, but typed UI/API eligibility and native readback remain unverified.',
  'Installer shell refuses missing runtime licence acknowledgement before apt bootstrap. Full native configuration preflight runs after Python bootstrap but before game Steam acquisition/update; no claim of complete side-effect-free installer preflight.'
 ],
 failures:[{failure:'First Windows fixture failed because shared private_bytes calls Linux-only os.fchown',resolution:'Windows fixture explicitly mocks only fchown; production helper unchanged; five tests now pass.'},{failure:'Publisher SteamCMD knowledge-base URL inaccessible via web tool',resolution:'Publisher main guide explicitly confirms free accountless SteamCMD availability; exact depot acquisition not attempted.'}],
 cleanup:{native_leases:0,installer_slots:0,containers_created:0,game_downloads:0,schedules:0,temporary_users:0,service_restarts:0,activation_attempts:0,home_server_operations:0,running_owned_operations:0,temporary_fixture_directories:'Python TemporaryDirectory fixtures removed',retained:'Only owned source, staged profile and reports; no native fixture exists'},
 boundaries:'No browser, install, boot, query, native settings readback, world-save/reload, reinstall, permissions, file/schedule smoke, player or WAN acceptance. No canonical/shared edits, commits or publication.'
};
fs.writeFileSync(dir+'/report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:dir+'/report.json',sha256:sha(dir+'/report.json'),checks:ids.length,stage_checks:report.stage_checks}));
