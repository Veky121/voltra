// Runs one whole TypeScript module with its imports replaced, so a test can
// drive the module's real code against stand-ins. Tests reach what they need
// through the module's exports, never by cutting its source text apart, so
// formatting, comments and the order of declarations do not matter.
//
//   const {useThing} = loadModule(new URL('../src/thing.tsx', import.meta.url),
//     {react: fakeReact, '../lib': {api}}, {setTimeout: fakeTimer});
//
// `modules` maps import specifiers, exactly as the module writes them, to the
// values it receives. Other relative imports receive an empty module; packages
// are loaded for real. `globals` shadows browser or timer globals for this
// module only.
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const compiled = new Map();

function compile(file) {
  const key = file.href;
  if (!compiled.has(key)) {
    const source = readFileSync(file, 'utf8');
    const options = {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022};
    compiled.set(key, ts.transpileModule(source, {fileName: file.pathname, compilerOptions: options}).outputText);
  }
  return compiled.get(key);
}

export function loadModule(url, modules = {}, globals = {}) {
  const file = url instanceof URL ? url : new URL(url);
  const module = {exports: {}};
  const resolve = name => (Object.hasOwn(modules, name) ? modules[name] : name.startsWith('.') ? {} : require(name));
  const names = Object.keys(globals);
  new Function('require', 'module', 'exports', ...names, compile(file))(
    resolve,
    module,
    module.exports,
    ...names.map(name => globals[name])
  );
  return module.exports;
}
