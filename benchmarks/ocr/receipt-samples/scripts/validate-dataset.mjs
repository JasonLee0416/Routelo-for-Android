import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const datasetRoot = join(__dirname, '..');
const manifestPath = join(datasetRoot, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const errors = [];
const seenImages = new Set();
const seenGolden = new Set();

if (manifest.schemaVersion !== 1) {
  errors.push(`Unsupported schemaVersion: ${manifest.schemaVersion}`);
}
if (!Array.isArray(manifest.samples) || manifest.samples.length === 0) {
  errors.push('manifest.samples must be a non-empty array.');
}

for (const sample of manifest.samples || []) {
  const label = sample.image || '<missing image>';
  if (!sample.image || !sample.rawGoldenText || !sample.sha256) {
    errors.push(`${label}: image, rawGoldenText, and sha256 are required.`);
    continue;
  }
  if (seenImages.has(sample.image)) errors.push(`${label}: duplicate image.`);
  if (seenGolden.has(sample.rawGoldenText)) {
    errors.push(`${label}: duplicate rawGoldenText.`);
  }
  seenImages.add(sample.image);
  seenGolden.add(sample.rawGoldenText);

  const imagePath = join(datasetRoot, sample.image);
  const goldenPath = join(datasetRoot, sample.rawGoldenText);
  if (!existsSync(imagePath)) {
    errors.push(`${label}: image file is missing.`);
    continue;
  }
  if (!existsSync(goldenPath)) {
    errors.push(`${label}: raw golden text file is missing.`);
    continue;
  }

  const imageBytes = readFileSync(imagePath);
  const actualSha = createHash('sha256').update(imageBytes).digest('hex');
  if (actualSha !== sample.sha256) {
    errors.push(`${label}: sha256 mismatch. expected ${sample.sha256}, got ${actualSha}`);
  }

  const golden = readFileSync(goldenPath, 'utf8');
  const normalizedGolden = golden.replace(/\r\n/g, '\n').trim();
  if (!normalizedGolden) errors.push(`${label}: raw golden text is empty.`);
  if (!normalizedGolden.includes('\n')) {
    errors.push(`${label}: raw golden text should preserve line-level structure.`);
  }
  if (/TODO|FIXME/i.test(normalizedGolden)) {
    errors.push(`${label}: raw golden text contains TODO/FIXME.`);
  }
}

if (errors.length) {
  console.error('OCR receipt sample dataset validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `OCR receipt sample dataset OK: ${manifest.samples.length} images with raw golden text.`,
);

