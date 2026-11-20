import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeFreshValues} from '../src/features/admin/freshValues.ts';

test('newer panel values fill untouched fields and never undo an edit', () => {
  const baseline = {name: 'Survival', description: 'Old', user: 3};
  const current = {name: 'Survival', description: 'Edited here', user: 3};
  const next = {name: 'Renamed elsewhere', description: 'Old', user: 4};
  assert.deepEqual(mergeFreshValues(current, baseline, next), {
    name: 'Renamed elsewhere',
    description: 'Edited here',
    user: 4,
  });
  // A field the user changed and the panel also changed keeps the user's value.
  assert.deepEqual(mergeFreshValues({name: 'Mine'}, {name: 'Old'}, {name: 'Theirs'}), {name: 'Mine'});
  // Structured values compare by content.
  assert.deepEqual(mergeFreshValues({ports: [1, 2]}, {ports: [1, 2]}, {ports: [3]}), {ports: [3]});
});
