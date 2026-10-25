import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const output=path.resolve('.local/onset-native/compat-inspect');
if(fs.existsSync(output))throw Error('Existing compatibility acquisition; inspect without overwriting');fs.mkdirSync(output,{recursive:true});
const script=`set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update
cd /out
apt-cache policy libmariadb3 > package-policy.txt
apt-cache show libmariadb3 > package-metadata.txt
apt-get download libmariadb3
package=$(find /out -maxdepth 1 -type f -name 'libmariadb3_*_amd64.deb')
test -n "$package"
sha256sum "$package" > package-sha256.txt
dpkg-deb --extract "$package" /tmp/extracted
cp /tmp/extracted/usr/lib/x86_64-linux-gnu/libmariadb.so.3 /out/libmariadb.so.3
cp /tmp/extracted/usr/share/doc/libmariadb3/copyright /out/copyright
sha256sum /out/libmariadb.so.3 > library-sha256.txt
`;
const r=spawnSync('docker',['run','--rm','--pull','never','--memory','256m','--cpus','1','--mount',`type=bind,source=${output},target=/out`,'debian:bookworm-slim','sh','-ec',script],{windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:4e6});
fs.writeFileSync(output+'/acquisition.log',r.stdout+r.stderr);
if(r.status)throw Error('Signed package inspection failed: '+r.stderr);console.log('Signed Bookworm package and license acquired for ABI inspection only.');
