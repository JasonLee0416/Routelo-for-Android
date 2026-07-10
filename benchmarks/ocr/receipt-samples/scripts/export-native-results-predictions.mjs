#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function argValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sourceArg = argValue('source');
const outputDirArg = argValue('output-dir');
if (!sourceArg || !outputDirArg) {
  console.error(
    'Usage: node scripts/export-native-results-predictions.mjs --source <native-results.json> --output-dir <dir>',
  );
  process.exit(2);
}

const sourcePath = resolve(root, sourceArg);
const outputDir = resolve(root, outputDirArg);
const native = JSON.parse(await readFile(sourcePath, 'utf8'));
await mkdir(outputDir, { recursive: true });

for (const result of native.results || []) {
  const stem = basename(result.file).replace(/\.[^.]+$/, '');
  await writeFile(join(outputDir, `${stem}.txt`), result.fullText || '', 'utf8');
}

await writeFile(
  join(outputDir, 'run-metadata.json'),
  JSON.stringify(
    {
      candidateName: native.engine || 'native-results',
      source: sourcePath,
      exportedAt: new Date().toISOString(),
      device: native.device,
      sampleCount: native.results?.length || 0,
      note: 'Generated from previously captured native OCR results without modifying OCR text.',
    },
    null,
    2,
  ),
  'utf8',
);

console.log(
  `Exported ${native.results?.length || 0} native OCR predictions to ${outputDir}`,
);
