import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const path=join(process.env.DEDI_DIR,'dedicatedServerConfig.xml');
if(process.argv.includes('--disable')) {
  const config=readFileSync(path,'utf8');
  const disabled=config.replace(/<mod\s[^>]*\bfilename="FS25_VoltraSave"[^>]*\/\s*>\s*/g,'');
  if(disabled!==config)writeFileSync(path,disabled,{mode:0o600});
  process.exit(0);
}

// Tiny uncompressed ZIP writer: no new runtime package/download is needed.
const crc32=buffer=>{let crc=0xffffffff;for(const b of buffer){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
const local=[],central=[];let offset=0;
const files=['modDesc.xml','VoltraSave.lua','icon.png'];
for(const name of files) {
  const filename=Buffer.from(name),data=name==='icon.png'?Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAmElEQVR4nO3QMREAIBDAsJeDMMTiCmRkoEP2Xmftc382OkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAO0B+qwyLLx1L+AAAAAASUVORK5CYII=','base64'):readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','save-mod',name));
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt32LE(crc32(data),14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
  local.push(header,filename,data);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);header.copy(entry,8,6,28);entry.writeUInt32LE(offset,42);central.push(entry,filename);offset+=header.length+filename.length+data.length;
}
const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
const mods=join(process.env.DOCS_DIR,'mods');mkdirSync(mods,{recursive:true});writeFileSync(join(mods,'FS25_VoltraSave.zip'),Buffer.concat([...local,directory,end]),{mode:0o600});
let config=readFileSync(path,'utf8');
if(!/<mod\s[^>]*filename="FS25_VoltraSave"/.test(config)) {
  config=config.includes('</mods>')?config.replace('</mods>','<mod filename="FS25_VoltraSave"/>\n</mods>'):config.replace('</gameserver>','<mods><mod filename="FS25_VoltraSave"/></mods>\n</gameserver>');
  writeFileSync(path,config,{mode:0o600});
}
console.log('[VoltraSave] Server save bridge installed. Script-mod client/crossplay compatibility must be checked before enabling on a shared server.');
