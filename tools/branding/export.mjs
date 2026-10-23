import {Resvg} from '@resvg/resvg-js';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../../',import.meta.url));
const web=path.join(root,'web/public');
const brand=path.join(web,'brand');
const native=path.join(root,'desktop/assets');
await Promise.all([mkdir(brand,{recursive:true}),mkdir(native,{recursive:true})]);
const svg=await readFile(path.join(root,'branding/voltra.svg'),'utf8');
const frames=new Map();
for(const size of [16,24,32,48,64,128,180,192,256,512,1024]){
  const png=new Resvg(svg,{fitTo:{mode:'width',value:size}}).render().asPng();
  frames.set(size,png);
  await writeFile(path.join(brand,`voltra-${size}.png`),png);
}
await writeFile(path.join(brand,'voltra.svg'),svg);
await writeFile(path.join(web,'favicon.svg'),svg);

function opaqueIcon(scale){
  const inner=svg.replace(/^[\s\S]*?<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'');
  const offset=1024*(1-scale)/2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#edf1f5"/><g transform="translate(${offset} ${offset}) scale(${scale})">${inner}</g></svg>`;
}
for(const size of [192,512]){
  await writeFile(path.join(brand,`voltra-maskable-${size}.png`),new Resvg(opaqueIcon(.8),{fitTo:{mode:'width',value:size}}).render().asPng());
}
await writeFile(path.join(web,'apple-touch-icon.png'),new Resvg(opaqueIcon(.9),{fitTo:{mode:'width',value:180}}).render().asPng());

// PNG-backed ICO entries retain full alpha and cover Windows 16px through 256px.
const iconSizes=[16,24,32,48,64,128,256];
const header=Buffer.alloc(6+16*iconSizes.length);
header.writeUInt16LE(1,2);header.writeUInt16LE(iconSizes.length,4);
let offset=header.length;
for(const [i,size] of iconSizes.entries()){
  const entry=6+i*16,frame=frames.get(size);
  header[entry]=header[entry+1]=size===256?0:size;
  header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);
  header.writeUInt32LE(frame.length,entry+8);header.writeUInt32LE(offset,entry+12);
  offset+=frame.length;
}
const ico=Buffer.concat([header,...iconSizes.map(size=>frames.get(size))]);
await Promise.all([writeFile(path.join(web,'favicon.ico'),ico),writeFile(path.join(native,'app.ico'),ico)]);
await writeFile(path.join(native,'app.png'),frames.get(256));

const chunks=['ic07','ic08','ic09','ic10'].map((type,i)=>{
  const png=frames.get([128,256,512,1024][i]),header=Buffer.alloc(8);
  header.write(type,0,'ascii');header.writeUInt32BE(png.length+8,4);
  return Buffer.concat([header,png]);
});
const icnsHeader=Buffer.alloc(8);icnsHeader.write('icns',0,'ascii');
icnsHeader.writeUInt32BE(8+chunks.reduce((sum,chunk)=>sum+chunk.length,0),4);
await writeFile(path.join(native,'app.icns'),Buffer.concat([icnsHeader,...chunks]));
await copyFile(path.join(brand,'voltra-1024.png'),path.join(root,'branding/voltra-master.png'));
console.log('Exported Voltra SVG, 11 PNG sizes, touch/maskable icons, ICO and ICNS.');
