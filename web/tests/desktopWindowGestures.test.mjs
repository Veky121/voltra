import test from 'node:test';
import assert from 'node:assert/strict';
import {desktopResizeBorder, desktopResizeEdge, installDesktopWindowGestures} from '../src/desktopWindowGestures.ts';

function fixture() {
  const listeners = new Map(), css = new Map(), messages = [];
  let maximized = false, maximizeCalls = 0;
  const document = new EventTarget();
  document.documentElement = {dataset:{},style:{setProperty:(k,v)=>css.set(k,v),removeProperty:k=>css.delete(k)}};
  const target = {document,innerWidth:1000,innerHeight:700,
    getComputedStyle:element=>({getPropertyValue:()=>element.draggable?'drag':'no-drag'}),
    addEventListener:(name,fn)=>{listeners.set(name,fn);},removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);},
  };
  const cleanup = installDesktopWindowGestures(target,message=>messages.push(message),()=>!maximized,()=>{maximizeCalls++;});
  const fire = (type, values={}) => {
    const event = {type,clientX:500,clientY:300,button:0,buttons:0,target:{nodeType:1},preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=true;},...values};
    listeners.get(type)?.(event);return event;
  };
  return {fire,document,css,messages,listeners,cleanup,setMaximized:value=>{maximized=value;},maximized:()=>maximizeCalls};
}

test('8px edge regions include the seventh pixel, reject content and outside coordinates', () => {
  assert.equal(desktopResizeBorder,8);
  for(const [x,y,edge] of [[7,300,'w'],[992,300,'e'],[500,7,'n'],[500,692,'s'],[8,300,''],[991,300,''],[500,8,''],[500,691,''],[-1,20,''],[1000,20,''],[20,-1,''],[20,700,''],[10,10,'']]) {
    assert.equal(desktopResizeEdge(x,y,1000,700),edge,`${x},${y}`);
  }
});

test('larger corner targets return all four diagonal directions without stealing inner content', () => {
  for(const [x,y,edge] of [[17,3,'nw'],[3,17,'nw'],[983,3,'ne'],[996,17,'ne'],[3,683,'sw'],[17,696,'sw'],[996,683,'se'],[983,696,'se'],[18,3,'n'],[3,18,'w']]) {
    assert.equal(desktopResizeEdge(x,y,1000,700),edge);
  }
});

test('edge hover sets the matching cursor and leaving restores underlying element cursors', () => {
  const f=fixture();
  for(const [x,y,edge,cursor] of [[4,300,'w','ew-resize'],[500,4,'n','ns-resize'],[4,4,'nw','nwse-resize'],[996,4,'ne','nesw-resize']]) {
    f.fire('mousemove',{clientX:x,clientY:y});
    assert.equal(f.document.documentElement.dataset.desktopResizeEdge,edge);
    assert.equal(f.css.get('--desktop-resize-cursor'),cursor);
  }
  f.fire('mousemove');assert.equal(f.document.documentElement.dataset.desktopResizeEdge,undefined);assert.equal(f.css.size,0);
  f.fire('mousemove',{clientX:4});f.fire('mouseout',{relatedTarget:null});assert.equal(f.css.size,0);
  f.cleanup();
});

test('resize starts on the first movement, dispatches once, and suppresses underlying clicks', () => {
  const f=fixture();
  assert.equal(f.fire('mousedown',{clientX:7,buttons:1}).prevented,true);
  f.fire('mousemove',{clientX:6,buttons:1});f.fire('mousemove',{clientX:5,buttons:1});
  assert.deepEqual(f.messages,['wails:resize:w-resize']);
  f.fire('mouseup');assert.equal(f.fire('click').prevented,true);assert.equal(f.fire('click').prevented,undefined);
  f.cleanup();
});

test('all eight directions use native Wails resize messages', () => {
  for(const [x,y,edge] of [[500,2,'n'],[500,698,'s'],[2,300,'w'],[998,300,'e'],[2,2,'nw'],[998,2,'ne'],[2,698,'sw'],[998,698,'se']]) {
    const f=fixture();f.fire('mousedown',{clientX:x,clientY:y,buttons:1});f.fire('mousemove',{clientX:x,clientY:y,buttons:1});
    assert.deepEqual(f.messages,[`wails:resize:${edge}-resize`]);f.cleanup();
  }
});

test('holding a button before entering, right clicks, and ordinary content never arm resize', () => {
  const f=fixture();
  f.fire('mousemove',{clientX:4,buttons:1});f.fire('mousedown',{clientX:4,button:2,buttons:2});f.fire('mousemove',{clientX:3,buttons:2});
  f.fire('mousedown',{buttons:1});f.fire('mousemove',{clientX:504,buttons:1});
  assert.deepEqual(f.messages,[]);f.cleanup();
});

test('maximized and fullscreen windows neither show resize cursors nor dispatch resize', () => {
  const f=fixture();f.setMaximized(true);
  f.fire('mousemove',{clientX:4});f.fire('mousedown',{clientX:4,buttons:1});f.fire('mousemove',{clientX:3,buttons:1});
  assert.equal(f.css.size,0);assert.deepEqual(f.messages,[]);
  f.setMaximized(false);f.fire('mousedown',{clientX:4,buttons:1});f.setMaximized(true);f.fire('mousemove',{clientX:3,buttons:1});assert.deepEqual(f.messages,[]);
  f.setMaximized(false);f.document.fullscreenElement={};f.fire('mousemove',{clientX:4});assert.equal(f.css.size,0);f.cleanup();
});

test('titlebar drag threshold and double click remain intact, controls stay non-draggable', () => {
  const f=fixture(),title={nodeType:1,draggable:true};
  f.fire('mousedown',{target:title,buttons:1});f.fire('mousemove',{target:title,clientX:501,buttons:1});assert.deepEqual(f.messages,[]);
  f.fire('mousemove',{target:title,clientX:504,buttons:1});assert.deepEqual(f.messages,['wails:drag']);
  f.fire('dblclick',{target:title});assert.equal(f.maximized(),1);
  f.fire('dblclick',{target:title,clientX:4});f.fire('dblclick');assert.equal(f.maximized(),1);f.cleanup();
});

test('blur, resize, fullscreen changes and teardown clear cursors and armed gestures', () => {
  for(const event of ['blur','resize','fullscreenchange']) {
    const f=fixture();f.fire('mousedown',{clientX:4,buttons:1});
    if(event==='fullscreenchange')f.document.dispatchEvent(new Event(event));else f.fire(event);
    f.fire('mousemove',{clientX:3,buttons:1});assert.deepEqual(f.messages,[]);f.cleanup();assert.equal(f.css.size,0);assert.equal(f.listeners.size,0);
  }
});
