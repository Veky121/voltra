import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sourceRegressionManifest} from './source-regression-manifest.mjs';

test('captures fixture files and directory additions outside source roots',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'voltra-source-inputs-'));
 try {
  const write=(name,data)=>{fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),data);};
  write('internal/panel/example_test.go','package panel\nvar a="../../artifacts/capture.ini"\nvar b="../../artifacts/logs/"\nvar c="artifacts/optional-missing.json"');
  write('artifacts/capture.ini','original');write('artifacts/logs/a.log','fixture');write('.local/private-env.json','excluded');
  const before=sourceRegressionManifest(root);
  assert.ok(before.files.some(row=>row.path==='artifacts/capture.ini'));
  assert.ok(before.files.some(row=>row.path==='artifacts/logs/a.log'));
  assert.ok(!before.files.some(row=>row.path.includes('.local')));
  assert.deepEqual(before.missing_artifact_references,['artifacts/optional-missing.json']);
  write('artifacts/capture.ini','changed');write('artifacts/logs/b.log','new');
  const after=sourceRegressionManifest(root);
  assert.notEqual(before.files.find(row=>row.path==='artifacts/capture.ini').sha256,after.files.find(row=>row.path==='artifacts/capture.ini').sha256);
  assert.ok(after.files.some(row=>row.path==='artifacts/logs/b.log'));
  write('internal/panel/unsafe_test.go','package panel\nvar a="../../artifacts/../../outside"');
  assert.throws(()=>sourceRegressionManifest(root),/leaves workspace/);
 } finally {
  const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('voltra-source-inputs-'));
  fs.rmSync(resolved,{recursive:true,force:true});
 }
});

test('captures actual Go package directories without sweeping private or nested-module inputs',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'voltra-source-inputs-'));
 try {
  const write=(name,data)=>{fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),data);};
  write('tests/security-review/review_test.go','package review');
  write('tools/release/main.go','package main');
  write('artifacts/go-fixture/main_test.go','package fixture\nvar input="artifacts/package-fixture.txt"');
  write('artifacts/package-fixture.txt','native fixture');
  write('desktop/go.mod','module separate');write('desktop/main.go','package desktop');
  write('.local/private-env.json','secret');write('private.env','secret');write('main.go','package main');
  const inputs=sourceRegressionManifest(root,['tests/security-review','tools/release',path.join(root,'artifacts/go-fixture'),root]);
  for(const p of ['tests/security-review/review_test.go','tools/release/main.go','artifacts/go-fixture/main_test.go','artifacts/package-fixture.txt','main.go'])assert.ok(inputs.files.some(row=>row.path===p),p);
  assert.deepEqual(inputs.go_package_directories,['.','artifacts/go-fixture','tests/security-review','tools/release']);
  assert.ok(!inputs.files.some(row=>row.path.startsWith('desktop/')||row.path.startsWith('.local/')||row.path==='private.env'));
  write('artifacts/go-fixture/new_test.go','package fixture');
  assert.ok(sourceRegressionManifest(root,['artifacts/go-fixture']).files.some(row=>row.path==='artifacts/go-fixture/new_test.go'));
  assert.throws(()=>sourceRegressionManifest(root,['../outside']),/leaves workspace/);
  assert.throws(()=>sourceRegressionManifest(root,['.local']),/Excluded/);
  assert.throws(()=>sourceRegressionManifest(root,{package:'tools/release'}),/must be a list/);
 } finally {
  const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('voltra-source-inputs-'));
  fs.rmSync(resolved,{recursive:true,force:true});
 }
});
