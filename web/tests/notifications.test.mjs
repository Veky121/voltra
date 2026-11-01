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
