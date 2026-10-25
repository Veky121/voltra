import assert from 'node:assert/strict';
import test from 'node:test';
import {embeddedPython} from './embedded-python.mjs';

test('extracts plain and quoted installer paths without interpreting shell variables', () => {
  const source = "cat > .voltra/a.py <<'A'\nprint('a')\nA\ncat > \"$stage/factorio-install.py\" <<'B'\nprint('b')\nB\ncat > 'path with spaces/c.py' <<'C'\nprint('c')\nC\n";
  assert.deepEqual(embeddedPython(source), [{file:'.voltra/a.py',source:"print('a')"},{file:'$stage/factorio-install.py',source:"print('b')"},{file:'path with spaces/c.py',source:"print('c')"}]);
});
test('supports CRLF and matches the actual heredoc delimiter', () => {
  assert.deepEqual(embeddedPython("cat > x.py <<'END'\r\nOTHER\r\nEND\r\n"), [{file:'x.py',source:'OTHER'}]);
  assert.deepEqual(embeddedPython("cat > x.py <<'END'\npass\nWRONG\n"), []);
});
