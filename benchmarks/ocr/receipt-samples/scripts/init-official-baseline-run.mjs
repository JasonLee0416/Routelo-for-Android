#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function argValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const candidateName = argValue('candidate-name');
if (!candidateName || !/^[a-z0-9._-]+$/i.test(candidateName)) {
  console.error(
    'Usage: node scripts/init-official-baseline-run.mjs --candidate-name <name>',
  );
  process.exit(1);
}

const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const outputRoot = join(root, '..', '..', '..', 'tmp', 'ocr-runs', candidateName);
await mkdir(outputRoot, { recursive: true });

for (const sample of manifest.samples) {
  const imageName = sample.image || sample.fileName;
  const stem = basename(imageName).replace(/\.[^.]+$/, '');
  const predictionPath = join(outputRoot, `${stem}.txt`);
  await writeFile(
    predictionPath,
    [
      `# Paste official OCR text for ${imageName} below this line.`,
      '# Delete these comment lines before final evaluation if the engine did not return them.',
      '',
    ].join('\n'),
    'utf8',
  );
}

await writeFile(
  join(outputRoot, 'run-metadata.json'),
  JSON.stringify(
    {
      candidateName,
      createdAt: new Date().toISOString(),
      datasetId: manifest.datasetId,
      sampleCount: manifest.samples.length,
      instructions: [
        'Run the official OCR engine against every image in manifest.json.',
        'Paste one raw OCR text result into the matching .txt file.',
        'Keep the same image inputs and no manual correction.',
        'Evaluate with scripts/evaluate-text-candidate.mjs.',
      ],
      references: [
        'Google ML Kit Text Recognition v2 Android',
        'Official PaddleOCR / PP-OCR pipeline',
        'NAVER Cloud CLOVA OCR Template',
        'Google Cloud Vision OCR or Document AI',
      ],
    },
    null,
    2,
  ),
  'utf8',
);

console.log(
  `Created ${manifest.samples.length} prediction templates in ${relative(
    process.cwd(),
    outputRoot,
  )}`,
);
