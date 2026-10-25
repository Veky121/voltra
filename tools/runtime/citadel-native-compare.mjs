import fs from 'node:fs';
const dir='.local/citadel-native';
const before=JSON.parse(fs.readFileSync(dir+'/snapshot-before-reinstall.json'));
const after=JSON.parse(fs.readFileSync(dir+'/snapshot-after-reinstall.json'));
if(JSON.stringify(before.files)!==JSON.stringify(after.files)||JSON.stringify(before.links)!==JSON.stringify(after.links))throw Error('Strict SHA/bytes/mode/UID/GID or link identity retention failed; hold native start');
const mtimes_changed=Object.keys(before.mtimes_ns).filter(name=>before.mtimes_ns[name]!==after.mtimes_ns[name]);
fs.writeFileSync(dir+'/retention-comparison.json',JSON.stringify({files:Object.keys(before.files).length,sha_bytes_mode_uid_gid_equal:true,link_identities_equal:true,mtimes_changed,mtime_is_separate_from_content_metadata:true},null,2)+'\n',{flag:'wx'});
console.log({files:Object.keys(before.files).length,strict_equal:true,mtimes_changed:mtimes_changed.length});
