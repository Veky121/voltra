import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionAddress, connectionDNS} from '../src/client/connectionAddress.ts';

test('gateway DNS uses the public port, not the container port or display alias', () => {
  assert.equal(connectionDNS({port:25567,ip_alias:'minecraft'}, [{public_host:'njimgang.org',public_port:1024}]), 'njimgang.org:1024');
  assert.equal(connectionDNS({port:8777,ip_alias:'Soulmask [Main]'}, [{public_host:'njimgang.org',public_port:8777}]), 'njimgang.org:8777');
});
test('managed join name takes precedence over gateway DNS', () => {
  assert.equal(connectionDNS({port:25567}, [{public_host:'njimgang.org',public_port:1024}], {hostname:'play.atm.njimgang.org',route:{public_port:1024}}), 'play.atm.njimgang.org:1024');
});
test('display aliases and IPs are not presented as DNS names', () => {
  for(const ip_alias of ['Soulmask [Main]','minecraft','162.19.244.229','::1','https://njimgang.org','njimgang.org:8777']) {
    assert.equal(connectionDNS({port:8777,ip_alias}, []), null);
  }
  assert.equal(connectionDNS({port:8777,ip_alias:'play.example.org'}, []), 'play.example.org:8777');
  assert.equal(connectionDNS({port:8777,ip_alias:'play.example.org'}, [{public_host:'162.19.244.229',public_port:9000}]), null);
});
test('connection formatting preserves IPv6 brackets', () => {
  assert.equal(connectionAddress('2001:db8::1',8777),'[2001:db8::1]:8777');
  assert.equal(connectionAddress('[2001:db8::1]',8777),'[2001:db8::1]:8777');
});
