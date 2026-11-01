import test from 'node:test';
import assert from 'node:assert/strict';
import {consoleOutput} from '../src/client/consoleOutput.ts';

test('brands Wings daemon events without duplicating existing labels', () => {
  assert.equal(consoleOutput('Starting installation', 'daemon message'), '[Voltra] Starting installation');
  assert.equal(consoleOutput('[Voltra Daemon] Ready', 'daemon message'), '[Voltra] Ready');
  assert.equal(consoleOutput('[Voltra] Ready', 'daemon message'), '[Voltra] Ready');
  assert.equal(consoleOutput('', 'daemon message'), '');
});

test('brands legacy prefixes in ANSI colored and multiline output', () => {
  assert.equal(consoleOutput('\x1b[33m[Pterodactyl Daemon]\x1b[0m Starting\r\n[Pterodactyl Daemon] Ready', 'console output'), '[Voltra] Starting\n[Voltra] Ready');
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


test('brands only the leading container prompt and keeps the command intact', () => {
  assert.equal(consoleOutput('container@pterodactyl~ java -version', 'console output'), 'container@voltra~ java -version');
  assert.equal(consoleOutput('container@pterodactyl~ bash -c eval$IFS"$VOLTRA_JAVA_SCRIPT"', 'console output'), 'container@voltra~ bash -c eval$IFS"$VOLTRA_JAVA_SCRIPT"');
  assert.equal(consoleOutput('Player says container@pterodactyl~', 'console output'), 'Player says container@pterodactyl~');
});

test('keeps carriage-return log records and nonzero process exits visible', () => {
  const source = 'Downloading 10%\rDownloading 90%\r\n[Pterodactyl Daemon] Exit code: 137\rOut of memory: true';
  assert.equal(consoleOutput(source, 'console output'),
    'Downloading 10%\nDownloading 90%\n[Voltra] Exit code: 137\nOut of memory: true');
  assert.equal(consoleOutput('VOLTRA_READY\rExit code: 1', 'console output'), 'Exit code: 1');
  assert.equal(consoleOutput('\x1b[31mError\rFatal\x1b[0m', 'console output', true), '\x1b[31mError\nFatal\x1b[0m');
});
