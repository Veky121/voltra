// Only license-gated GIANTS portal links are accepted. No fallback download URLs.
import {readdirSync, mkdirSync, createWriteStream, renameSync, rmSync, statSync} from 'node:fs';
import {join, basename} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {pathToFileURL} from 'node:url';
import {readFileSync,writeFileSync} from 'node:fs';
import {dlcLicences} from './dlc-licences.mjs';
const env = process.env, dlcOnly = process.argv.includes('--dlc-only');
const enabled = value => !['false','0','off','no'].includes(String(value).toLowerCase());
const portal = 'https://eshop.giants-software.com/downloads.php';
const headers = {'User-Agent':'Voltra-FS25/1.0', Referer:portal};
const log = text => console.log('[fs25/download] '+text);
function allowed(url) {try {const u=new URL(url); return u.protocol==='https:' && /^cdn[0-9]*\.giants-software\.com$/.test(u.hostname) && !u.username && !u.password && (!u.port || u.port==='443');} catch {return false;}}
const messages = {
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
      for(const cookie of response.headers.getSetCookie?.()||[]) {const pair=cookie.split(';')[0],split=pair.indexOf('=');if(split>0) cookies.set(pair.slice(0,split),pair.slice(split+1));}
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
  if(/(?:text\/|application\/(?:json|xml))/i.test(response.headers.get('content-type')||'')) {await response.body.cancel();throw failure('ticket');}
  const total=Number(response.headers.get('content-length')||0);
  if(total>maximum) {await response.body.cancel(); throw Error('Installer exceeds download limit');}
  let bytes=0, last=Date.now();
  const source=Readable.fromWeb(response.body);
  source.on('data',chunk=>{bytes+=chunk.length; if(bytes>maximum) source.destroy(Error('Download limit exceeded')); if(Date.now()-last>20000){log(name+': '+Math.round(bytes/1048576)+' MiB');last=Date.now();}});
  try {await pipeline(source,createWriteStream(partial,{mode:0o600})); if(!bytes || total && bytes!==total) throw Error('Incomplete download'); renameSync(partial,target);}
  catch(error){rmSync(partial,{force:true});throw error;}
  log(name+' downloaded.');
}
async function portalText(response) {
  const reader=response.body.getReader(),decoder=new TextDecoder();let html='',size=0;
  while(true){const {done,value}=await reader.read();if(done){html+=decoder.decode();break;}size+=value.length;if(size>4*1024*1024){await reader.cancel();throw failure('portal');}html+=decoder.decode(value,{stream:true});}
  return html;
}
async function run({environment=env,fetchImpl=fetch,downloadFile=download,onlyDLC=dlcOnly}={}) {
  const env=environment, dlcOnly=onlyDLC;
  if(!enabled(env.AUTO_DOWNLOAD ?? 'true') || dlcOnly && !enabled(env.DOWNLOAD_DLC ?? 'false')) return;
  mkdirSync(env.INSTALLER_DIR,{recursive:true});mkdirSync(env.DLC_DIR,{recursive:true});
  const uploaded=readdirSync(env.INSTALLER_DIR).some(name=>/^(FarmingSimulator2025\.exe|Setup\.exe|FarmingSimulator25_.*(?:_ESD\.img|\.zip))$/i.test(name));
  if(!dlcOnly && uploaded) return log('Using uploaded installer.');
  if(!env.GAME_SERIAL) throw failure('missing');
  const session=portalSession(fetchImpl);
  const response=await session(portal,{method:'POST',body:new URLSearchParams({activationKey:env.GAME_SERIAL,foobar:'DOWNLOAD'})});
  if(!response.ok) throw failure('portal');
  const html=await portalText(response);
  const forms=portalDownloads(html);
  const links=[...new Set((html.match(/https:\/\/cdn[0-9]*\.giants-software\.com\/[^"'<>\s]+/gi)||[]).map(decodeHTML))].filter(url=>allowed(url)&&/\.(img|exe)$/i.test(new URL(url).pathname));
  const resolve=form=>session(new URL('/download.php',portal).href,{method:'POST',body:form.fields},true);
  if(!dlcOnly){const game=forms.find(form=>form.kind==='game');const url=game?await resolve(game):links.find(link=>/_ESD\.img$/i.test(new URL(link).pathname));if(!url)throw failure('installer');log('GIANTS authorised the Windows game installer.');await downloadFile(url,env.INSTALLER_DIR,50*1024**3);}
  if(enabled(env.DOWNLOAD_DLC ?? 'false')) {
    const mappingPath=join(env.FS25_LIB||env.DLC_DIR,'dlc-downloads.json');let mappings={};
    try {mappings=JSON.parse(readFileSync(mappingPath,'utf8'));} catch(error) {if(error.code!=='ENOENT') throw failure('portal');}
    const seen=new Set(),products=new Set();
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
          writeFileSync(mappingPath,JSON.stringify(mappings),{mode:0o600});
        }
      } catch(error) {log('DLC licence: '+safeDownloadError(error));}
    }
  }
}
export {allowed, download, run, portalDownloads, portalSession, safeDownloadError};
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().catch(error=>{console.error('[fs25/download] '+safeDownloadError(error));process.exitCode=dlcOnly?0:1;});
