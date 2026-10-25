import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash}from'node:crypto';
const d='.local/reforger-native/',native=fs.readFileSync(d+'packaged-terms/License.txt','utf8'),web=fs.readFileSync('.local/reforger-agreement/publisher.txt','utf8');
const headings=new Set(['general provisions','your rights','you may not','warranty, liabilities and termination','more information']);
function normalize(text){return text.replaceAll('\r\n','\n').split('\n').map(row=>{row=row.replace(/^\s*(?:-\s+|\[\*\])/,'').trim();return headings.has(row.toLowerCase())?row.toLowerCase():row;}).join(' ').replace(/\s+/g,' ').trim();}
assert.equal(normalize(native),normalize(web),'Unexpected publisher terms textual difference');console.log({format_normalized_exact:true,native_bytes:Buffer.byteLength(native),web_bytes:Buffer.byteLength(web),normalized_sha256:createHash('sha256').update(normalize(native)).digest('hex')});
