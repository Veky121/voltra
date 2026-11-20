import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import * as layout from '../src/features/server-settings/gameSettingsLayout.ts';
import * as copy from '../src/features/server-settings/gameSettingCopy.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/features/server-settings/GameSettingsFields.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX},
}).outputText;
const module = {exports: {}};
const mocks = {
  '../../ui/Settings': {
    SettingsSection: ({title, children}) => React.createElement('section', null, title, children),
    SettingsRow: ({label, description, info, control}) =>
      React.createElement('div', null, label, description, info, control),
  },
  './gameSettingCopy': copy,
  '../../ui/ActionButton': {ActionButton: 'button'},
  '../../lib': {Input: 'input', Select: 'select', Textarea: 'textarea'},
  '../shared/GameSwitch': {
    GameSwitch: ({checked, onCheckedChange, ...props}) =>
      React.createElement('button', {...props, role: 'switch', 'aria-checked': checked}),
  },
  './gameSettingsLayout': layout,
};
new Function('require', 'module', 'exports', compiled)(name => mocks[name] ?? require(name), module, module.exports);
const render = (fields, props = {}) =>
  renderToStaticMarkup(
    React.createElement(module.exports.GameSettingsFields, {
      fields,
      game: 'palworld',
      file: '/PalWorldSettings.ini',
      search: '',
      draft: {},
      onChange() {},
      ...props,
    })
  );

test('shared game editor renders individual typed controls and conceals configured secrets', () => {
  const html = render([
    {key: 'ExpRate', label: 'ExpRate', type: 'number', value: '1.0'},
    {key: 'bEnableFastTravel', label: 'bEnableFastTravel', type: 'boolean', value: true},
    {key: 'ServerPassword', label: 'ServerPassword', type: 'text', secret: true, configured: true, value: null},
    {key: 'PublicPort', label: 'PublicPort', type: 'number', readonly: true, value: '8211'},
    {key: 'FutureSetting', label: 'FutureSetting', type: 'text', value: 'keep'},
  ]);
  assert.match(html, /Experience multiplier/);
  assert.match(html, /type="number"/);
  assert.match(html, /role="switch" aria-checked="true"/);
  assert.match(html, /type="password"[^>]*value=""/);
  assert.match(html, /placeholder="Configured"/);
  assert.match(html, /disabled=""[^>]*type="number"/);
  assert.match(html, /Other settings/);
});

test('search finds property keys and labels; drafts stay connected to their original keys', () => {
  const fields = [
    {key: 'ExpRate', label: 'ExpRate', type: 'number', value: '1.0'},
    {key: 'ServerName', label: 'ServerName', type: 'text', value: 'old'},
  ];
  const html = render(fields, {search: 'experience', draft: {ExpRate: '2.5'}});
  assert.match(html, /value="2.5"/);
  assert.doesNotMatch(html, /Server name/);
  assert.match(render(fields, {search: 'missing'}), /No matching settings/);
  assert.match(render(fields, {game: 'minecraft', file: '/server.properties', search: 'ServerName'}), /Server name/);
});

test('rows show a plain label and sentence, with the saved name and rules under Details', () => {
  const html = render(
    [
      {key: 'view-distance', label: 'view-distance', type: 'number', min: 2, max: 32, value: 10},
      {key: 'level-seed', label: 'level-seed', type: 'text', value: ''},
    ],
    {game: 'minecraft', file: '/server.properties'}
  );
  assert.match(html, /<label[^>]*>View distance<\/label>/);
  assert.match(html, /How far players can see\./);
  assert.match(html, /<li>Allowed: 2 to 32\.<\/li>/);
  assert.match(html, /<li>Game default: 10\.<\/li>/);
  assert.match(html, /<li>Saved as view-distance\.<\/li>/);
  assert.doesNotMatch(html, /<code/);
});

test('search also finds a setting by what it does', () => {
  const fields = [
    {key: 'view-distance', label: 'view-distance', type: 'number', value: 10},
    {key: 'motd', label: 'motd', type: 'text', value: ''},
  ];
  const html = render(fields, {game: 'minecraft', file: '/server.properties', search: 'multiplayer list'});
  assert.match(html, /Server message/);
  assert.doesNotMatch(html, /View distance/);
});
