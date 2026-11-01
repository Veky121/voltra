import test from 'node:test';
import assert from 'node:assert/strict';
import * as n from '../src/notifications/store.ts';

test.beforeEach(()=>n.resetNotificationSession());
test('records origin at action start, groups repeats, and caps history',()=>{
 const context=n.captureErrorContext('HTTP',{page:'/server/one/runtime?token=private',endpoint:'/api/client/servers/one/power?secret=private',method:'POST',status:502});
 n.reportPanelError(new Error('Node unavailable'),context);
 n.reportPanelError(new Error('Node unavailable'),context);
 const [entry]=n.notificationSnapshot();assert.equal(entry.count,2);assert.equal(entry.page,'/server/one/runtime');assert.equal(entry.endpoint,'/api/client/servers/one/power');
 assert.equal(entry.method,'POST');assert.equal(entry.status,502);
 for(let i=0;i<230;i++)n.reportPanelError('failure '+i,n.captureErrorContext('Browser'));
 assert.equal(n.notificationSnapshot().length,200);
});
test('aborts, rethrown errors and immediate local displays do not duplicate notifications',()=>{
 const context=n.captureErrorContext('HTTP',{page:'/server/one',endpoint:'/api/client/servers/one/power'}),error=new Error('Power failed');
 n.reportPanelError(new DOMException('Canceled','AbortError'),context);assert.equal(n.notificationSnapshot().length,0);
 n.reportPanelError(error,context);n.reportPanelError(error,context);
 n.reportPanelError('Power failed',n.captureErrorContext('client/ServerDashboard.tsx',{page:'/server/one'}));assert.equal(n.notificationSnapshot().length,1);
 assert.equal(n.notificationSnapshot()[0].count,1);
});
test('session boundaries discard late failures and erase old account history',()=>{
 n.setNotificationScope('user1');const old=n.captureErrorContext('HTTP');n.reportPanelError('Old error',old);
 n.setNotificationScope('user2');assert.equal(n.notificationSnapshot().length,0);
 n.reportPanelError('Late old request',old);assert.equal(n.notificationSnapshot().length,0);
 n.reportPanelError('New error',n.captureErrorContext('HTTP',{endpoint:'/api/test',method:'GET'}));assert.equal(n.notificationSnapshot().length,1);
 n.resolvePanelErrors('/api/test','GET',old.epoch);assert.equal(n.notificationSnapshot()[0].resolved,false);
 n.markNotificationsRead();assert.equal(n.notificationSnapshot()[0].read,true);
});
test('redacts credentials, URL queries and sensitive request errors in exported logs',()=>{
 n.reportPanelError('password="hunter secret" Bearer private-token https://user:pw@example.org/test?token=xyz api_key=secret-key',n.captureErrorContext('HTTP',{endpoint:'/api/test?token=xyz',page:'/account?password=abc'}));
 n.reportPanelError('The value TOP-SECRET is invalid',n.captureErrorContext('HTTP',{endpoint:'/api/client/servers/a/startup',status:422}));
 n.reportPanelError('The value TOP-SECRET is invalid',n.captureErrorContext('client/ServerStartup.tsx'));
 const log=n.exportNotificationLog();for(const secret of ['hunter secret','private-token','user:pw','xyz','secret-key','TOP-SECRET','password=abc'])assert.ok(!log.includes(secret),secret);
 assert.equal(n.safePath('/api/token/sensitive/foo'),'/api/token/[redacted]/foo');
});
test('recovery preserves history and a new failure can notify again',()=>{
 const events=[],stop=n.observeNotifications(event=>events.push(event.kind)),context=n.captureErrorContext('WebSocket',{endpoint:'/api/client/servers/a/resources',method:'GET'});
 n.reportPanelError('Down',context);n.reportPanelError('Down',context);n.resolvePanelErrors(context.endpoint);
 assert.equal(n.notificationSnapshot()[0].resolved,true);n.reportPanelError('Down',context);
 assert.deepEqual(events,['add','update','add']);assert.equal(n.notificationSnapshot().length,2);stop();
});

test('HTTP fallback notices remain in history without a toast',()=>{
 const events=[],stop=n.observeNotifications(event=>events.push(event.kind));
 n.reportPanelError('HTTP refresh remains available.',n.captureErrorContext('WebSocket',{endpoint:'/api/client/events',method:'GET',quiet:true}));
 assert.deepEqual(events,['update']);assert.equal(n.notificationSnapshot().length,1);
 n.resolvePanelErrors('/api/client/events');assert.equal(n.notificationSnapshot()[0].resolved,true);stop();
});


test('known safe recovery instructions replace sensitive response text without duplicate local notifications',()=>{
 const context=n.captureErrorContext('HTTP',{endpoint:'/api/admin/proxy-gateways/1/routes',method:'POST',status:409});
 n.reportPanelError(Object.assign(new Error('TOP-SECRET'),{code:'ProxyLocalPortReserved'}),context);
 n.reportPanelError('Full local explanation',n.captureErrorContext('client/ProxyEndpoints.tsx'));
 const [entry]=n.notificationSnapshot();
 assert.equal(n.notificationSnapshot().length,1);
 assert.equal(entry.code,'ProxyLocalPortReserved');
 assert.match(entry.message,/Choose a different assigned game port/);
 assert.ok(!n.exportNotificationLog().includes('TOP-SECRET'));
});

test('request references are validated, exported and updated on repeated failures',()=>{
 const context=n.captureErrorContext('HTTP',{endpoint:'/api/test',method:'POST'});
 const first='12345678-1234-1234-1234-123456789abc',second='12345678-1234-1234-1234-123456789def';
 n.reportPanelError(Object.assign(new Error('Failed'),{requestId:first}),context);
 assert.equal(n.notificationSnapshot()[0].requestId,first);
 n.reportPanelError(Object.assign(new Error('Failed'),{requestId:second}),context);
 assert.equal(n.notificationSnapshot()[0].requestId,second);
 assert.equal(n.notificationSnapshot()[0].count,2);
 n.reportPanelError(Object.assign(new Error('Other failure'),{requestId:'Bearer private-credential',code:'secret=value'}),context);
 assert.equal(n.notificationSnapshot()[0].requestId,undefined);
 assert.equal(n.notificationSnapshot()[0].code,undefined);
 assert.ok(!n.exportNotificationLog().includes('private-credential'));
});

test('unknown error codes never bypass sensitive endpoint redaction',()=>{
 n.reportPanelError(Object.assign(new Error('TOP-SECRET'),{code:'UnknownCode'}),n.captureErrorContext('HTTP',{endpoint:'/api/admin/proxy-gateways',status:500}));
 assert.match(n.notificationSnapshot()[0].message,/Check the originating page/);
 assert.ok(!n.exportNotificationLog().includes('TOP-SECRET'));
});


test('node failure codes retain distinct recovery advice on sensitive endpoints',()=>{
 const cases=[
  ['DaemonTimeoutException',/may still be running/],
  ['DaemonInterruptedException',/interrupted/],
  ['DaemonDNSException',/hostname.*administrator.*DNS/],
  ['DaemonConnectionException',/connect to the node.*administrator/],
 ];
 for(const [code,expected] of cases){
  n.reportPanelError(Object.assign(new Error('PRIVATE upstream body'),{code}),n.captureErrorContext('HTTP',{endpoint:'/api/client/servers/one/game-settings',method:'PUT'}));
  assert.match(n.notificationSnapshot()[0].message,expected);
  assert.equal(n.notificationSnapshot()[0].code,code);
 }
 assert.equal(n.notificationSnapshot().length,4);
 assert.ok(!n.exportNotificationLog().includes('PRIVATE'));
});

test('local error updates are fenced by page and session while history retains the origin',()=>{
 const previousWindow=globalThis.window;
 try{
  globalThis.window={location:{pathname:'/server/one'}};
  const origin=n.captureErrorContext('Local action');
  assert.equal(n.isErrorContextCurrent(origin),true);
  globalThis.window.location.pathname='/server/two';
  assert.equal(n.isErrorContextCurrent(origin),false);
  n.reportPanelError('Late result on original page',origin);
  assert.equal(n.notificationSnapshot()[0].page,'/server/one');
  globalThis.window.location.pathname='/server/one';
  n.resetNotificationSession();
  assert.equal(n.isErrorContextCurrent(origin),false);
  n.reportPanelError('Old account result',origin);
  assert.equal(n.notificationSnapshot().length,0);
 }finally{
  if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;
 }
});
