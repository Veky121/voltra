// Public publisher metadata only. Never runs a game or authenticates to Steam.
import fs from 'node:fs';
import crypto from 'node:crypto';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const folder='.local/virtual-worlds';fs.mkdirSync(folder,{recursive:true});
const proof={checked_at:new Date().toISOString(),native_execution:false,downloads:[],sources:[
 'https://wiki.neosvr.com/Headless_Client',
 'https://wiki.resonite.com/Headless_server_software/Setup',
 'https://wiki.resonite.com/Headless_server_software/Configuration_file',
 'https://hub.docker.com/r/beamdog/nwserver',
]};
const releases={nwn:{version:'8193.37-17',url:'https://nwn.beamdog.net/downloads/nwnee-dedicated-8193.37-17.zip',sha256:'e46444749cbd1f8238802b8c6d603ba8ed9252e6f1f835f2b5bd4933db6b96f3'},mods:{}};
releases.nss={version:'1.1.15-2',sha256:'9ed89f074054a8caf470ecfe3414773a99ea529b61b8fa156654440a5bf210dd',copyright_sha256:'3748318e83f580635c1a137345ed3cd45f0cc86b82924a0f2866fcd92a57d459',source:'Ubuntu24.04 signed package repositories, Linux amd64',upstream:'https://cwrap.org/nss_wrapper.html'};
for(const[game,repo,tag,names]of[
 ['neos','neos-modding-group/NeosModLoader','1.12.6',['NeosModLoaderHeadless.dll','0Harmony.dll']],
 ['resonite','resonite-modding-group/ResoniteModLoader','5.0.1',['ResoniteModLoader.dll','0Harmony.dll']],
]){
 const url=`https://api.github.com/repos/${repo}/releases/tags/${tag}`;
 const response=await fetch(url);if(!response.ok)throw Error('Release metadata '+response.status);
 const metadata=await response.json();fs.writeFileSync(`${folder}/${game}-release.json`,JSON.stringify(metadata,null,2)+'\n');
 releases.mods[game]={tag,repository:repo,assets:[],licenses:[]};
 for(const name of names){
  const asset=metadata.assets.find(a=>a.name===name);if(!asset)throw Error('Missing '+name);
  if(asset.size>8*1024*1024)throw Error('Asset too large');
  const r=await fetch(asset.browser_download_url);if(!r.ok)throw Error('Asset '+r.status);
  const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length!==asset.size)throw Error('Size mismatch');
  const digest=sha(bytes);if(asset.digest&&asset.digest!=='sha256:'+digest)throw Error('Publisher digest mismatch');
  releases.mods[game].assets.push({name,url:asset.browser_download_url,sha256:digest,size:bytes.length});
  proof.downloads.push({url:asset.browser_download_url,sha256:digest,bytes:bytes.length,publisher_digest:asset.digest});
 }
 for(const[name,url]of[
  [game+'-mod-loader-LGPL.txt',`https://raw.githubusercontent.com/${repo}/${tag}/LICENSE.txt`],
  [game+'-harmony-MIT.txt',`https://raw.githubusercontent.com/pardeike/Harmony/${game==='neos'?'v2.2.1.0':'v2.2.2.0'}/LICENSE`],
 ]){
  const r=await fetch(url);if(!r.ok)throw Error('License '+r.status);const bytes=Buffer.from(await r.arrayBuffer());
  if(bytes.length>65536)throw Error('License too large');
  releases.mods[game].licenses.push({name,url,sha256:sha(bytes),size:bytes.length});
  proof.downloads.push({url,sha256:sha(bytes),bytes:bytes.length});
 }
}
fs.writeFileSync('internal/panel/game_library/scripts/virtual-worlds-releases.json',JSON.stringify(releases,null,2)+'\n');
fs.writeFileSync(`${folder}/publisher-proof.json`,JSON.stringify(proof,null,2)+'\n');
console.log('Pinned publisher archive and four mod assets; no game executed.');
