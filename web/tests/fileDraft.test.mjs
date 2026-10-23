import test from 'node:test';
import assert from 'node:assert/strict';
import {commitDraft,discardDraft,isDraftDirty,loadedDraft} from '../src/client/fileDraft.ts';

test('a newly opened file has no pending changes',()=>{
  assert.equal(isDraftDirty(loadedDraft('/config.yml','enabled: true\n')),false);
});
test('undoing to the saved text removes the unsaved state',()=>{
  const opened=loadedDraft('/config.yml','enabled: true\n');
  const edited={...opened,content:'enabled: false\n'};
  assert.equal(isDraftDirty(edited),true);
  assert.equal(isDraftDirty({...edited,content:opened.content}),false);
});
test('discard restores the last saved contents and resets editor history',()=>{
  const edited={...loadedDraft('/config.yml','enabled: true\n'),content:'enabled: false\n'};
  const discarded=discardDraft(edited);
  assert.equal(discarded.content,'enabled: true\n');
  assert.equal(isDraftDirty(discarded),false);
  assert.ok(discarded.revision>edited.revision);
});
test('a completed save keeps any edits made while it was in flight',()=>{
  const inFlight={...loadedDraft('/config.yml','first'),content:'second'};
  const newer={...inFlight,content:'third'};
  const saved=commitDraft(newer,'/config.yml',inFlight.content);
  assert.equal(saved.content,'third');
  assert.equal(saved.saved,'second');
  assert.equal(isDraftDirty(saved),true);
  assert.equal(discardDraft(saved).content,'second');
});
test('a save response from another file cannot overwrite the current draft',()=>{
  const current={...loadedDraft('/other.yml','original'),content:'changed'};
  assert.equal(commitDraft(current,'/config.yml','saved'),current);
});
test('saved contents become the new discard target',()=>{
  const edited={...loadedDraft('/config.yml','original'),content:'saved'};
  const saved=commitDraft(edited,'/config.yml','saved');
  assert.equal(isDraftDirty(saved),false);
  assert.equal(discardDraft({...saved,content:'new draft'}).content,'saved');
});
