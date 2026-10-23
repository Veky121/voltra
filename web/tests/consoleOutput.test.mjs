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
