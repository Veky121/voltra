import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

// Bundle the real form's conversion functions in memory, without rendering or dist output.
const result = await build({entryPoints:[fileURLToPath(new URL('../src/client/JavaSettings.tsx', import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',loader:{'.css':'empty'}});
const {draftFrom,toMiB} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

test('Java heap editing and save preserve existing integer MiB and automatic heap', () => {
  for (const value of [1,256,1025,8192,65535]) {
    const draft = draftFrom({xms_mib:value,xmx_mib:value});
    assert.equal(toMiB(draft.xms),value);
    assert.equal(toMiB(draft.xmx),value);
    assert.equal(draft.automatic,false);
  }
  const automatic = draftFrom({xms_mib:256,xmx_mib:0});
  assert.equal(automatic.automatic,true);
  assert.equal(automatic.automatic ? 0 : toMiB(automatic.xmx),0);
});

test('Java heap accepts decimal GB, rounds to MiB and rejects invalid input', () => {
  assert.equal(toMiB('8'),8192);
  assert.equal(toMiB('1.2345'),1264);
  for (const value of ['', ' ', 'NaN', 'Infinity', '-1', '0', '1e300']) assert.throws(()=>toMiB(value));
});

const minecraftResult = await build({entryPoints:[fileURLToPath(new URL('../src/client/MinecraftLibrary.ts', import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',loader:{'.css':'empty'}});
const {gibToMiB} = await import(`data:text/javascript;base64,${Buffer.from(minecraftResult.outputFiles[0].text).toString('base64')}`);
test('Minecraft memory and heap conversion rounds decimals and rejects negative or invalid GB', () => {
  assert.equal(gibToMiB('8'),8192);
  assert.equal(gibToMiB('1.2345'),1264);
  for (const value of ['', ' ', 'NaN', 'Infinity', '-0.0001', '-1', '1e300']) assert.equal(gibToMiB(value),null);
  // Zero remains available to the automatic-heap API contract; form bounds reject it for explicit heaps.
  assert.equal(gibToMiB('0'),0);
});

