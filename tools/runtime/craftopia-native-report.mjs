import fs from 'node:fs';
const d='.local/craftopia-native',r=n=>JSON.parse(fs.readFileSync(d+'/'+n));
const report={
 at:new Date().toISOString(),recipe:'craftopia/egg-craftopia.json',owner:'unreal_survival',status:'native_evidence_complete_pending_root_live_review_and_cleanup',
 scope:{server:509,uuid:r('private.json').uuid,app:1670340,build:24921505,platform:'linux',branch:'public',anonymous:true,memory_tested_mib:[4096,8192],source_default_memory_mib:4096,disk_mib:32768,ports:[28002],production_services_changed:false},
 original_controls:['SRCDS_APPID','AUTO_UPDATE','WORLD_NAME'],
 actual_source:{archive:d+'/canonical-source-log-relay',manifest:r('canonical-source-log-relay/manifest.json'),installed_archives:[d+'/installed-source-final-retention',d+'/installed-source-final-stopped']},
 evidence:{metadata:d+'/metadata-review.json',initial_payload:d+'/preboot-payload.json',first_native_failure:d+'/first-stop-failed-save.json',publisher_diagnosis:d+'/first-failure-inputs/manifest.json',publisher_savepath_source:d+'/research/Oc_OcSaveManager.txt',publisher_world_lookup_source:d+'/research/Oc_Maps_OcWorldManager.txt',source_path_fix_root_review:'artifacts/craftopia-savepath-source-root-review.json',relay_source_review:'artifacts/native-log-relay-source-acceptance.json',strict_before:d+'/before-final-reinstall.json',strict_after:d+'/after-final-reinstall.json',final_snapshot:d+'/final-stopped-snapshot.json',actual_before_bytes:d+'/native-state-before-final-reinstall/manifest.json',actual_final_bytes:d+'/native-state-final-stopped/manifest.json',native_file_logs:d+'/native-file-logs-final-stopped/manifest.json',post_reinstall:d+'/watch-post-reinstall.json',post_restart:d+'/watch-post-restart.json',normal_restart_request:d+'/normal-restart-request.json',final_stop:d+'/final-stop.json',direct_archive_review:d+'/independent-archive-review.json'},
 review:r('independent-archive-review.json'),
 native:{fresh_forwarded_ready:true,panel_running:true,udp_kcp_port:28002,normal_stop_raw_exit:0,final_state:r('final-stop.json').state,world_file:'DedicatedServerSave/Worlds/y65efezp43v0.db',sqlite:r('native-state-final-stopped/manifest.json').sqlite_inventory,operator_comment_unknown_ini_and_text_mod_retained:true,world_metadata_reuse:true,client_gameplay_tested:false,query_protocol_tested:false},
 first_failures_and_corrections:[
 'First native generation failed saving because publisher concatenated its base path without a separator; ordinary Stop raw0 was not readiness success.',
 'Craftopia-only runtime now resolves missing/exact original relative save default to confined absolute owned path. Custom paths remain unchanged.',
 'Corrected 4GiB generation actually logged World is loaded in UTF16LE file. Initial stdout-only observer was a false negative; near-cap ordinary Stop was not OOM and does not prove an 8GiB minimum.',
 '8GiB pre-relay generation initialized/saved successfully but Panel remained starting because readiness existed only in publisher file logs.',
 'Reviewed bounded fresh Unicode file relay now exposes actual readiness; both post-Reinstall and normal-restart generations reached Panel running.',
 'Normal restart observer encountered Docker container recreation absence after its single submitted request. Read-only watcher confirmed the new generation; no second restart request.',
 'Initial installer observer deadline and read-only diagnostic/parser errors retained independently; no repeated native acquisition or policy rejection bypass.'
 ],
 limitations:[
 'No external client join, gameplay, player progression, or external network reachability proof.',
 'UDP/KCP socket binding is native listener evidence, not an invented A2S query or gameplay result.',
 'Initialized world SQLite metadata and same saved world filename survive restart/Reinstall; no player-created world progress was available.',
 'Custom relative save paths are preserved and unverified; only exact default path was repaired.',
 'WORLD_NAME permits 50 characters but publisher removes formatting tags and uses at most28 for saved-world lookup. Fixture22-character name unaffected; newer metadata help does not change installed helper bytes.',
 '4GiB default remains unchanged; native was observed ready at4GiB with near-cap usage and final acceptance used8GiB. No minimum-RAM claim.',
 'Publisher native logs contain warning stack traces; fresh readiness is proven from actual marker and active UDP bind, not absence of all log errors.'
 ],
 cleanup:fs.existsSync(d+'/cleanup.json')?r('cleanup.json'):{pending_root_live_review:true},promotion:'Root review only; no automatic promotion'
};
if(report.cleanup.checks)report.status='native_evidence_complete_owned_resources_cleaned_pending_root_promotion';
fs.writeFileSync('artifacts/craftopia-native-acceptance.json',JSON.stringify(report,null,2)+'\n');console.log({status:report.status,rows:report.review.strict_reinstall_rows,helpers:report.review.source_helpers_per_checkpoint,cleanup:report.cleanup});
