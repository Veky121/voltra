import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {official,selectAsset,runtimeFamily,verifySources,inspectArchive,audit} from './audit-tmodloader-runtime-families.mjs';

function release(tag='v2023.06.25.36',name='tModLoader.zip'){
 return {tag_name:tag,draft:false,prerelease:false,assets:[{name,size:100,digest:null,browser_download_url:`https://github.com/tModLoader/tModLoader/releases/download/${tag}/${name}`}]};
}
test('modern and legacy exact assets preserve publisher assurance',()=>{
 const modern=selectAsset(release(),'v2023.06.25.36','modern');
 assert.equal(modern.assurance,'publisher-HTTPS');assert.equal(modern.expected_sha256,null);
 assert.equal(modern.local_hash_is_independent_assurance,false);
 const tag='v0.11.8.9',name='tModLoader.Linux.v0.11.8.9.zip';
 assert.equal(selectAsset(release(tag,name),tag,'legacy').name,name);
 const documented=release();documented.assets[0].digest='sha256:'+'a'.repeat(64);
 assert.equal(selectAsset(documented,'v2023.06.25.36','modern').assurance,'publisher-checksum');
});
test('missing/wrong owner/tag/platform/duplicate asset never falls back',()=>{
 for(const change of [r=>r.assets[0].name='tModLoader.Windows.v0.11.8.9.zip',r=>r.tag_name='v2023.06.25.35',r=>r.prerelease=true,r=>r.assets.push({...r.assets[0]}),r=>r.assets[0].browser_download_url=r.assets[0].browser_download_url.replace('/tModLoader/tModLoader/','/other/repo/'),r=>r.assets[0].size=100_000_001,r=>r.assets[0].digest='sha256:wrong']){
  const r=release();change(r);assert.throws(()=>selectAsset(r,'v2023.06.25.36','modern'));
 }
});
test('runtime family is source and actual runtimeconfig driven, not tag year',()=>{
 for(const major of [6,8]){
  const source=`+\t<TargetFramework>net${major}.0</TargetFramework>`;
  const config={runtimeOptions:{tfm:`net${major}.0`,framework:{name:'Microsoft.NETCore.App',version:`${major}.0.0`}}};
  assert.equal(runtimeFamily(source,config),`net${major}.0`);
  const mismatch=structuredClone(config);mismatch.runtimeOptions.framework.version='9.0.0';
  assert.throws(()=>runtimeFamily(source,mismatch));
 }
 assert.throws(()=>runtimeFamily('+ <TargetFramework>net9.0</TargetFramework>'));
 assert.throws(()=>runtimeFamily('year2023 meansnet6'));
 assert.throws(()=>runtimeFamily('+ <TargetFramework>net6.0</TargetFramework>\n+ <TargetFramework>net8.0</TargetFramework>'));
});
test('official endpoints reject mirrors, plaintext, userinfo and foreign redirects',()=>{
 assert.equal(official('https://release-assets.githubusercontent.com/x'),'https://release-assets.githubusercontent.com/x');
 for(const value of ['http://github.com/x','https://github.com.evil.invalid/x','https://user@github.com/x','https://mirror.invalid/file.zip','https://github.com:444/x'])assert.throws(()=>official(value));
});
test('recorded primary source hash and exact repo provenance checked',()=>{
 const data=Buffer.from('source');const item={tag:'v0.11.8.9',url:'https://raw.githubusercontent.com/tModLoader/tModLoader/v0.11.8.9/source.cs',local:'tag--source.cs',bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};
 verifySources([item],()=>data);
 assert.throws(()=>verifySources([item],()=>Buffer.from('change')));
 assert.throws(()=>verifySources([{...item,local:'../source.cs'}],()=>data));
 assert.throws(()=>verifySources([{...item,url:'https://raw.githubusercontent.com/other/repo/v0.11.8.9/source.cs'}],()=>data));
});
test('archive inspector rejects links/traversal/duplicates without publication',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tml-audit-test-'));
 try{
  for(const kind of ['traversal','link','duplicate']){
   const file=path.join(root,kind+'.zip');
   execFileSync(process.env.PYTHON||'python',['-c',`import zipfile,stat,sys
with zipfile.ZipFile(sys.argv[1],'w') as z:
 kind=sys.argv[2]
 if kind=='traversal':z.writestr('../escape','fixture')
 elif kind=='duplicate':z.writestr('Data/a','a');z.writestr('data/A','b')
 else:
  e=zipfile.ZipInfo('link');e.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(e,'/escape')`,file,kind],{windowsHide:true});
   assert.throws(()=>inspectArchive(file));
  }
  assert.deepEqual(fs.readdirSync(root).sort(),['duplicate.zip','link.zip','traversal.zip']);
 }finally{
  assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'tml-audit-test-'));
  assert.equal(fs.realpathSync(root),path.resolve(root));
  fs.rmSync(root,{recursive:true,force:true});
 }
});
test('actual approved/cached archive matrix matches source and exposes open legacy prerequisite',()=>{
 const report=audit();
 assert.deepEqual(report.families.map(f=>f.family),['legacy-native-Mono','net6.0','net8.0']);
 assert(report.families.every(f=>f.archive_inspected&&!f.runtime_execution_proven&&!f.world_or_mod_migration_proven));
 const old=report.families[0].actual;
 assert(old.files.some(f=>f.path==='tModLoaderServer.bin.x86_64'&&f.machine===62&&f.elf_class===2));
 assert(old.files.some(f=>f.path==='tModLoaderServer.exe'&&f.format==='PE'));
 assert(old.legacy_mono_files.includes('mscorlib.dll'));
 assert(old.legacy_native_dependencies.needed_shared_libraries.includes('libc.so.6'));
 assert(old.server_launcher_sources.tModLoaderServer.includes('MONO_IOMAP=all'));
 assert.equal(report.families[1].actual.runtimeconfig.runtimeOptions.framework.version,'6.0.0');
 assert.equal(report.families[2].asset.expected_sha256,report.families[2].actual.archive_sha256);
 assert(report.unsupported_until_implemented.some(s=>s.includes('1.3.5.3')));
});
