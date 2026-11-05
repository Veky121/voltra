import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const ddnet=JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/ddnet-latest-wave4-profile.json'));
const pair=JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/source-pair-wave4-profile.json'));
const rules=[
 ...Object.keys(ddnet).map(recipe=>[recipe,ddnet[recipe],'ddnet-install.py','ddnet_install.py']),
 ...Object.keys(pair).map(recipe=>[recipe,pair[recipe],'source-pair-preflight.py','source_pair_preflight.py']),
];
const checks=rules.map(([recipe,profile,file,target])=>{
 const source=fs.readFileSync('internal/panel/game_library/scripts/'+file,'utf8').replaceAll('\r\n','\n');
 const script=profile.egg.scripts.installation.script.replaceAll('\r\n','\n');
 const match=[...script.matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].find(m=>m[1]==='.voltra/'+target);
 assert(match,'Missing helper '+recipe);
 assert.equal(match[3]+'\n',source,'Stale canonical helper '+recipe);
 return {recipe,source:'internal/panel/game_library/scripts/'+file,sha256:hash(source),controls:profile.egg.variables.length};
});
const metadata=JSON.parse(fs.readFileSync('.local/game-parity-20261029/ddnet-root-native/resolver-source-ready.json'));
const report={
 status:'canonical-source-fixed-and-offline-verified; root-override-merge-and-native-handoff-pending',complete:false,
 source_ready_games:checks.map(c=>c.recipe),canonical_helpers:checks,
 implemented:{
  ddnet_latest:'Select the highest semantic stable Linux x86-64 version with exactly one official checksum row, using only the publisher SHA-256 manifest and trusted download links. Disclose skipped newer announcements and actual selected version; no unverified archive is selected.',
  explicit_versions:'Exact requested archive remains required; absent/ambiguous hashes refuse. Reviewed20.1.1 identity and cache metadata retained. DDRace nightly remains independently publisher-checked.',
  source_pair:'Stable canonical preflight now rejects invalid controls/paths before acquisition and reserves explicit client/TV roles before automatic selection. Existing Steam preservation, launch and console/readiness helpers remain unchanged.'
 },
 live_metadata_only:metadata,
 checks:{
  command:'docker --context desktop-linux run --rm --network none --read-only --memory 256m --memory-swap 256m --cpus 1 --tmpfs /tmp:rw,size=64m -v C:/Users/Veky/.t3/projects/pteroclone/ptero-go:/work:ro -w /work -e PYTHONDONTWRITEBYTECODE=1 python:3.12-slim python -B tools/runtime/ddnet-source-ready-tests.py',
  canonical_latest_regressions:11,legacy_ddnet_linux_regressions:8,canonical_source_pair_regressions:9,total:28,
  network:'none',source_mount:'read-only',memory_mib:256,extra_swap_mib:0,cpu_count:1,
  merge_dry_run:'passed exact four-profile set',helper_provenance:'four exact canonical-to-staged byte comparisons passed',
  windows_limit:'Metadata regressions passed on Windows. Legacy POSIX chown/mode cases cannot pass Windows; unmodified legacy suite passed on actual Linux container. No application workaround or skipped Linux invariant introduced.'
 },
 original_controls_preserved:{ddnet:13,ddrace:10,black_mesa:15,contagion:22},
 changes:['internal/panel/game_library/scripts/ddnet-install.py','internal/panel/game_library/scripts/source-pair-preflight.py','tools/runtime/ddnet-latest-parity-wave4-test.py','tools/runtime/ddnet-latest-parity-wave4-stage.mjs','tools/runtime/ddnet-source-ready-tests.py','tools/runtime/source-pair-parity-wave4-test.py','tools/runtime/source-pair-parity-wave4-stage.mjs'],
 root_fragments:['artifacts/game-parity-20261029/ddnet-latest-wave4-profile.json','artifacts/game-parity-20261029/source-pair-wave4-profile.json'],
 preserved_evidence:['artifacts/game-parity-20261029/ddnet-root-native.json','.local/game-parity-20261029/ddnet-root-native/installer.log','.local/game-parity-20261029/ddnet-root-native/first-default-failure-observation.json'],
 remaining:['Root merge and current frozen-source build/activation handoff before new native acquisition or starts.', 'Native latest-selected20.2 acquisition/start/stop/settings/reinstall still needs acceptance; HTTPHEAD is not native verification.', 'BlackMesa and Contagion native lifecycle, shared forms/browser console and typed Source command settings remain pending.', 'Wings installer status propagation repair is independently owned by root.'],
 boundaries:{global_overrides_edited:false,go_edited:false,frontend_edited:false,other_shared_helper_edited:false,native_acquisition:false,native_start:false,panel_restart:false,wings_restart:false,commits:false},
 sources:['https://ddnet.org/downloads/','https://ddnet.org/downloads/sha256sums.txt']
};
fs.writeFileSync('artifacts/game-parity-20261029/ddnet-source-ready.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ready:report.source_ready_games,offline_passed:28,exact_helpers:4,native_retested:false}));
