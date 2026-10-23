import test from 'node:test';
import assert from 'node:assert/strict';
import {setArtworkMapping,artworkSnapshot,subscribeArtwork,panelArtwork} from '../src/client/artworkLibrary.ts';
import {getServerArtwork} from '../src/client/serverArtwork.ts';
test('private artwork overlays safe catalog once and keeps fallbacks',()=>{
 const base=getServerArtwork({game:'rust'});let calls=0;const stop=subscribeArtwork(()=>calls++);
 const src='/api/client/artwork/'+ 'a'.repeat(64)+'.png';
 setArtworkMapping({server:{rust:src,minecraft:'https://evil.test/a.png'},library:{test:src}});
 assert.equal(getServerArtwork({game:'rust'}).src,src);
 assert.equal(panelArtwork('library','test',{src:'/fallback.svg'}).src,src);
 assert.equal(artworkSnapshot().server.minecraft,undefined);
 assert.equal(calls,1);stop();setArtworkMapping(null);
 assert.deepEqual(getServerArtwork({game:'rust'}),base);
 assert.equal(panelArtwork('library','unknown',{src:'/fallback.svg'}).src,'/fallback.svg');
});
