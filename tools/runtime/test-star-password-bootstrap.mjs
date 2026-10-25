// MIT. Existing local MSVC only; no game/runtime/container/service operations.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root = process.cwd();
const source = path.join(root, '.local/star-bootstrap-research/lua-5.4.8/src');
const archive = path.join(root, '.local/star-bootstrap-research/lua-5.4.8.tar.gz');
const sha = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
if (sha !== '4f18ddae154e793e46eeab727c59ef1c0c0c2b744e7b94219710d76f530629ae') throw Error('Lua source pin mismatch');
const out = path.join(root, '.local/star-password-bootstrap-tests');
fs.mkdirSync(out, {recursive:true});
const msvc = 'C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC/14.44.35207';
const sdk = 'C:/Program Files (x86)/Windows Kits/10';
const version = '10.0.26100.0';
const env = {...process.env,
  INCLUDE:[`${msvc}/include`,`${sdk}/Include/${version}/ucrt`,`${sdk}/Include/${version}/shared`,`${sdk}/Include/${version}/um`].join(';'),
  LIB:[`${msvc}/lib/x64`,`${sdk}/Lib/${version}/ucrt/x64`,`${sdk}/Lib/${version}/um/x64`].join(';'),
  PATH:`${msvc}/bin/Hostx64/x64;${process.env.PATH}`};
function run(exe, args, extra={}) {
  const r = spawnSync(exe, args, {cwd:out,env,windowsHide:true,encoding:'utf8',...extra});
  if (r.status !== 0) throw Error(`Offline command failed (${r.status}): ${r.stderr || r.stdout || r.error}`);
  return r.stdout;
}
const c = fs.readdirSync(source).filter(f=>f.endsWith('.c') && f !== 'luac.c').map(f=>path.join(source,f));
run(`${msvc}/bin/Hostx64/x64/cl.exe`, ['/nologo','/O2','/MD','/DLUA_USE_WINDOWS',`/Fe${out}/lua.exe`,...c]);
const names=['unicode','admin_only','long_original','explicit_empty','bad_utf8','control','allowed_controls','truncated','trailing','oversized','no_operations','ambiguous','timeout','missing_method','native_exception','unlink_fail','no_api','no_request'];
for(const name of names) fs.mkdirSync(path.join(out,name,'Scripts'),{recursive:true});
const lua = run(path.join(out,'lua.exe'),[path.join(root,'tools/runtime/star-password-bootstrap/test.lua'),path.join(root,'tools/runtime/star-password-bootstrap/main.lua'),out.replaceAll('\\','/')]);
const python = 'C:/Users/Veky/AppData/Local/Python/pythoncore-3.15-64/python.exe';
const r=spawnSync(python,[path.join(root,'tools/runtime/star-password-bootstrap/test-prepare.py')],{cwd:out,windowsHide:true,encoding:'utf8'});
if(r.status!==0) throw Error(r.stderr || r.stdout);
const staticTests=spawnSync(python,[path.join(root,'tools/runtime/star-password-bootstrap/test-static-inspection.py')],{cwd:out,windowsHide:true,encoding:'utf8'});
if(staticTests.status!==0)throw Error(staticTests.stderr||staticTests.stdout);
console.log(lua.trim());console.log(r.stderr.trim());console.log(staticTests.stderr.trim());
const report={phase:'offline_source_tests',native_generation_verified:false,engine_mocked:true,lua_source_sha256:sha,lua:lua.trim(),python:r.stderr.trim(),static_archive_fixtures:staticTests.stderr.trim(),private_posix_staging_exercised:process.platform!=='win32',windows_rejected_as_designed:process.platform==='win32',production_adapter_changed:false};
fs.writeFileSync(path.join(root,'artifacts/star-password-bootstrap-offline.json'),JSON.stringify(report,null,2)+'\n');
// Remove dummy password requests even from negative fixtures.
for(const name of names) fs.rmSync(path.join(out,name,'request.bin'),{force:true});
