import test from 'node:test';
import assert from 'node:assert/strict';
import {consoleOutput} from '../src/features/console/consoleOutput.ts';

test('brands Wings daemon events without duplicating existing labels', () => {
  assert.equal(consoleOutput('Starting installation', 'daemon message'), '[Voltra] Starting installation');
  assert.equal(consoleOutput('[Voltra Daemon] Ready', 'daemon message'), '[Voltra] Ready');
  assert.equal(consoleOutput('[Voltra] Ready', 'daemon message'), '[Voltra] Ready');
  assert.equal(consoleOutput('', 'daemon message'), '');
});

test('brands legacy prefixes in ANSI colored and multiline output', () => {
  assert.equal(
    consoleOutput('\x1b[33m[Pterodactyl Daemon]\x1b[0m Starting\r\n[Pterodactyl Daemon] Ready', 'console output'),
    '[Voltra] Starting\n[Voltra] Ready'
  );
});

test('preserves arbitrary server output and egg readiness markers', () => {
  const output = '[INFO] using [Pterodactyl Daemon] as a literal\nreceived:VOLTRA_READY\nDone (1.2s)!';
  assert.equal(consoleOutput(output, 'console output'), output);
  assert.equal(consoleOutput('Installing game files', 'install output'), 'Installing game files');
});

test('hides only standalone demo readiness signals from console output', () => {
  assert.equal(consoleOutput('VOLTRA_READY', 'console output'), '');
  assert.equal(consoleOutput('PTEROCLONE_READY', 'console output'), '');
  assert.equal(consoleOutput('Starting\r\n\x1b[32mVOLTRA_READY\x1b[0m\r\nDone', 'console output'), 'Starting\nDone');
  assert.equal(consoleOutput('VOLTRA_READY', 'install output'), 'VOLTRA_READY');
});

test('hides image prompt echoes but keeps prompts quoted inside game output', () => {
  assert.equal(consoleOutput('container@pterodactyl~ java -version', 'console output'), '');
  assert.equal(
    consoleOutput('\x1b[1m\x1b[33mcontainer@pterodactyl~ \x1b[0mjava -Xmx4G -jar server.jar', 'console output', true),
    ''
  );
  assert.equal(consoleOutput('container@voltra~ bash -c eval$IFS"$VOLTRA_JAVA_SCRIPT"', 'console output'), '');
  assert.equal(consoleOutput(':/home/container$ ./start.sh --password=secret', 'console output'), '');
  assert.equal(
    consoleOutput('Player says container@pterodactyl~', 'console output'),
    'Player says container@pterodactyl~'
  );
  assert.equal(
    consoleOutput('Booting\ncontainer@pterodactyl~ ./run\nLoaded world', 'console output'),
    'Booting\nLoaded world'
  );
  // Installer output is shown as the install script wrote it.
  assert.equal(
    consoleOutput('container@pterodactyl~ install.sh', 'install output'),
    'container@pterodactyl~ install.sh'
  );
});

test('hides every egg readiness marker but not lines that merely mention one', () => {
  for (const marker of [
    'VOLTRA_ARK_READY authenticated native ListPlayers response; gameplay not tested',
    'VOLTRA_L4D_MAP_READY',
    'VOLTRA_PALWORLD_RUNTIME_IMPORTS_READY',
    '  VOLTRA_VALHEIM_READY  ',
  ])
    assert.equal(consoleOutput(marker, 'console output'), '', marker);
  for (const line of [
    '[Server] VOLTRA_ARK_READY',
    'voltra_ark_ready',
    'VOLTRA_PARITY_MOD_READY_abc',
    'VOLTRA_READYING',
  ])
    assert.equal(consoleOutput(line, 'console output'), line, line);
});

test('hides panel capture housekeeping and keeps state changes and gap warnings', () => {
  const panel = (text, color = '94') => `\x1b[0m\x1b[${color}m[Voltra]: ${text}\x1b[0m`;
  assert.equal(
    consoleOutput(
      panel(
        'Console history capture connected. Saved history is retained; continuity during panel downtime cannot be verified.'
      ),
      'panel message',
      true
    ),
    ''
  );
  assert.equal(
    consoleOutput(panel('New run. Keeping up to 200 lines from the previous output.'), 'panel message', true),
    ''
  );
  for (const text of [
    'Server entered the running state.',
    'Current server state: running.',
    'Console history capture reconnected after approximately 5s (restart). Output during this capture gap may be missing.',
    'Stop requested.',
  ])
    assert.equal(consoleOutput(panel(text), 'panel message', true), panel(text));
  // The same words from a game are game output.
  assert.equal(
    consoleOutput('[Voltra]: New run. Keeping up to 200 lines from the previous output.', 'console output'),
    '[Voltra]: New run. Keeping up to 200 lines from the previous output.'
  );
});

test('keeps carriage-return log records and nonzero process exits visible', () => {
  const source = 'Downloading 10%\rDownloading 90%\r\n[Pterodactyl Daemon] Exit code: 137\rOut of memory: true';
  assert.equal(
    consoleOutput(source, 'console output'),
    'Downloading 10%\nDownloading 90%\n[Voltra] Exit code: 137\nOut of memory: true'
  );
  assert.equal(consoleOutput('VOLTRA_READY\rExit code: 1', 'console output'), 'Exit code: 1');
  assert.equal(consoleOutput('\x1b[31mError\rFatal\x1b[0m', 'console output', true), '\x1b[31mError\nFatal\x1b[0m');
});
