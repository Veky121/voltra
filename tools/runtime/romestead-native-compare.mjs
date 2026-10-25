import fs from 'node:fs';
const [before,after,tag]=process.argv.slice(2);if([before,after,tag].some(x=>!/^[a-z0-9_-]+$/.test(x??'')))throw Error('Specify owned snapshot phases');
const dir='.local/romestead-native',a=JSON.parse(fs.readFileSync(dir+'/'+before+'.json')),b=JSON.parse(fs.readFileSync(dir+'/'+after+'.json'));if(a.uuid!==b.uuid)throw Error('Foreign snapshot');
const changed=Object.entries(a.files).filter(([name,value])=>JSON.stringify(value)!==JSON.stringify(b.files[name])).map(([name])=>name),added=Object.keys(b.files).filter(name=>!a.files[name]);
const out={before,after,uuid:a.uuid,rows:Object.keys(a.files).length,changed,added,strict_sha_bytes_mode_uid_gid:changed.length===0&&added.length===0};fs.writeFileSync(dir+'/preservation-'+tag+'.json',JSON.stringify(out,null,2)+'\n',{flag:'wx'});console.log(out);if(!out.strict_sha_bytes_mode_uid_gid)process.exitCode=1;
