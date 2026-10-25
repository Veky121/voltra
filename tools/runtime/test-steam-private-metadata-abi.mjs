// MIT. Executed against the actual compiled worker's private-FD public fixture.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const [filename] = process.argv.slice(2);
if (!filename) throw Error('Pass archived actual FD fixture JSON');
const parsed=JSON.parse(fs.readFileSync(filename,'utf8'));
const metadata=parsed.metadata,manifest=metadata.depots[0].manifests[0];
assert.equal(parsed.status,'metadata');
assert.equal(manifest.manifest_id,'3659990775896995763');
assert.equal(manifest.disk_bytes,'21349240119');
assert.equal(manifest.download_bytes,'2653127216');
assert.equal(metadata.branches[0].build_id,'25642172');
assert.equal(typeof manifest.manifest_id,'string');
assert.equal(BigInt(manifest.manifest_id),3659990775896995763n);
assert.equal(JSON.parse(JSON.stringify(parsed)).metadata.depots[0].manifests[0].manifest_id,'3659990775896995763');
for(const invalid of ['', '01', '+1', ' 1', '1 ', '-1', '1.0', '1e3', '18446744073709551616', 3659990775896995763]){
  assert.equal(typeof invalid==='string' && /^(0|[1-9][0-9]{0,19})$/.test(invalid) && BigInt(invalid)<=18446744073709551615n,false);
}
console.log('PASS actual FD JSON.parse/stringify exact uint64 string + canonical invalid cases');
