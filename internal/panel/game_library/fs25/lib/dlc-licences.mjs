import {readFileSync} from 'node:fs';
import {basename,join} from 'node:path';
import {pathToFileURL} from 'node:url';

export function dlcLicences(environment=process.env) {
  const raw=environment.DLC_PRODUCT_KEY?.trim()||'';
  let entries=[];
  if(raw.startsWith('[')) {
    try {entries=JSON.parse(raw);} catch {throw Error('Admin DLC licence configuration is invalid.');}
    if(!Array.isArray(entries)||entries.length>32) throw Error('Admin DLC licence configuration is invalid.');
    entries=entries.map(entry=>{
      if(typeof entry?.key!=='string'||!entry.key.trim()||entry.key.length>128||typeof entry.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(entry.id)) throw Error('Admin DLC licence configuration is invalid.');
      return {id:entry.id,name:String(entry.name||'DLC').slice(0,191),key:entry.key};
    });
  } else if(raw) {if(raw.length>128)throw Error('Admin DLC licence configuration is invalid.');entries=[{id:'legacy',name:'DLC',key:raw}];}
  return [{id:'base',name:'Included DLCs',key:environment.GAME_SERIAL||''},...entries].filter(entry=>entry.key);
}

export function installerKey(filename,environment=process.env) {
  const entries=dlcLicences(environment);
  let mappings={};try {mappings=JSON.parse(readFileSync(join(environment.FS25_LIB,'dlc-downloads.json'),'utf8'));} catch(error) {if(error.code!=='ENOENT') throw Error('DLC download mapping is invalid.');}
  const id=mappings[basename(filename)];
  if(id) {const entry=entries.find(entry=>entry.id===id);if(!entry)throw Error('The admin licence for this DLC is no longer assigned.');return entry.key;}
  // Uploaded installers need an unambiguous key. Never try every saved key.
  if(entries.length===1) return entries[0].key;
  if(entries.length===2&&entries[1].id==='legacy') return entries[1].key;
  throw Error('This uploaded DLC has no matching admin licence. Download it through the assigned licence first.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {process.stdout.write(installerKey(process.argv[2]).replace(/[\s-]/g,''));}
  catch {console.error('[fs25/install] No unambiguous admin licence is assigned to this DLC.');process.exitCode=1;}
}
