import fs from 'node:fs';
import crypto from 'node:crypto';
import {verifyRuntime,activeLease,api,observePower} from './campaign-native-20261029.mjs';
const dir='.local/game-parity-20261029/veloren-root-native',file=dir+'/state.json',state=JSON.parse(fs.readFileSync(file)),save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n'),phase=process.argv[2],native='/userdata/server/server_config/settings.ron';
activeLease(state.lease.lease_id,state.lease.owner);await verifyRuntime();if(!state.server||!state.slot_released||(await observePower(state)).current_state!=='offline')throw Error('Owned installed offline fixture with released acquisition slot required');
const owned=(await api('/api/application/servers/'+state.server.id)).attributes;if(owned.uuid!==state.server.uuid||owned.egg!==state.egg.id||owned.node!==1)throw Error('Owned fixture identity drift');
const endpoint='/api/client/servers/'+state.server.uuid,hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function read(path=native){const r=await fetch('http://127.0.0.1:18099'+endpoint+'/files/contents?file='+encodeURIComponent(path));if(!r.ok)throw Error('Owned native read failed');return Buffer.from(await r.arrayBuffer());}
async function write(path,bytes){const r=await fetch('http://127.0.0.1:18099'+endpoint+'/files/write?file='+encodeURIComponent(path),{method:'POST',headers:{'Content-Type':'text/plain'},body:bytes});if(!r.ok)throw Error('Owned file-workspace write failed '+r.status);await r.text();}
if(phase==='seed-operator'){
 if(state.operator_edit)throw Error('Existing operator roundtrip requires review');
 const before=await read(),text=before.toString('utf8');if(hash(before)!==state.captures.baseline.records[native.slice(1)].sha256||!/\n\)\s*$/.test(text)||/\b(day_length|max_player_group_size|operator_case_marker)\s*:/.test(text))throw Error('Known minimal generated document drift');
 fs.writeFileSync(dir+'/operator-before.ron',before);
 const index=text.lastIndexOf('\n)'),prefix=text.slice(0,index).trimEnd(),candidate=Buffer.from(prefix+(prefix.endsWith(',')?'':',')+'\n    // Operator comment: preserve exact unknown bytes and scalar settings.\n    day_length: 600.0,\n    max_player_group_size: 4,\n    operator_case_marker: (message: "literal comma, nested close )", nested: (flag: true)),\n)\n');
 // This is one known inspected native file edit, not a general RON parser.
 fs.writeFileSync(dir+'/operator-intended.ron',candidate);await write(native,candidate);
 if(hash(await read())!==hash(candidate))throw Error('Raw native file-workspace roundtrip differs');
 await write('/operator-parity-note.txt',Buffer.from('Veloren campaign operator file: preserve bytes.\r\n'));
 state.operator_edit={at:new Date().toISOString(),boundary:'Actual existing raw file workspace edit; no typed backend support claim',before_sha256:hash(before),after_sha256:hash(candidate),fields:{day_length:600.0,max_player_group_size:4},unknown_comment_and_nested_marker:true};save();console.log(JSON.stringify(state.operator_edit));
}else if(phase==='verify-operator'){
 const intended=fs.readFileSync(dir+'/operator-intended.ron'),actual=await read();if(hash(actual)!==hash(intended))throw Error('Native boot changed operator settings or unknown bytes');state.operator_verified={at:new Date().toISOString(),exact_native_bytes:true,sha256:hash(actual)};
 if(state.operator_asset){if(hash(await read(state.operator_asset.path))!==state.operator_asset.after_sha256)throw Error('Native boot changed existing operator asset');state.operator_verified.existing_stock_asset_exact=true;}
 if((await read('/operator-parity-note.txt')).toString('utf8')!=='Veloren campaign operator file: preserve bytes.\r\n')throw Error('Unknown operator file changed');state.operator_verified.unknown_operator_file_exact=true;save();console.log(JSON.stringify(state.operator_verified));
}else if(phase==='seed-stock-asset'){
 if(state.operator_asset||!state.operator_verified)throw Error('One validated existing stock asset edit required');
 const path='/assets/voxygen/i18n/README.md';if(!state.native_identity.release.asset_files.includes(path.slice(1)))throw Error('Exact publisher documentation asset missing');
 const before=await read(path),after=Buffer.concat([before,Buffer.from('\n\n<!-- Voltra campaign operator documentation edit: preserve exact bytes. -->\n')]);
 fs.writeFileSync(dir+'/stock-asset-original.md',before);fs.writeFileSync(dir+'/stock-asset-intended.md',after);await write(path,after);if(hash(await read(path))!==hash(after))throw Error('Existing stock asset edit differs');state.operator_asset={at:new Date().toISOString(),path,before_sha256:hash(before),after_sha256:hash(after),boundary:'Existing publisher Markdown documentation changed; no native gameplay/configuration semantics altered'};save();console.log(JSON.stringify(state.operator_asset));
}else if(phase==='invalid-type'){
 if(!state.operator_verified||state.invalid_config)throw Error('Successful valid operator boot required before invalid type probe');
 const before=await read(),text=before.toString('utf8');if(hash(before)!==state.operator_verified.sha256||text.split('day_length: 600.0').length!==2)throw Error('Inspected scalar span drift');
 const invalid=Buffer.from(text.replace('day_length: 600.0','day_length: "invalid numeric type"'));fs.writeFileSync(dir+'/invalid-type-before.ron',before);fs.writeFileSync(dir+'/invalid-type-intended.ron',invalid);await write(native,invalid);if(hash(await read())!==hash(invalid))throw Error('Negative native fixture write differs');state.invalid_config={at:new Date().toISOString(),kind:'Native f64 field supplied string',before_sha256:hash(before),invalid_sha256:hash(invalid),restored:false};save();console.log(JSON.stringify(state.invalid_config));
}else if(phase==='restore-invalid'){
 if(!state.invalid_config||state.invalid_config.restored)throw Error('Owned pending negative fixture required');
 const current=await read();if(hash(current)!==state.invalid_config.invalid_sha256)throw Error('Rejected config mutated before restoration');
 const original=fs.readFileSync(dir+'/invalid-type-before.ron');if(hash(original)!==state.invalid_config.before_sha256)throw Error('Original config backup differs');await write(native,original);if(hash(await read())!==hash(original))throw Error('Native restoration differs');state.invalid_config.rejected_bytes_retained=true;state.invalid_config.restored=true;state.invalid_config.restored_at=new Date().toISOString();save();console.log(JSON.stringify(state.invalid_config));
}else throw Error('Use seed-operator|verify-operator|seed-stock-asset|invalid-type|restore-invalid');
