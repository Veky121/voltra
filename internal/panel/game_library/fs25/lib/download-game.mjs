// Only license-gated GIANTS portal links are accepted. No fallback download URLs.
import {readdirSync, mkdirSync, createWriteStream, renameSync, rmSync, statSync} from 'node:fs';
import {join, basename} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {pathToFileURL} from 'node:url';
const env = process.env, dlcOnly = process.argv.includes('--dlc-only');
const enabled = value => !['false','0','off','no'].includes(String(value).toLowerCase());
const portal = 'https://eshop.giants-software.com/downloads.php';
const headers = {'User-Agent':'Voltra-FS25/1.0', Referer:portal};
const log = text => console.log('[fs25/download] '+text);
function allowed(url) {const u=new URL(url); return u.protocol==='https:' && /^cdn[0-9]*\.giants-software\.com$/.test(u.hostname) && !u.username && !u.password && (!u.port || u.port==='443');}
async function download(url, folder, maximum) {
  if (!allowed(url)) throw Error('Unexpected download host');
  const name = basename(new URL(url).pathname);
  if (!/^FarmingSimulator25_[A-Za-z0-9_.-]+\.(img|exe)$/i.test(name)) throw Error('Unexpected installer filename');
  const target=join(folder,name), partial=target+'.partial';
  if (statSync(target,{throwIfNoEntry:false})?.size > 0) return log(name+' already downloaded.');
  let response;
  for(let hop=0; hop<4; hop++) {
    response=await fetch(url,{headers,redirect:'manual',signal:AbortSignal.timeout(2*60*60*1000)});
    if(response.status>=300 && response.status<400) {
      const next=new URL(response.headers.get('location'),url).href;
      await response.body?.cancel();
      if(!allowed(next)) throw Error('Unexpected redirect host');
      url=next; response=null; continue;
    }
    break;
  }
  if(!response?.ok || !response.body) throw Error('Download request failed');
  const total=Number(response.headers.get('content-length')||0);
  if(total>maximum) {await response.body.cancel(); throw Error('Installer exceeds download limit');}
  let bytes=0, last=Date.now();
  const source=Readable.fromWeb(response.body);
  source.on('data',chunk=>{bytes+=chunk.length; if(bytes>maximum) source.destroy(Error('Download limit exceeded')); if(Date.now()-last>20000){log(name+': '+Math.round(bytes/1048576)+' MiB');last=Date.now();}});
  try {await pipeline(source,createWriteStream(partial,{mode:0o600})); if(!bytes || total && bytes!==total) throw Error('Incomplete download'); renameSync(partial,target);}
  catch(error){rmSync(partial,{force:true});throw error;}
  log(name+' downloaded.');
}
async function run() {
  if(!enabled(env.AUTO_DOWNLOAD ?? 'true') || dlcOnly && !enabled(env.DOWNLOAD_DLC ?? 'false')) return;
  mkdirSync(env.INSTALLER_DIR,{recursive:true});mkdirSync(env.DLC_DIR,{recursive:true});
  const uploaded=readdirSync(env.INSTALLER_DIR).some(name=>/^(FarmingSimulator2025\.exe|Setup\.exe|FarmingSimulator25_.*(?:_ESD\.img|\.zip))$/i.test(name));
  if(!dlcOnly && uploaded) return log('Using uploaded installer.');
  if(!env.GAME_SERIAL) throw Error('Missing server licence');
  const response=await fetch(portal,{method:'POST',body:new URLSearchParams({activationKey:env.GAME_SERIAL,foobar:'DOWNLOAD'}),headers,redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw Error('GIANTS portal request failed');
  const reader=response.body.getReader();let html='';
  while(true){const {done,value}=await reader.read();if(done)break;html+=Buffer.from(value).toString('utf8');if(html.length>4*1024*1024){await reader.cancel();throw Error('Portal response too large');}}
  const links=[...new Set(html.match(/https:\/\/cdn[0-9]*\.giants-software\.com\/[^"'<>\s]+\.(?:img|exe)/gi)||[])].filter(allowed);
  if(!dlcOnly){const game=links.find(link=>/_ESD\.img$/i.test(link));if(!game)throw Error('No Windows installer returned');await download(game,env.INSTALLER_DIR,50*1024**3);}
  if(enabled(env.DOWNLOAD_DLC ?? 'false')) {
    const dlcs=links.filter(link=>/\.exe$/i.test(link));if(dlcs.length>32)throw Error('Unexpected number of DLC links');
    for(const url of dlcs)try{await download(url,env.DLC_DIR,20*1024**3);}catch{log('DLC download failed. Retry later or upload its installer.');}
  }
}
export {allowed, download, run};
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().catch(()=>{console.error('[fs25/download] Download failed. Check the licence, free space and GIANTS availability. Manual upload is available.');process.exitCode=dlcOnly?0:1;});
