import {test} from 'node:test';
import assert from 'node:assert/strict';
import {notifications} from '../src/notificationEvents.ts';

test('unchanged polling does not reopen dismissed conditions; changes and recovery do',()=>{
  notifications.clear();
  const id=notifications.publish({key:'server:1',message:'Node unavailable',tone:'error'});
  notifications.dismiss(id);
  assert.equal(notifications.publish({key:'server:1',message:'Node unavailable',tone:'error'}),id);
  assert.equal(notifications.getSnapshot().activeId,null);
  notifications.update(id,{message:'Node connection lost again'});
  assert.equal(notifications.getSnapshot().activeId,id);
  notifications.resolve('server:1');
  assert.equal(notifications.getSnapshot().activeId,null);
  assert.notEqual(notifications.publish({key:'server:1',message:'Node unavailable',tone:'error'}),id);
});

test('errors are next in queue and dismissal retains history',()=>{
  notifications.clear();
  const first=notifications.publish({message:'Starting',tone:'info'});
  const second=notifications.publish({message:'Saved',tone:'success'});
  const error=notifications.publish({message:'Save failed',tone:'error'});
  notifications.dismiss(first);
  assert.equal(notifications.getSnapshot().activeId,error);
  notifications.dismiss(error);
  assert.equal(notifications.getSnapshot().activeId,second);
  assert.equal(notifications.getSnapshot().events.length,3);
});

test('progress updates do not reset dismissal revision, and history is bounded',()=>{
  notifications.clear();
  const id=notifications.publish({key:'download',message:'Downloading',progress:0});
  notifications.update(id,{progress:0.5});
  assert.equal(notifications.getSnapshot().events[0].revision,0);
  for(let n=0;n<150;n++)notifications.publish({message:`Event ${n}`});
  assert.equal(notifications.getSnapshot().events.length,100);
  assert.ok(notifications.getSnapshot().events.filter(e=>!e.dismissed).length<=11);
  notifications.clear();
  assert.equal(notifications.getSnapshot().activeId,null);
});

test('empty messages produce no event and unsubscribe stops callbacks',()=>{
  notifications.clear();
  let calls=0;
  const off=notifications.subscribe(()=>calls++);
  assert.equal(notifications.publish({message:'  '}),0);
  assert.equal(calls,0);
  notifications.publish({message:'One'});
  off();
  notifications.clear();
  assert.equal(calls,1);
});
