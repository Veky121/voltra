import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const dir='.local/sandbox-servers';fs.mkdirSync(dir,{recursive:true});
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const commit='c637a6d1e0449b167efeff81bb9a0177aa3df6c2';
const urls={
 modiverse_seed:`https://raw.githubusercontent.com/pterodactyl/game-eggs/${commit}/modiverse/ServerConfiguration.json`,
 nova_recipe_readme:`https://raw.githubusercontent.com/pterodactyl/game-eggs/${commit}/novalife_amboise/README.md`,
 generic_recipe_readme:`https://raw.githubusercontent.com/pterodactyl/game-eggs/${commit}/wine/generic/README.md`,
 beammp_publisher_manual:'https://docs.beammp.com/server/create-a-server/',
};
const sources={};
for(const[name,url]of Object.entries(urls)){
 const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Source documentation unavailable '+name);
 const text=await response.text();if(Buffer.byteLength(text)>2*1024*1024)throw Error('Source documentation exceeds bound');
 fs.writeFileSync(`${dir}/${name}.source`,text);
 sources[name]={url,sha256:sha(text),bytes:Buffer.byteLength(text)};
}
const pinned=JSON.parse(fs.readFileSync('internal/panel/game_library/scripts/sandbox-servers-modiverse-seed.json'));
if(JSON.stringify(pinned)!==JSON.stringify(JSON.parse(fs.readFileSync(`${dir}/modiverse_seed.source`))))throw Error('Local MIT Modiverse seed differs from exact pinned source');
const images={staging:'c1fd6f4e6bdf84fc9049ef770b6b71cfe503263945f9d9df917c04eead1ed52b',devel:'c20277ab115b7ee8bd7ead76edabd15d6c17cc814a2a147a78c414293b2fd486'};
const metadata={};
for(const[variant,digest]of Object.entries(images)){
 const result=spawnSync('docker',['buildx','imagetools','inspect','ghcr.io/ptero-eggs/yolks@sha256:'+digest,'--format','{{json .Image}}'],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024});
 if(result.status!==0)throw Error('Registry source metadata failed '+variant);
 const value=JSON.parse(result.stdout),history=JSON.stringify(value.history);
 if(value.architecture!=='amd64'||value.os!=='linux'||!history.includes('xvfb xauth python3'))throw Error('Registry prerequisites missing '+variant);
 fs.writeFileSync(`${dir}/wine-${variant}-metadata.json`,result.stdout);
 metadata[variant]={digest,config_sha256:sha(result.stdout),architecture:value.architecture,os:value.os,created:value.created,evidence:'Registry config/history only. No layers pulled and no runtime started. Python3/xvfb/xauth are explicit image build packages.'};
}
fs.writeFileSync(dir+'/research.json',JSON.stringify({checked_at:new Date().toISOString(),catalog_revision:commit,sources,wine_registry_metadata:metadata,limits:['No game/runtime binary downloads or native launches.','Nova and Modiverse current publisher binary behavior is not inferred from historical recipes or hosting articles.','Generic default BeamMP publisher documentation requires its own config/auth key and licensed Windows dependencies. No auth key or proprietary client assets are supplied.']},null,2)+'\n');
console.log('Pinned source/config and registry metadata research recorded; no game/runtime layers downloaded.');
