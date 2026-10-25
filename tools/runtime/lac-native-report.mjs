import fs from 'node:fs';
import crypto from 'node:crypto';
const dir='.local/lac-native',read=name=>JSON.parse(fs.readFileSync(dir+'/'+name+'.json'));
const s=read('private'),profile=read('source-profile-final'),sources=read('installed-source-final/manifest');
const embedded={},normalizations=[];for(const match of profile.egg.scripts.installation.script.matchAll(/cat > \.voltra\/([^ ]+) <<'([^']+)'\n([\s\S]*?)\n\2\n/g)){
 const raw=match[3]+'\n';embedded[match[1]]=raw.replaceAll('\r\n','\n');
 if(raw!==embedded[match[1]])normalizations.push({file:match[1],kind:'installer CRLF to LF normalization only',raw_bytes:Buffer.byteLength(raw),installed_bytes:Buffer.byteLength(embedded[match[1]])});
}
for(const [name,item]of Object.entries(sources)){
 const bytes=fs.readFileSync(dir+'/installed-source-final/'+name);
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256||!bytes.equals(Buffer.from(embedded[name])))throw Error('Final actual source differs from reviewed egg '+name);
}
const comparisons=[];
for(const prefix of ['strict','final']){
 const before=read(prefix+'-before-reinstall'),after=read(prefix+'-after-reinstall');
 if(JSON.stringify(before.files)!==JSON.stringify(after.files))throw Error('Strict persistence mismatch');
 comparisons.push({before:dir+'/'+prefix+'-before-reinstall.json',after:dir+'/'+prefix+'-after-reinstall.json',file_count:Object.keys(before.files).length,sha_bytes_mode_uid_gid_equal:true});
}
const finalStops=['corrected-stop','final-garage-stop','final-train-stop'].map(name=>{
 const proof=read(name);if(proof.state.Running||proof.state.ExitCode!==0||proof.state.OOMKilled)throw Error('Final native stop not clean');
 return {proof:dir+'/'+name+'.json',raw_exit:0,oom_killed:false,started_at:proof.state.StartedAt,finished_at:proof.state.FinishedAt};
});
const finalRead=read('read-final-train'),config=finalRead.files['.config/unity3d/MA/LAC/ServerConfig.txt'].text;
if(!config.includes('max players=9')||!config.includes('map name=TrainFacility')||!config.includes('# operator-retention-marker=517077'))throw Error('Final native settings missing');
const report={at:new Date().toISOString(),recipe:s.path,version:'1.9.7',candidate:{uuid:s.uuid,internal_id:s.internal_id,node:s.node,memory_mib:1024,disk_mib:2048,port:s.ports[0]},
 acquisition:{archive_sha256:'85a2592a3fafc3d92bb1021f860f29c7b4debb0869fd313cf16ce3db7f96eb8e',bytes:159821766,publisher_archive_cache_reused:true,corrected_reinstall_stream:dir+'/corrected-installer-stream.log',final_reinstall_stream:dir+'/final-installer-stream.log',new_downloads:0},
 first_attempt_history:{metadata_attempt_node202_missing:'artifacts/lac-native-acceptance-blocked.json',first_native_started:true,first_native_config_loaded:true,trainfacility_scene_observed:true,first_normal_sigint_stop_failed:true,actual_docker_signal:2,signal_diagnostic:dir+'/stop-signal-diagnostic.json',cleanup_only_sigterm_exit:0,cleanup_proof:dir+'/forced-cleanup-first.json',map_specific_round_marker_left_garage_starting:true},
 fixes:{scope:'LAC only',panel_stop_control:'^C',native_signal:'SIGTERM to exact child process group through shared supervisor',raw_status_retained:true,readiness_marker:'[NetworkManager] Server Started.',actual_process_regressions:2,source_fixtures_total:16},
 native:{unity:'2022.3.62f3',final_garage:read('final-garage-readiness'),final_train:read('final-train-readiness'),normal_panel_stops:finalStops,actual_map_changes:['TrainFacility','Garage','TrainFacility'],config_values:{initial_max_players:7,final_max_players:9,language:'German',public_listing:false},native_config_load_observed:true,player_cap_connection_enforcement_proven:false,private_home_and_xdg:true,udp28000_native_bound:true,additional_native_udp_socket_observed:47777,remote_peer_transport_proven:false},
 persistence:{strict_reinstalls:comparisons,unknown_comment_retained:true,unicode_operator_file_retained:true,native_prefs_written_and_reloaded:true,native_skins_retained:true,world_gameplay_save_claimed:false},
 sources:{final_actual_archive:dir+'/installed-source-final',all_actual_source_bytes_match_egg_after_installer_line_endings:true,line_ending_normalizations:normalizations,files:sources,first_actual_source_archive:dir+'/installed-source-first',intermediate_actual_source_archive:dir+'/installed-source-corrected',egg:dir+'/source-profile-final.json'},
 cleanup:read('cleanup'),
 limits:['No external game client, authenticated player join or gameplay tested. Automatic Mirror localhost host-mode logs are not external-client proof.','No supported independent public status-query protocol was established; native UDP binding and logs are the network evidence.','Max-player7→9 native configuration was loaded, but connection-cap enforcement was not tested.','Native preferences/config/skins persistence was tested; no player-edited world or editor-map gameplay save claimed.','Public listing disabled; native IPv6/IPv4 peer negotiation and internet listing remain unverified. No host sysctl or IPv6 changes.','Original SIGINT failure and intermediate map-specific readiness gap remain historical failures, never relabeled first-pass success.','Publisher archive has an observed HTTPS SHA256 pin, not an independent publisher signature.'],
 production_panel_restart:false,remote147_changes:false,catalog_promotion_performed:false};
fs.writeFileSync('artifacts/lac-native-acceptance.json',JSON.stringify(report,null,2)+'\n');console.log({report:'artifacts/lac-native-acceptance.json',strict_reinstall_files:6,normal_native_stops:finalStops.length,all_final_sources_match:true,cleanup:report.cleanup.checks});
