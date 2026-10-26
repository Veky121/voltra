import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dominantArtworkColor,artworkColor} from '../src/client/artworkColor.ts';

test('dominant artwork color ignores lettering, shadows and transparent margins',()=>{
  const pixels=[...Array(30).fill([255,255,255,255]),...Array(30).fill([5,5,5,255]),...Array(30).fill([255,0,0,0]),...Array(12).fill([60,140,70,255]),[200,70,40,255]].flat();
  assert.equal(dominantArtworkColor(pixels),'rgb(60, 140, 70)');
  assert.equal(dominantArtworkColor([0,0,0,0,255,255,255,255]),undefined);
});

test('cards reuse a loaded image color without resampling on refresh or remount',()=>{
  let reads=0;
  const original=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>({drawImage(){},getImageData(){reads++;return {data:[40,80,180,255]}}})})};
  try{
    const image={currentSrc:'/cached-artwork.png'};
    assert.equal(artworkColor(image),'rgb(40, 80, 180)');
    assert.equal(artworkColor({...image}),'rgb(40, 80, 180)');
    assert.equal(reads,1);
  }finally{globalThis.document=original;}
});

test('restricted image sampling fails quietly and is cached',()=>{
  let attempts=0;
  const original=globalThis.document;
  globalThis.document={createElement(){attempts++;throw new Error('Restricted canvas');}};
  try{
    assert.equal(artworkColor({src:'/restricted.png'}),undefined);
    assert.equal(artworkColor({src:'/restricted.png'}),undefined);
    assert.equal(attempts,1);
  }finally{globalThis.document=original;}
});
