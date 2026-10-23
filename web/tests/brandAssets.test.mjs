import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const publicFile=name=>readFileSync(new URL(`../public/${name}`,import.meta.url));
function pngSize(bytes){
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

test('web home-screen icons resolve to PNGs with their advertised dimensions',()=>{
  const manifest=JSON.parse(publicFile('manifest.json'));
  for(const icon of manifest.icons){
    assert.equal(pngSize(publicFile(icon.src.slice(1))),icon.sizes);
  }
  assert.equal(pngSize(publicFile('apple-touch-icon.png')),'180x180');
  for(const size of [16,24,32,48,64,128,180,192,256,512,1024]){
    assert.equal(pngSize(publicFile(`brand/voltra-${size}.png`)),`${size}x${size}`);
  }
});

test('browser and Windows icons contain valid PNG frames at every native resolution',()=>{
  const icon=publicFile('favicon.ico');
  assert.deepEqual(icon,readFileSync(new URL('../../desktop/assets/app.ico',import.meta.url)));
  assert.equal(icon.readUInt16LE(2),1);
  const sizes=[];
  for(let i=0;i<icon.readUInt16LE(4);i++){
    const entry=6+i*16,size=icon[entry]||256;
    const length=icon.readUInt32LE(entry+8),offset=icon.readUInt32LE(entry+12);
    assert.equal(pngSize(icon.subarray(offset,offset+length)),`${size}x${size}`);
    sizes.push(size);
  }
  assert.deepEqual(sizes,[16,24,32,48,64,128,256]);
});
