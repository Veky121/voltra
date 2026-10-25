// MIT. Hash the bounded public primary sources and freeze the owned source package.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
const root=process.cwd(), directory='tools/runtime/star-password-bootstrap';
const archive='.local/star-bootstrap-research/ue4ss';
const stable='d935b5b23bac03b65c14ae38382b02007204cc2e';
const refs=[];
for(const file of fs.readdirSync(archive).filter(f=>f.startsWith('stable__'))){
  const p=file.slice(8).replaceAll('__','/'), body=fs.readFileSync(path.join(archive,file));
  refs.push({repo:'UE4SS-RE/RE-UE4SS',commit:stable,path:p,url:`https://raw.githubusercontent.com/UE4SS-RE/RE-UE4SS/${stable}/${p}`,bytes:body.length,sha256:sha(body),archive:`${archive}/${file}`});
}
const license=fs.readFileSync(`${archive}/LICENSE`);
refs.push({repo:'UE4SS-RE/RE-UE4SS',commit:'97adba01e9fcb3c208376581e54edb9ef466f233',path:'LICENSE',url:'https://raw.githubusercontent.com/UE4SS-RE/RE-UE4SS/97adba01e9fcb3c208376581e54edb9ef466f233/LICENSE',bytes:license.length,sha256:sha(license),archive:`${archive}/LICENSE`});
const luaHeader=fs.readFileSync('.local/star-bootstrap-research/lua-5.4.8/src/lua.h','utf8');
const licenseStart=luaHeader.lastIndexOf('Copyright (C) 1994-2025');
if(licenseStart<0)throw Error('Lua notice missing');
fs.writeFileSync(`${directory}/LICENSES/Lua-MIT.txt`,luaHeader.slice(licenseStart,luaHeader.indexOf('******************************************************************************/',licenseStart)).replace(/^\* ?/gm,'')+'\n');
const sourceManifest={phase:'source_only',native_generation_verified:false,production_adapter_changed:false,
  sources:refs,lua_test_source:{url:'https://www.lua.org/ftp/lua-5.4.8.tar.gz',sha256:'4f18ddae154e793e46eeab727c59ef1c0c0c2b744e7b94219710d76f530629ae',bytes:fs.statSync('.local/star-bootstrap-research/lua-5.4.8.tar.gz').size,license:'MIT'},
  binding:{repo:'AlienXAXS/StarRupture-Plugin-ServerUtility',commit:'89cb8aa60304fe57edd385501b4ab568488ff25c',path:'src/hooks/set_password/set_password.h',license:'MIT',class_cpp:'UCrDedicatedServerSettingsComp',class_unreal_short_name:'CrDedicatedServerSettingsComp',methods:['SetPassword','SetPlayerPassword'],actual_reflected_existence_native_verified:false},
  full_loader_source_build:{verified:false,unresolved:'Pinned UEPseudo submodule public repository and license returned404; no inaccessible SDK acquired'},
  binary:{acquired_by_this_task:false,cached_official_archive_inspected:true,release:'v3.0.1',asset:'UE4SS_v3.0.1.zip',bytes:5523402,sha256:'4b47d4bceddd2f561a4e395bfa00924ccfc945af576a2d0c613e6537846c57ec',binary_executed:false,native_compatibility_verified:false,inspection:'artifacts/star-password-bootstrap-loader-inspection.json'},
  original_policy:{fields:['ADMIN_PASSWORD','PLAYER_PASSWORD'],rules:'string|nullable',defaults:['',''],original_permissions_preserved:true,bounded_utf8_bytes_per_value:4194304,all_original_controls_preserved_except_embedded_nul_unsupported:true,nul_reason:'Pinned UE4SS FString c_str conversion truncates embedded NUL; reject explicitly'},
  api_contract:{UObject_CallFunction:'UE4SS/include/LuaType/LuaUObject.hpp:515 and UE4SS/src/LuaType/LuaUObject.cpp:68-111',UFunction_type:'UE4SS/src/LuaType/LuaUFunction.cpp:96',IsValid:'UE4SS/include/LuaType/LuaUObject.hpp:178,610',FindAllOf:'UE4SS/src/Mod/LuaMod.cpp:978; docs/lua-api/global-functions/findallof.md',game_thread:'docs/lua-api/global-functions/executeingamethread.md',async_timer:'docs/lua-api/global-functions/executewithdelay.md',fstring_marshaling:'UE4SS/src/LuaType/LuaUObject.cpp:1091-1127'},
  forbidden_actions_performed:[],native_gate_retained:true};
fs.writeFileSync(`${directory}/sources.json`,JSON.stringify(sourceManifest,null,2)+'\n');
const files=['main.lua','prepare.py','test.lua','test-prepare.py','README.md','NATIVE_PLAN.md','inspect-cached-loader.py','inspect-experimental-loader.py','test-static-inspection.py','sources.json','checkpoint.mjs','LICENSES/UE4SS-MIT.txt','LICENSES/Lua-MIT.txt'].map(p=>`${directory}/${p}`);
files.push('tools/runtime/test-star-password-bootstrap.mjs');
const hashes=files.map(p=>{const body=fs.readFileSync(p);return {path:p,bytes:body.length,sha256:sha(body)};});
const packageRoot='.local/star-password-bootstrap/package/VoltraPasswordBootstrap';
fs.mkdirSync(`${packageRoot}/Scripts`,{recursive:true});
fs.copyFileSync(`${directory}/main.lua`,`${packageRoot}/Scripts/main.lua`);
fs.writeFileSync('artifacts/star-password-bootstrap-checkpoint.json',JSON.stringify({phase:'source_implemented_native_unverified',source_files:hashes,source_package:packageRoot,ue4ss_binary_bundled:false,operator_mods_list_modified:false,native_encrypted_file_gate_retained:true,source_manifest:`${directory}/sources.json`,tests:'artifacts/star-password-bootstrap-offline.json'},null,2)+'\n');
console.log(`Frozen ${hashes.length} scoped files; loadable Lua source package only; no native verification`);
