// 사전(가제티어) 출처(provenance) 커버리지 리포트 (#149).
// 각 레코드의 source 필드를 집계해 배포 안전/재수집 대상 비율을 보여준다.
// 사용: node scripts/venue-provenance-report.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = resolve(here, '../app/ocr/venue/metro-venues.json');

// 배포 안전으로 간주하는 출처(공공데이터·자체수집).
const SAFE_SOURCES = new Set(['localdata', 'public-mohw', 'self-collected']);

const venues = JSON.parse(readFileSync(dataPath, 'utf8'));

const bySource = new Map();
const byType = new Map();
let safe = 0;
let needsResource = 0; // map-suspect + unverified

for (const v of venues) {
  const source = v.source || 'unverified';
  bySource.set(source, (bySource.get(source) || 0) + 1);
  const type = v.type || 'unknown';
  byType.set(type, (byType.get(type) || 0) + 1);
  if (SAFE_SOURCES.has(source)) safe += 1;
  else needsResource += 1;
}

const pct = (n) => `${((n / venues.length) * 100).toFixed(1)}%`;

console.log(`\n[venue provenance report] total=${venues.length}`);
console.log('\n출처별:');
for (const [source, count] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
  const tag = SAFE_SOURCES.has(source) ? '배포안전' : '재수집대상';
  console.log(`  - ${source.padEnd(16)} ${String(count).padStart(4)}  ${pct(count).padStart(6)}  [${tag}]`);
}
console.log('\n종류별:');
for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  - ${type.padEnd(10)} ${String(count).padStart(4)}  ${pct(count)}`);
}
console.log(`\n요약: 배포안전 ${safe}(${pct(safe)}) · 재수집대상 ${needsResource}(${pct(needsResource)})`);
if (needsResource > 0) {
  console.log(
    '\n⚠️  재수집대상(map-suspect/unverified)이 남아 있습니다. #150 공공데이터 재구축으로 출처를 승격하세요.',
  );
}
