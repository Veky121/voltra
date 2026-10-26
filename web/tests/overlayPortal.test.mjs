import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/ui/OverlayPortal.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}).outputText;
const module = {exports: {}};
new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
const {OverlayPortalContext, useOverlayPortalContainer} = module.exports;

function resolve(container) {
  let result;
  function Consumer() { result = useOverlayPortalContainer(); return null; }
  renderToStaticMarkup(React.createElement(OverlayPortalContext.Provider, {value: container}, React.createElement(Consumer)));
  return result;
}

test('ordinary pages use the default portal instead of waiting for a null container', () => {
  assert.equal(resolve(null), undefined);
});

test('dialog popups retain the exact owning element as their portal container', () => {
  const dialog = {nodeType: 1, tagName: 'DIALOG'};
  assert.equal(resolve(dialog), dialog);
});
