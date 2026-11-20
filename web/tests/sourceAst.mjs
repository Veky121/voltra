// Structural checks on TypeScript sources, for the few rules that are about the
// code's shape rather than its behaviour. Uses the TypeScript parser, so
// formatting, quoting and comments do not matter.
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const printer = ts.createPrinter({removeComments: true});

export function parse(url) {
  const file = url instanceof URL ? url : new URL(url);
  const text = readFileSync(file, 'utf8');
  return ts.createSourceFile(
    file.pathname,
    text,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(file.pathname) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

export function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, child => walk(child, visit));
}

// Every string the module spells out literally ('…', "…" or a template without substitutions).
export function stringLiterals(source) {
  const found = new Set();
  walk(source, node => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) found.add(node.text);
  });
  return found;
}

// A node printed in one canonical form, so `a( b,c )` and `a(b, c)` compare equal.
export function canonical(node, source) {
  return printer.printNode(ts.EmitHint.Unspecified, node, source).replace(/\s+/g, ' ').trim();
}

// Calls to `name(...)` with their arguments in canonical form.
export function calls(source, name) {
  const found = [];
  walk(source, node => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === name)
      found.push(node.arguments.map(arg => canonical(arg, source)));
  });
  return found;
}

// Values of `attribute={...}` on JSX elements named `element`.
export function jsxAttributes(source, element, attribute) {
  const found = [];
  walk(source, node => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source) === element
    ) {
      for (const prop of node.attributes.properties) {
        if (ts.isJsxAttribute(prop) && prop.name.getText(source) === attribute && prop.initializer) {
          const value = ts.isJsxExpression(prop.initializer) ? prop.initializer.expression : prop.initializer;
          found.push(value);
        }
      }
    }
  });
  return found;
}
