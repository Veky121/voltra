import {realpathSync} from 'node:fs';
// Only license-gated GIANTS portal links are accepted. No fallback download URLs.
import {readdirSync, mkdirSync, createWriteStream, renameSync, rmSync, statSync} from 'node:fs';
import {join, basename} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {pathToFileURL} from 'node:url';
import {readFileSync,writeFileSync} from 'node:fs';
import {digest,latestInstallers} from './dlc-update.mjs';
import {dlcLicences} from './dlc-licences.mjs';
import {createOperationReporter} from '../../scripts/operation-report.mjs';
const env = process.env, dlcOnly = process.argv.includes('--dlc-only');
const enabled = value => !['false','0','off','no'].includes(String(value).toLowerCase());
const portal = 'https://eshop.giants-software.com/downloads.php';
const headers = {'User-Agent':'Voltra-FS25/1.0', Referer:portal};
const log = text => console.log('[fs25/download] '+text);
function allowed(url) {try {const u=new URL(url); return u.protocol==='https:' && /^cdn[0-9]*\.giants-software\.com$/.test(u.hostname) && !u.username && !u.password && (!u.port || u.port==='443');} catch {return false;}}
const messages = {
  quota:'GIANTS reports that this licence has exceeded its download limit. Contact GIANTS support before retrying.',
  missing:'Enter a GIANTS server licence or upload the Windows installer.',
  portal:'GIANTS could not return the download page. Retry later.',
  installer:'GIANTS returned no supported Windows FS25 installer. Check that this licence includes the Windows game.',
  ticket:'GIANTS did not authorise an installer download. Retry later or download the installer from your GIANTS account and upload it.',
};
function failure(code) {return Object.assign(new Error(code),{downloadCode:code});}
function safeDownloadError(error) {return messages[error?.downloadCode] || (error?.code==='ENOSPC' ? 'The host has insufficient free disk space.' : 'The download could not finish. Check network access and free disk space, or upload the installer manually.');}
function decodeHTML(value) {return value.replace(/&(?:amp|quot|apos|lt|gt|#39|#x27);/gi,entity=>({'&amp;':'&','&quot;':'"','&apos;':"'",'&#39;':"'",'&#x27;':"'",'&lt;':'<','&gt;':'>'}[entity.toLowerCase()]));}
function attributes(html) {return Object.fromEntries([...html.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(match=>[match[1].toLowerCase(),decodeHTML(match[2]??match[3])]));}
function portalDownloads(html) {
  if (/download limit exceeded/i.test(html)) throw failure('quota');
  const result=[];
  for(const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const form=attributes(match[1]);
    if(!form.class?.split(/\s+/).includes('download-primary-form') || form.method?.toLowerCase()!=='post') continue;
    let action, windows;
    try {action=new URL(form.action,portal); windows=JSON.parse(form['data-default-downloads']).windows;} catch {continue;}
    if(action.origin!==new URL(portal).origin || action.pathname!=='/download.php' || action.username || action.password || !/^\d+$/.test(String(windows?.id)) || !/^Windows\b/i.test(windows?.caption||'')) continue;
    const kind=/\bIMG\b/i.test(windows.caption)?'game':/\bEXE\b/i.test(windows.caption)?'dlc':null;
    if(!kind) continue;
    const fields=new URLSearchParams();
    for(const input of match[2].matchAll(/<input\b([^>]*)>/gi)) {const field=attributes(input[1]);if(field.type==='hidden' && field.name) fields.set(field.name,field.value||'');}
    fields.set('downloadId',String(windows.id));
    if(fields.get('activationKey') && !result.some(item=>item.fields.get('downloadId')===String(windows.id))) result.push({kind,fields});
  }
  return result;
}
function portalSession(fetchImpl=fetch) {
  const cookies=new Map();
  return async (url,options={},ticket=false)=>{
    for(let hop=0;hop<5;hop++) {
      const u=new URL(url);
      if(u.origin!==new URL(portal).origin || u.username || u.password) throw failure('ticket');
      const response=await fetchImpl(u.href,{...options,headers:{...headers,...(cookies.size?{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')}:{})},redirect:'manual',signal:AbortSignal.timeout(30000)});
      for(const cookie of response.headers.getSetCookie?.() || (response.headers.get('set-cookie') || '').split(/,(?=\s*[^;,=\s]+\s*=)/).filter(Boolean)) {const pair=cookie.split(';')[0].trim(),split=pair.indexOf('=');if(split>0) cookies.set(pair.slice(0,split),pair.slice(split+1));}
      if(response.status>=300 && response.status<400 && response.headers.get('location')) {
        const next=new URL(response.headers.get('location'),u).href;
        await response.body?.cancel();
        if(ticket && allowed(next)) return next;
        if([301,302,303].includes(response.status)) options={method:'GET'};
        url=next;continue;
      }
      if(ticket) {await response.body?.cancel();throw failure('ticket');}
      return response;
    }
    throw failure('portal');
  };
}
async function download(url, folder, maximum, options={}) {
  const report=createOperationReporter({source:'fs25'});
  report({state:'running',phase:'download',code:'DOWNLOAD_CONNECTING'});
  try {await downloadWithProgress(url,folder,maximum,report,options);}
  catch(error){report({state:'failed',phase:'download',code:error?.code==='ENOSPC'?'DISK_FULL':'DOWNLOAD_FAILED'});throw error;}
}
async function downloadWithProgress(url, folder, maximum, report, {fetchImpl=fetch, now=Date.now}={}) {
  if (!allowed(url)) throw Error('Unexpected download host');
  const name = basename(new URL(url).pathname);
  if (!/^FarmingSimulator25_[A-Za-z0-9_.-]+\.(img|exe)$/i.test(name)) throw Error('Unexpected installer filename');
  const target=join(folder,name), partial=target+'.partial';
  const receipt=target+'.verified.json';
  log(name+': checking cached download.');
  try {
    const saved=JSON.parse(readFileSync(receipt,'utf8'));
    if(saved.bytes>0 && saved.bytes<=maximum && statSync(target).size===saved.bytes && await digest(target)===saved.sha256) {
      report({state:'completed',phase:'download',code:'DOWNLOAD_EXISTING'});
      return log(name+': cached download checksum verified.');
    }
  } catch { /* Old or damaged caches are replaced only after a full download. */ }
  log(name+': connecting to GIANTS; cache missing or unverified.');
  let response;
  for(let hop=0; hop<4; hop++) {
    response=await fetchImpl(url,{headers,redirect:'manual',signal:AbortSignal.timeout(2*60*60*1000)});
    if(response.status>=300 && response.status<400) {
      const next=new URL(response.headers.get('location'),url).href;
      await response.body?.cancel();
      if(!allowed(next)) throw Error('Unexpected redirect host');
      url=next; response=null; continue;
    }
    break;
  }
  if(!response?.ok || !response.body) throw Error('Download request failed');
  if(/(?:text\/|application\/(?:json|xml))/i.test(response.headers.get('content-type')||'')) {await response.body.cancel();throw failure('ticket');}
  const length=Number(response.headers.get('content-length')||0);
  const total=Number.isSafeInteger(length)&&length>0?length:0;
  if(total>maximum) {await response.body.cancel(); throw Error('Installer exceeds download limit');}
  let bytes=0, last=now(), lastBytes=0;
  log(name+': receiving '+(total ? (total/1048576).toFixed(1)+' MiB' : 'unknown total')+'.');
  const source=Readable.fromWeb(response.body);
  let lastData=now();
  const idle=setInterval(()=>{if(now()-lastData>60000)source.destroy(Error('Download stalled'));},5000);
  idle.unref?.();
  source.on('data',chunk=>{
    bytes+=chunk.length;lastData=now();
    if(bytes>maximum || total && bytes>total){source.destroy(Error('Download limit exceeded'));return;}
    report({state:'running',phase:'download',code:'DOWNLOAD_RECEIVING',bytes,total:total||null});
    const elapsed=now()-last;
    if(elapsed>=5000) {
      const rate=(bytes-lastBytes)/(elapsed/1000);
      const progress=total ? ' / '+(total/1048576).toFixed(1)+' MiB ('+(100*bytes/total).toFixed(1)+'%)' : ' MiB, total unknown';
      const eta=total && rate>0 ? ', ETA '+Math.ceil((total-bytes)/rate)+'s' : '';
      log(name+': '+(bytes/1048576).toFixed(1)+progress+', '+(rate/1048576).toFixed(1)+' MiB/s'+eta);
      last=now();lastBytes=bytes;
    }
  });
  try {
    await pipeline(source,createWriteStream(partial,{mode:0o600}));
    report({state:'running',phase:'verify',code:'DOWNLOAD_VERIFYING',bytes,total:total||null},{force:true});
    log(name+': verifying downloaded bytes and checksum.');
    if(!bytes || total && bytes!==total)throw Error('Incomplete download');
    const sha256=await digest(partial);
    renameSync(partial,target);
    writeFileSync(receipt+'.tmp',JSON.stringify({bytes,sha256}),{mode:0o600});renameSync(receipt+'.tmp',receipt);
  } catch(error){rmSync(partial,{force:true});throw error;}
  finally {clearInterval(idle);}
  log(name+': download complete, '+(bytes/1048576).toFixed(1)+' MiB.');
  report({state:'completed',phase:'download',code:'DOWNLOAD_COMPLETE',bytes,total:total||null});
}
async function portalText(response) {
  const reader=response.body.getReader(),decoder=new TextDecoder();let html='',size=0;
  while(true){const {done,value}=await reader.read();if(done){html+=decoder.decode();break;}size+=value.length;if(size>4*1024*1024){await reader.cancel();throw failure('portal');}html+=decoder.decode(value,{stream:true});}
  return html;
}
// Installed games use GIANTS' public changelog and native updater. Checking a
// version must never consume a licence-gated full-installer download ticket.
export async function latestGameVersion(environment=process.env,fetchImpl=fetch) {
  const response=await fetchImpl('https://www.farming-simulator.com/changelogs/fs25.php',{headers:{'User-Agent':'Voltra-FS25/1.0'},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw failure('portal');
  const html=await portalText(response);
  const versions=[...html.matchAll(/\bPatch\s+(\d+\.\d+\.\d+\.\d+)\b/g)].map(match=>match[1]);
  if(!versions.length)throw failure('portal');
  return versions.sort((a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);return x.map((n,i)=>y[i]-n).find(n=>n!==0)||0;})[0];
}
// Existing owned/uploaded DLC installers can be used without spending another
// download ticket, but only when public publisher metadata confirms their version.
export async function currentCachedDLCs(environment,fetchImpl=fetch) {
  const selected=latestInstallers(readdirSync(environment.DLC_DIR));
  if(!selected.length)return false;
  const response=await fetchImpl('https://www.farming-simulator.com/updates.php?lang=en&country=us',{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)return false;
  const html=await portalText(response);
  const section=html.split(/<h2[^>]*>\s*Farming Simulator 25\s*<\/h2>/i)[1]?.split(/<h2\b/i)[0];
  if(!section)return false;
  const labels={pumpsAndHosesPack:"Pumps n' Hoses Pack",emergencyPack:'Emergency Pack',strawHarvestPack:'Straw Harvest Pack',macDonPack:'MacDon Pack'};
  const published=new Map();
  for(const match of section.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?Update\s+(\d+\.\d+\.\d+(?:\.\d+)?)/gi)) {
    const name=decodeHTML(match[1].replace(/<[^>]*>/g,'').trim());
    if(!published.has(name))published.set(name,match[2].split('.').concat(match[2].split('.').length===3?['0']:[]).join('.'));
  }
  for(const item of selected) {
    if(published.get(labels[item.product])!==item.version.join('.'))return false;
    const path=join(environment.DLC_DIR,item.file);
    if(statSync(path).size<1024)return false;
    try {const receipt=JSON.parse(readFileSync(path+'.verified.json','utf8'));if(receipt.bytes!==statSync(path).size||receipt.sha256!==await digest(path))return false;}
    catch(error){if(error.code!=='ENOENT')return false;}
  }
  for(const item of selected)log(item.product+': local installer '+item.version.join('.')+' matches the current GIANTS release.');
  return true;
}
async function run({environment=env,fetchImpl=fetch,downloadFile=download,onlyDLC=dlcOnly,onlyBase=process.argv.includes('--base-only')}={}) {
  const env=environment, dlcOnly=onlyDLC;
  if(!enabled(env.AUTO_DOWNLOAD ?? 'true') || dlcOnly && !enabled(env.DOWNLOAD_DLC ?? 'false')) return;
  mkdirSync(env.INSTALLER_DIR,{recursive:true});mkdirSync(env.DLC_DIR,{recursive:true});
  const uploaded=readdirSync(env.INSTALLER_DIR).some(name=>/^(FarmingSimulator2025\.exe|Setup\.exe|FarmingSimulator25_.*(?:_ESD\.img|\.zip))$/i.test(name));
  if(!dlcOnly && uploaded) return log('Using uploaded installer.');
  if(dlcOnly && await currentCachedDLCs(env,fetchImpl))return;
  if(!env.GAME_SERIAL) throw failure('missing');
  log('Authorising with the GIANTS download portal.');
  const session=portalSession(fetchImpl);
  const response=await session(portal,{method:'POST',body:new URLSearchParams({activationKey:env.GAME_SERIAL,foobar:'DOWNLOAD'})});
  if(!response.ok) throw failure('portal');
  const html=await portalText(response);
  log('Checking available Windows installers.');
  const forms=portalDownloads(html);
  const links=[...new Set((html.match(/https:\/\/cdn[0-9]*\.giants-software\.com\/[^"'<>\s]+/gi)||[]).map(decodeHTML))].filter(url=>allowed(url)&&/\.(img|exe)$/i.test(new URL(url).pathname));
  const resolve=form=>session(new URL('/download.php',portal).href,{method:'POST',body:form.fields},true);
  if(!dlcOnly){const game=forms.find(form=>form.kind==='game');const url=game?await resolve(game):links.find(link=>/_ESD\.img$/i.test(new URL(link).pathname));if(!url)throw failure('installer');log('GIANTS authorised the Windows game installer.');await downloadFile(url,env.INSTALLER_DIR,50*1024**3);}
  if(!onlyBase&&enabled(env.DOWNLOAD_DLC ?? 'false')) {
    const mappingPath=join(env.FS25_LIB||env.DLC_DIR,'dlc-downloads.json');let mappings={};
    try {mappings=JSON.parse(readFileSync(mappingPath,'utf8'));} catch(error) {if(error.code!=='ENOENT') throw failure('portal');}
    const seen=new Set(),products=new Set();let failures=0;
    for(const licence of dlcLicences(env)) {
      try {
        let pageForms=forms,pageLinks=links,downloadSession=session;
        if(licence.id!=='base') {
          downloadSession=portalSession(fetchImpl);
          const page=await downloadSession(portal,{method:'POST',body:new URLSearchParams({activationKey:licence.key,foobar:'DOWNLOAD'})});
          if(!page.ok) throw failure('portal');
          const text=await portalText(page);
          pageForms=portalDownloads(text);pageLinks=[];
        }
        const dlcs=pageForms.filter(form=>form.kind==='dlc'),legacy=pageLinks.filter(link=>/\.exe$/i.test(new URL(link).pathname));
        if(dlcs.length+legacy.length>32)throw failure('portal');
        for(const item of [...dlcs,...legacy]) {
          const product=typeof item==='string'?item:item.fields.get('downloadId');if(products.has(product))continue;
          const url=typeof item==='string'?item:await downloadSession(new URL('/download.php',portal).href,{method:'POST',body:item.fields},true);
          const filename=basename(new URL(url).pathname);if(seen.has(filename))continue;
          await downloadFile(url,env.DLC_DIR,20*1024**3);seen.add(filename);products.add(product);mappings[filename]=licence.id;
          writeFileSync(mappingPath+'.tmp',JSON.stringify(mappings),{mode:0o600});renameSync(mappingPath+'.tmp',mappingPath);
        }
      } catch(error) {failures++;log('DLC download: '+safeDownloadError(error));}
    }
    if(failures)throw failure('ticket');
  }
}
export {allowed, download, run, portalDownloads, portalSession, safeDownloadError};
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) run().catch(error=>{const codes={quota:'PROVIDER_DOWNLOAD_LIMIT',missing:'LICENCE_REQUIRED',portal:'PROVIDER_UNAVAILABLE',ticket:'DOWNLOAD_NOT_AUTHORIZED',installer:'DOWNLOAD_UNSUPPORTED'};if(codes[error?.downloadCode])createOperationReporter({source:'fs25'})({state:'failed',phase:'authorize',code:codes[error.downloadCode]});console.error('[fs25/download] '+safeDownloadError(error));process.exitCode=1;});
