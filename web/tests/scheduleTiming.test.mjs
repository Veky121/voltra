import test from 'node:test';
import assert from 'node:assert/strict';
import { clampInterval, simpleTimingCron, readSimpleTiming } from '../src/client/scheduleTimingModel.ts';

test('interval bounds clamp immediately, including a minute to hour unit change', () => {
  for (const unit of ['minute', 'hour']) {
    assert.equal(clampInterval(0, unit), 1);
    assert.equal(clampInterval(-10, unit), 1);
    assert.equal(clampInterval(NaN, unit), 1);
    assert.equal(clampInterval(2.9, unit), 2);
  }
  assert.equal(clampInterval(100, 'minute'), 60);
  assert.equal(clampInterval(60, 'hour'), 24);
  assert.equal(clampInterval(24, 'minute'), 24);
});
test('minute and hour boundaries generate valid cron fields', () => {
  const cron = (every, unit) => simpleTimingCron({every, unit, days:[1,3,5]});
  assert.deepEqual(cron(60, 'minute'), {minute:'0', hour:'*', day_of_month:'*', month:'*', day_of_week:'1,3,5'});
  assert.equal(cron(24, 'hour').hour, '0');
  assert.equal(cron(24, 'hour').minute, '0');
  assert.equal(cron(1, 'minute').minute, '*');
  assert.equal(cron(1, 'hour').minute, '0');
  assert.equal(cron(15, 'minute').minute, '*/15');
  assert.equal(cron(6, 'hour').hour, '*/6');
});
test('every supported simple interval round trips without changing its schedule', () => {
  for (const unit of ['minute','hour']) for (let every=1; every <= (unit === 'minute' ? 60 : 24); every++) {
    const cron = simpleTimingCron({every,unit,days:[0,2,4]});
    assert.deepEqual(simpleTimingCron(readSimpleTiming(cron)), cron);
  }
});
test('custom cron stays advanced and does not lose month, day, or fixed time rules', () => {
  const base = {minute:'0',hour:'*',day_of_month:'*',month:'*',day_of_week:'*'};
  for (const changes of [{hour:'5,9,15'}, {month:'6'}, {day_of_month:'15'}, {day_of_week:'1-5'}, {hour:'*/24'}, {minute:'*/60'}]) {
    assert.equal(readSimpleTiming({...base,...changes}), null);
  }
  assert.deepEqual(readSimpleTiming({...base,day_of_week:''}).days, []);
  assert.equal(simpleTimingCron({every:1,unit:'hour',days:[0,1,2,3,4,5,6]}).day_of_week, '*');
});

test('four hours starting at 05:30 crosses midnight and preserves the chosen anchor',()=>{
  const timing={every:4,unit:'hour',days:[1,2,3,4,5,6,0],startTime:'05:30'};
  const cron=simpleTimingCron(timing);
  assert.equal(cron.minute,'30');
  assert.equal(cron.hour,'5,9,13,17,21,1');
  assert.deepEqual(readSimpleTiming(cron),timing);
});

test('24 hours means once per selected day at the chosen clock time',()=>{
  const timing={every:24,unit:'hour',days:[1,3,5],startTime:'05:15'};
  const cron=simpleTimingCron(timing);
  assert.deepEqual(cron,{minute:'15',hour:'5',day_of_month:'*',month:'*',day_of_week:'1,3,5'});
  assert.deepEqual(readSimpleTiming(cron),timing);
});

test('all hourly intervals and anchors survive save and reopen without schedule drift',()=>{
  for(let every=1;every<=24;every++)for(let hour=0;hour<24;hour++)for(const minute of ['00','35']){
    const timing={every,unit:'hour',days:[0,2,4],startTime:`${String(hour).padStart(2,'0')}:${minute}`};
    const cron=simpleTimingCron(timing);
    const parsed=readSimpleTiming(cron);
    assert.ok(parsed,JSON.stringify(cron));
    assert.equal(parsed.every,every);
    assert.equal(parsed.startTime,timing.startTime);
    assert.deepEqual(simpleTimingCron(parsed),cron);
  }
});
