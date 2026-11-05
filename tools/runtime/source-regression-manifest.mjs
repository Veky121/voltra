import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

export function sourceRegressionManifest(root, goPackageDirectories = []) {
  root=path.resolve(root);
  const files=new Set(), artifactReferences=new Set(), missingArtifactReferences=[];
  const relative=p=>path.relative(root,p).split(path.sep).join('/');
  function collect(target) {
    const absolute=path.resolve(root,target), rel=relative(absolute);
    if(rel==='..'||rel.startsWith('../')||path.isAbsolute(rel))throw Error('Source input leaves workspace');
    if(!fs.existsSync(absolute))return false;
    const stat=fs.lstatSync(absolute);
    if(stat.isSymbolicLink())throw Error(`Source input is a symlink: ${rel}`);
    if(stat.isDirectory())for(const name of fs.readdirSync(absolute).sort())collect(path.join(rel,name));
    else if(stat.isFile())files.add(rel);
    return true;
  }
  for(const dir of ['internal','cmd','tests','tools/runtime','tools/release','tools/file-manager-server','web/src','web/public','web/tests'])collect(dir);
  for(const name of ['go.mod','go.sum','web/components.json','web/index.html','web/package.json','web/package-lock.json','web/tsconfig.json','web/vite.config.ts','web/vite.file-manager-test.config.ts'])collect(name);
  if(!Array.isArray(goPackageDirectories))throw Error('Go package directories must be a list');
  const packageDirectories=[];
  for(const directory of goPackageDirectories) {
    if(typeof directory!=='string'||!directory)throw Error('Invalid Go package directory');
    const absolute=path.resolve(root,directory),rel=relative(absolute);
    if(rel==='..'||rel.startsWith('../')||path.isAbsolute(rel))throw Error('Go package directory leaves workspace');
    if(rel.split('/').some(part=>part.startsWith('.')||part.startsWith('_')||['node_modules','vendor'].includes(part)))throw Error('Excluded Go package directory');
    if(!fs.existsSync(absolute)||!fs.lstatSync(absolute).isDirectory())throw Error('Missing Go package directory');
    packageDirectories.push(rel||'.');
    // A root package must not pull private environment or build folders into
    // the manifest. Its resources still use the explicit roots/fixture scan.
    if(!rel) {
      for(const name of fs.readdirSync(root))if(/\.(go|s|c|h|syso)$/.test(name))collect(name);
    }else collect(rel);
  }
  // Literal fixture paths include directory prefixes used by ReadDir and by
  // ReadFile(prefix + entry.Name()). Include whole referenced directories.
  for(const name of [...files].filter(name=>name.endsWith('_test.go'))) {
    const source=fs.readFileSync(path.join(root,name),'utf8');
    for(const match of source.matchAll(/"((?:\\.|[^"\\])*)"|`([^`]+)`/g)) {
      let value;
      try {value=match[2]??JSON.parse('"'+match[1]+'"');}catch{continue;}
      if(!/^(?:\.\.\/)*artifacts\//.test(value))continue;
      const fixture=value.replace(/^(?:\.\.\/)+/,'');
      artifactReferences.add(fixture);
    }
  }
  for(const fixture of [...artifactReferences].sort())if(!collect(fixture))missingArtifactReferences.push(fixture);
  return {files:[...files].sort().map(name=>({path:name,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')})),go_package_directories:[...new Set(packageDirectories)].sort(),artifact_references:[...artifactReferences].sort(),missing_artifact_references:missingArtifactReferences,scope:'Known application/test roots, supplied go list package directories, and literal artifact file/directory references in Go tests. Nested modules are included only when supplied. Dynamic fixture paths and root-package resources outside these scopes require separate review.'};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const output=process.argv[2];
  if(!output||fs.existsSync(output))throw Error('Provide a new manifest output path');
  const packages=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8').replace(/^\uFEFF/,'')):[];
  const result=sourceRegressionManifest(process.cwd(),packages);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(result.files,null,2)+'\n');
  fs.writeFileSync(output+'.scope.json',JSON.stringify({...result,files:undefined},null,2)+'\n');
  console.log(JSON.stringify({inputs:result.files.length,artifact_references:result.artifact_references.length,missing_artifact_references:result.missing_artifact_references.length,output}));
}
