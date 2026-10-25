import fs from 'node:fs';
const dir='.local/onset-native';
const comparisons=[['first-before-reinstall','compat-after-reinstall'],['sql-before-reinstall','sql-after-reinstall']].map(([before,after])=>{
 const a=JSON.parse(fs.readFileSync(dir+'/'+before+'.json')),b=JSON.parse(fs.readFileSync(dir+'/'+after+'.json'));
 const changed=Object.entries(a.files).filter(([name,value])=>JSON.stringify(value)!==JSON.stringify(b.files[name])).map(([name])=>name);
 return {before,after,rows:Object.keys(a.files).length,changed,added:Object.keys(b.files).filter(name=>!a.files[name]),strict_sha_bytes_mode_uid_gid:changed.length===0};
});
fs.writeFileSync(dir+'/preservation.json',JSON.stringify(comparisons,null,2)+'\n');console.log(comparisons);
if(comparisons.some(value=>value.changed.length))process.exitCode=1;
