import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const base = process.env.PANEL_URL ?? 'http://127.0.0.1:8088';
const results = [];
for (const path of ['/api/client', '/api/application/servers', '/api/client/servers/73275a86/resources']) {
  for (let i = 0; i < 10; i++) {
    const response = await fetch(base + path);
    if (!response.ok) throw new Error(`Warmup ${path}: ${response.status}`);
    await response.arrayBuffer();
  }
  const durations = [];
  let index = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (index++ < 200) {
      const started = performance.now();
      const response = await fetch(base + path);
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      await response.arrayBuffer();
      durations.push(performance.now() - started);
    }
  }));
  durations.sort((a, b) => a - b);
  const percentile = p => Math.round(durations[Math.ceil(p * durations.length) - 1] * 100) / 100;
  results.push({ path, requests: durations.length, concurrency: 8, p50_ms: percentile(.5), p95_ms: percentile(.95), p99_ms: percentile(.99) });
}
const report = { tested_at: new Date().toISOString(), scope: 'Warm local HTTP reads, full response bodies; shared development machine with other tests running. Not a production capacity test or a PHP comparison.', results };
await writeFile('artifacts/runtime-latency.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
