import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {ensureSyntaxTree} from '@codemirror/language';
import {highlightTree,classHighlighter} from '@lezer/highlight';
import {decodeEditorFile,detectLanguage,editorLanguages,isBinaryText} from '../src/client/editorLanguages.ts';

const fixtures=[
  ['server.properties','# Minecraft server\nonline-mode=true\nserver-port=25565','Properties files'],
  ['eula.txt','# EULA setting\neula=false','Properties files'],
  ['forge-client.toml','# Forge config\n[general]\nenabled=true','TOML'],
  ['forge.cfg','# Configuration file\ngeneral {\n B:enabled=true\n I:count=4\n S:names <\n  stone\n >\n}','Forge config'],
  ['sponge.conf','server {\n enabled = true\n motd = "Voltra"\n}','HOCON'],
  ['unknown.blob','server {\n enabled = true\n}','HOCON'],
  ['mystery.cfg','[general]\nenabled = true\ncount = 4','TOML'],
  ['settings.ini','[general]\nlabel=Hello world','Properties files'],
  ['mystery.cfg','[general]\nlabel=Hello world','Properties files'],
  ['mystery.cfg','enabled=true\ncount=4','Properties files'],
  ['mystery.cfg','# only comments','Properties files'],
  ['custom.anything','{"enabled":true,"count":4}','JSON'],
  ['custom.conf','// mod config\n{\n "enabled": true,\n}','JSON5'],
  ['custom.weird','/* mod config */\n{enabled: true, count: 4,}','JSON5'],
  ['custom.weird',"{enabled: 'yes',}",'JSON5'],
  ['config.json','// generated config\n{"enabled":true}','JSONC'],
  ['config.json','{"enabled":true}','JSON'],
  ['config.json5','{enabled:true,}','JSON5'],
  ['config.jsonc','// hi\n{"enabled":true}','JSONC'],
  ['config.yml','# plugin\nserver:\n  enabled: true','YAML'],
  ['mystery.conf','server:\n  enabled: true','YAML'],
  ['custom.unknown','server:\n  enabled: true','YAML'],
  ['pack.mcmeta','{"pack":{"pack_format":1}}','JSON5'],
  ['mcmod.info','[{"modid":"example"}]','JSON5'],
  ['default.snbt','{enabled:1b,count:4s}','SNBT'],
  ['custom.weird','{enabled:1b,items:[I;1,2]}','SNBT'],
  ['load.mcfunction','say Ready\nexecute as @a run say Hello','Minecraft function'],
  ['welcome.sk','on join:\n send "Hello" to player','Skript'],
  ['recipes.zs','val test = 1;','Java'],
  ['settings.toml.bak.disabled','[general]\nenabled=true','TOML'],
  ['CONFIG.YAML','key: value','YAML'],
  ['.env.local','SERVER_PORT=25565','Properties files'],
  ['Dockerfile.dev','FROM alpine','Dockerfile'],
  ['nginx.conf','events {}','Nginx'],
  ['tsconfig.json','{"compilerOptions":{}}','JSONC'],
  ['unknown','#!/usr/bin/env python3\nprint("hello")','Python'],
  ['unknown','#!/bin/bash\necho hello','Shell'],
  ['unknown','#!/usr/bin/env node\nconsole.log("hi")','JavaScript'],
  ['unknown','<?xml version="1.0"?><config/>','XML'],
  ['unknown','<!doctype html><html></html>','HTML'],
  ['unknown','\uFEFF{"key":true}','JSON'],
  ['unknown','Just some ordinary notes.','Plain text'],
  ['notes.txt','','Plain text'],
  ['custom.weird','[1,2,3]','JSON'],
  ['custom.weird','{}','JSON'],
];
for(const [filename,content,expected] of fixtures)test(`detect ${filename}: ${expected}`,()=>{
  assert.equal(detectLanguage(filename,content).name,expected);
});
test('catalog languages all load and include actual parser support',async()=>{
  assert.ok(editorLanguages.length>=150);
  assert.equal(new Set(editorLanguages.map(l=>l.name)).size,editorLanguages.length);
  for(const description of editorLanguages){
    const support=await description.load();
    assert.ok(support.language,description.name);
  }
});
test('game-specific modes generate highlighted tokens',async()=>{
  for(const name of ['Forge config','HOCON','SNBT','Minecraft function','Skript','JSON5','JSONC']){
    const fixture=fixtures.find(f=>f[2]===name);
    const support=await editorLanguages.find(l=>l.name===name).load();
    const state=EditorState.create({doc:fixture[1],extensions:[support]});
    const tree=ensureSyntaxTree(state,state.doc.length,1000);
    assert.ok(tree,name);
    let highlighted=0;highlightTree(tree,classHighlighter,()=>highlighted++);
    assert.ok(highlighted>0,`${name} generated no highlighted tokens`);
  }
});
test('known file extension takes precedence over misleading contents',()=>{
  assert.equal(detectLanguage('app.py','data = {"value":true}').name,'Python');
  assert.equal(detectLanguage('config.yml','enabled=true').name,'YAML');
});
test('binary detection permits Unicode and normal text whitespace',()=>{
  assert.equal(isBinaryText('server=Voltra\r\nmessage=こんにちは\n\tvalue=true'),false);
  assert.equal(isBinaryText('\0PNG\x01'),true);
  assert.equal(isBinaryText('\x01\x02\x03\x04\x05binary'),true);
});
test('CodeMirror retains CRLF separators and BOM during edits',()=>{
  const original='\uFEFF# config\r\nenabled=true\r\n';
  const state=EditorState.create({doc:original,extensions:[EditorState.lineSeparator.of('\r\n')]});
  const changed=state.update({changes:{from:state.doc.length,insert:'count=4\r\n'}}).state;
  assert.equal(changed.sliceDoc(),original+'count=4\r\n');
});
test('UTF-8 loading keeps the byte order mark and rejects unreadable encodings',()=>{
  const original='\uFEFF# config\r\nenabled=true\r\n';
  assert.equal(decodeEditorFile(new TextEncoder().encode(original).buffer),original);
  assert.throws(()=>decodeEditorFile(new Uint8Array([0xff,0x80,0x90]).buffer),/not UTF-8/);
  assert.throws(()=>decodeEditorFile(new TextEncoder().encode('binary\0data').buffer),/binary file/);
});
test('large unknown JSON uses a bounded sample',()=>{
  assert.equal(detectLanguage('unknown','{"value":"'+'x'.repeat(1000000)+'"}').name,'JSON');
});
