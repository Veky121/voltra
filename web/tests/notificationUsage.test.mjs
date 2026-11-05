import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

test('app messages cannot introduce inline alert banners or browser alerts',()=>{
  const root=fileURLToPath(new URL('../src/',import.meta.url));
  const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
  const violations=[];
  for(const file of walk(root).filter(file=>/\.tsx?$/.test(file))){
    if(file.endsWith('notifications.tsx')||file.endsWith(join('components','ui','alert.tsx')))continue;
    const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    function visit(node){
      if(ts.isJsxAttribute(node)&&node.name.getText(source)==='role'&&node.initializer&&ts.isStringLiteral(node.initializer)&&node.initializer.text==='alert')violations.push(file+': inline alert');
      if(ts.isCallExpression(node)&&['alert','window.alert'].includes(node.expression.getText(source)))violations.push(file+': browser alert');
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
  assert.deepEqual(violations,[]);
});
