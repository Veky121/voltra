import fs from 'node:fs';
import path from 'node:path';
const directory=process.argv[2];
if(!directory)throw Error('Expected regression output directory');
const read=name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8').replace(/^\uFEFF/,''));
const before=read('source-before.json').flat(),after=read('source-after.json').flat();
for(const row of [...before,...after])if(typeof row.path!=='string'||typeof row.sha256!=='string')throw Error('Invalid source manifest row');
const previous=new Map(before.map(row=>[row.path,row.sha256]));
const current=new Map(after.map(row=>[row.path,row.sha256]));
if(previous.size!==before.length||current.size!==after.length)throw Error('Duplicate source manifest path');
const changed=before.filter(row=>current.get(row.path)!==row.sha256).map(row=>row.path);
const added=after.filter(row=>!previous.has(row.path)).map(row=>row.path);
let invalidLogLines=0;
const events=fs.readFileSync(path.join(directory,'go-test.jsonl'),'utf8').split(/\r?\n/).flatMap(line=>{
  if(!line.trim())return [];
  try{const event=JSON.parse(line);if(!event||typeof event!=='object'||Array.isArray(event)||typeof event.Action!=='string')throw Error('Invalid event');return [event];}
  catch{invalidLogLines++;return [];}
});
const counts=Object.fromEntries(['pass','fail','skip'].map(action=>[action,events.filter(event=>event.Test&&event.Action===action).length]));
const report=read('report.json');
report.source_inputs=before.length;
report.changed_inputs=changed;
report.added_inputs=added;
report.stable_inputs=!changed.length&&!added.length;
report.counts_including_subtests=counts;
report.invalid_log_lines=invalidLogLines;
report.skipped_tests=events.filter(event=>event.Test&&event.Action==='skip').map(event=>({package:event.Package,test:event.Test}));
report.package_results=events.filter(event=>!event.Test&&['pass','fail','skip'].includes(event.Action)).map(event=>({package:event.Package,status:event.Action,seconds:event.Elapsed}));
const completed=new Set(report.package_results.map(result=>result.package));
const incomplete=[...new Set(events.map(event=>event.Package).filter(Boolean))].filter(name=>!completed.has(name));
report.verification_failures=[
  ...(report.command?.exit_code===0?[]:['backend test command did not pass']),
  ...(report.driver_exit===0?[]:['regression driver did not pass']),
  ...(report.go_vet_exit===0?[]:['go vet did not pass']),
  ...(report.database_cleanup?.cleanup===true?[]:['fixture schema cleanup not verified']),
  ...(report.stable_inputs?[]:['source inputs changed during verification']),
  ...(counts.fail===0&&!report.package_results.some(result=>result.status==='fail')?[]:['test or package failures recorded']),
  ...(counts.pass>0&&report.package_results.length>0?[]:['test result log is empty or incomplete']),
  ...(invalidLogLines===0?[]:['test result log contains invalid events']),
  ...incomplete.map(name=>`package completion missing: ${name}`),
];
report.outcome=report.verification_failures.length?'source_regression_failed':'source_regression_passed';
fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({outcome:report.outcome,counts,source_inputs:before.length,stable_inputs:report.stable_inputs,changed,added,go_vet_exit:report.go_vet_exit,schema_cleanup:report.database_cleanup.cleanup}));
if(report.verification_failures.length)process.exitCode=1;
