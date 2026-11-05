import fs from 'node:fs';
import path from 'node:path';
import {runtime,docker,verifyRuntime,activeLease,observePower} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'craftopia-wave5-native'),state=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));
await verifyRuntime();activeLease(state.lease.lease_id,'craftopia_native_wave5');if((await observePower(state.fixture)).current_state!=='offline')throw Error('Stopped owned pilot required');
const uuid=state.fixture.server.uuid;if(!/^[a-f0-9-]{36}$/.test(uuid))throw Error('Owned UUID required');
const code=String.raw`from pathlib import Path
import json,re
root=Path('/owned')
def size(path):
 if not path.exists():return 0
 return sum(p.lstat().st_size for p in ([path] if path.is_file() else path.rglob('*')) if p.is_file() and not p.is_symlink())
text=(root/'steamapps/appmanifest_1670340.acf').read_text()
manifest={}
for key in ('appid','StateFlags','buildid','SizeOnDisk'):
 values=re.findall('"'+key+'"'+r'\s+"([0-9]+)"',text)
 if len(values)!=1:raise RuntimeError('Ambiguous installed manifest field')
 manifest[key]=int(values[0])
if manifest['appid']!=1670340 or manifest['StateFlags']!=4:raise RuntimeError('Wrong or incomplete native app')
depots=re.findall(r'"(1006|1670342)"\s*\{\s*"manifest"\s*"([0-9]+)"',text)
paths=('steamapps/downloading','steamapps/temp','.voltra/steamcmd','.voltra/python','.steam/sdk32','.steam/sdk64')
print(json.dumps({'manifest':manifest,'depots':depots,'paths':{p:size(root/p) for p in paths},'owned_regular_file_bytes':size(root)}))`;
const data=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','128m','--memory-swap','128m','--cpus','1','--mount','type=bind,source=/var/lib/voltra-parity-20261029/volumes/'+uuid+',target=/owned,readonly','sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704','python','-B','-c',code]));
const baseline=JSON.parse(fs.readFileSync(state.snapshots.baseline.file)),retained=baseline.files.reduce((n,r)=>n+r.bytes,0),sdk=data.paths['.steam/sdk32']+data.paths['.steam/sdk64'];
const bound=data.owned_regular_file_bytes+data.manifest.SizeOnDisk+retained+sdk+1024**3;
const report={at:new Date().toISOString(),recipe:'craftopia/egg-craftopia.json',...data,retained_files:baseline.files.length,retained_bytes:retained,additional_full_payload_assumption:data.manifest.SizeOnDisk,additional_sdk_atomic_copy_bound:sdk,additional_bootstrap_update_allowance:1024**3,conservative_reinstall_bound_bytes:bound,pilot_limit_bytes:16384*1024**2,proposed_original_catalog_disk_bytes:32768*1024**2,fits_pilot:bound<=16384*1024**2,fits_original_catalog_disk:bound<=32768*1024**2,canonical_behavior:'Retains every known operator/world file in a temporary copy; Steam app_update validate is in-place but its client may stage a full depot when files/build differ. No proof of zero app staging is assumed.',source_limits:'Bound uses observed build24921505/installed public metadata. Fresh metadata must still be checked before an update; growth beyond the bound aborts, never silently expands.',proposal:'Explicitly review stopped lease/build disk16GiB→original catalog32GiB before preservation reinstall; RAM8GiB and all original controls unchanged.',mutations:false};
fs.writeFileSync('artifacts/game-parity-20261029/craftopia-wave5-reinstall-disk-bound.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
