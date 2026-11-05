// Read-only prerequisite inspection. Never claims a lease or starts acquisition.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {api,verifyRuntime,profileFromRuntime,policy,containers,digest} from './campaign-native-20261029.mjs';
const recipe='dead_matter/egg-dead-matter.json';
const runtime=await verifyRuntime(),profile=profileFromRuntime(recipe,runtime);
const options=(await api('/api/client/game-library/templates/'+digest(recipe).slice(0,16))).attributes;
const integrations=(await api('/api/admin/integrations')).data.map(row=>row.attributes)
 .filter(row=>row.provider==='steam').map(row=>({id:row.id,enabled:row.enabled,egg_id:row.egg_id,configured_fields:row.configured_fields}));
const sockets=JSON.parse(execFileSync('powershell',['-NoProfile','-Command',"@{tcp=@(Get-NetTCPConnection -LocalPort 7002 -ErrorAction SilentlyContinue).Count;udp=@(Get-NetUDPEndpoint -LocalPort 7002 -ErrorAction SilentlyContinue).Count}|ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true}));
const dockerConflict=containers().some(c=>Object.values(c.HostConfig.PortBindings||{}).some(values=>(values||[]).some(binding=>+binding.HostPort===7002)));
const report={at:new Date().toISOString(),recipe,scope:'read-only Dead Matter prerequisites; no acquisition or lease',complete:false,
 runtime:{pid:runtime.pid,binary_sha256:runtime.binary_sha256,source_fingerprint:runtime.source_fingerprint},
 source:{app_id:2584780,platform:'windows',client_app_id:2184150,sdk_app_id:1007,proton:'GE-Proton11-9',controls:profile.egg.variables.length},
 private_credentials:{configured_steam_integrations:integrations,any_configured_account:integrations.some(row=>row.enabled&&row.configured_fields?.username&&row.configured_fields?.password),private_content_supported:options.private_content_supported,raw_credentials_read:false},
 transport:{snapshot_helper_refuses_private_credentials:profile.egg.scripts.installation.script.includes('Private Steam credentials are not enabled until native command parsing is verified'),anonymous_entitlement:'unverified; no Steam request was made in this assessment',account_login_attempted:false},
 resources:{default_memory_mib:profile.defaults.memory,default_disk_mib:profile.defaults.disk,required_ports:profile.required_ports,lease_requested:false,root_priority:'CryoFall first; do not monopolize campaign with an8GB DeadMatter lease'},
 query_port:{original_default:7002,editable:profile.egg.variables.find(v=>v.env_variable==='QUERY_PORT')?.user_editable,tcp_conflicts:sockets.tcp,udp_conflicts:sockets.udp,docker_binding_conflict:dockerConflict,campaign_policy_includes_port:(7002>=policy.port_min&&7002<=policy.port_max)||(policy.additional_reviewed_ports||[]).includes(7002)},
 blockers:['No configured Steam account exists in this isolated campaign. If the publisher requires private entitlement, actual user-supplied/configured credentials and a reviewed transport are required; none were fabricated.',
  'The served template does not advertise a reviewed private content policy for this Windows application. The embedded anonymous helper explicitly rejects private Steam credentials.',
  'Anonymous dedicated-server entitlement remains unverified. Missing private credentials do not prove anonymous installation is unavailable.',
  'Original read-only QUERY_PORT7002 needs a separately reviewed campaign reservation if it remains outside the allowed port set; no silent default rewrite was made.',
  'Native schema, Proton/SDK compatibility, publisher/client entitlement and actual gameplay cannot be accepted from this read-only assessment.'],
 next:'Keep DeadMatter prerequisite-only while CryoFall completes. Root may separately authorize a bounded anonymous entitlement/install attempt with an8GB/32GB lease and reviewed ports; stop at real entitlement refusal rather than invent credentials or downgrade private requests.'};
fs.writeFileSync('artifacts/game-parity-20261029/deadmatter-wave5-native-prerequisites.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({private_content_supported:options.private_content_supported,configured_account:report.private_credentials.any_configured_account,query_port_reserved_by_policy:report.query_port.campaign_policy_includes_port,lease_requested:false}));
