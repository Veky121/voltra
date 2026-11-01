import test from 'node:test';
import assert from 'node:assert/strict';
import {formatUptime} from '../src/client/uptime.ts';

test('uptime omits leading zero units and retains units after the first hour',()=>{
 for(const [ms,expected] of [[0,'0s'],[999,'0s'],[30000,'30s'],[60000,'1m 0s'],[1810000,'30m 10s'],[3600000,'1h 0m 0s'],[3661000,'1h 1m 1s'],[90000000,'25h 0m 0s'],[-1,'0s'],[NaN,'0s']])assert.equal(formatUptime(ms),expected);
});
