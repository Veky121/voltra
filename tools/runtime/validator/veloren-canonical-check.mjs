import { resolve } from 'node:path';
import { campaign as h, receipt } from './campaign-session.mjs';
import { hash } from './runner.mjs';
const build='32aefb21d6016f5f17a8e6437a319ec67d8cde92500fae1b3a6968ba26b0e034';
const recipe='veloren/egg-veloren.json';
const reportPath=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/veloren-wave8-native.json');
const reportHash='3601c758f7f5a7df771445adb7e409ae832bd50f4b9fa1de855fe9e6cebc2fe9';
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
export function verifyVelorenLegacy(ctx,report,pin,frozen){
 const p=h.profileFromRuntime(recipe,receipt),c=report.checks,retained=c?.strict_preboot_preservation;
 if(ctx.game.id!=='veloren-canonical'||ctx.build!==build||receipt?.binary_sha256!==build||resolve(pin.path)!==reportPath||pin.sha256!==reportHash
  ||report.recipe!==recipe||report.full_parity!==false||report.status!=='bounded_native_acceptance_complete_with_material_gaps'
  ||c?.canonical_install?.actual_docker_wait!==0||c.canonical_install.api?.success!==true||retained?.actual_docker_wait!==0||retained.api?.success!==true
  ||retained.canonical_installer_body_sha256!==hash(p.egg.scripts.installation.script)||retained.preexisting_entries_exact!==13333||retained.preexisting_files_exact!==11385||retained.preexisting_bytes_exact!==533673117
  ||retained.changed_or_missing!==0||!Array.isArray(retained.preserved)||report.title_identity?.git_hash!=='c5024ebf')throw Error('Exact bounded historical Veloren install/retention receipt required');
 if(hash(JSON.stringify(sorted(p)))!==frozen?.profileSHA256||hash(p.egg.scripts.installation.script)!==frozen?.scriptSHA256)throw Error('Reviewed unchanged Veloren frozen profile differs');
 const attested=c.canonical_install.seven_resources_attested;
 if(!Array.isArray(attested)||attested.length!==7)throw Error('Historical helper attestation absent');
 const embedded={};for(const m of p.egg.scripts.installation.script.matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g))embedded[m[1]]=hash(m[3]+'\n');
 for(const row of attested)if(embedded[row.file]!==row.sha256)throw Error('Historical helper bytes differ from candidate16: '+row.file);
 if(!Array.isArray(c.graceful_stops)||c.graceful_stops.length<4||c.graceful_stops.some(s=>s.native?.running!==false||s.native.exit_code!==0||s.native.oom_killed!==false||s.power?.current_state!=='offline'))throw Error('Historical native Stop0 shape changed');
 for(const key of ['baseline','operator-edit','post-preservation']){const q=c.queries?.[key];if(q?.git_hash!=='c5024ebf'||q.players!==0||q.player_cap!==32)throw Error('Historical native UDP query shape changed');}
}
export async function verifyVelorenExposure(ctx,body){
 for(const key of ['server_name','max_players']){const fields=body.fields.filter(f=>f.key===key);if(fields.length!==1||fields[0].readonly!==true)throw Error('Veloren startup authority must remain readonly');}
 const optional=body.fields.filter(f=>f.key==='day_length');
 if(optional.length>1||optional.some(f=>f.type!=='number'||f.readonly))throw Error('Existing-only Veloren scalar exposure differs');
 if(body.fields.some(f=>!['server_name','max_players','auth_server_address','gameserver_protocols','query_address','metrics_address','day_length'].includes(f.key)))throw Error('Opaque Veloren RON value exposed');
 await ctx.artifact('veloren-canonical-exposure.json',{optionalDayLengthPresent:optional.length===1,optionalScalarInserted:false,priorNativeEvidence:'Historical source-matching receipt only; no current native acceptance inferred',scope:'Canonical defaults/install/bootstrap and served typed exposure only; native600 test input belongs to separate fresh adapter'});
}
