import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const datasetRoot = join(__dirname, '..');

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith('--')) continue;
  const next = process.argv[index + 1];
  args.set(arg.slice(2), next && !next.startsWith('--') ? next : 'true');
  if (next && !next.startsWith('--')) index += 1;
}

const candidateName = args.get('candidate-name') || 'unnamed-candidate';
const predictionsDirArg = args.get('predictions-dir');
const maxNormalizedCerArg = args.get('max-normalized-cer');
if (!predictionsDirArg) {
  console.error('Usage: node scripts/evaluate-text-candidate.mjs --candidate-name NAME --predictions-dir DIR [--max-normalized-cer N]');
  process.exit(2);
}

const predictionsDir = join(datasetRoot, predictionsDirArg);
const manifest = JSON.parse(readFileSync(join(datasetRoot, 'manifest.json'), 'utf8'));
const unknownToken = manifest.unknownToken || '[불명]';

const stripUnknown = (text) =>
  text
    .replaceAll(unknownToken, '')
    .replace(/\[[^\]\n]+\]/g, '');

const normalizeForCer = (text) =>
  stripUnknown(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[|·•]/g, '')
    .trim();

const normalizeForCoverage = (text) =>
  stripUnknown(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function levenshtein(left, right) {
  const a = [...left];
  const b = [...right];
  const previous = new Array(b.length + 1);
  const current = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function readPredictionText(sample) {
  const stem = basename(sample.image).replace(/\.[^.]+$/, '');
  const txtPath = join(predictionsDir, `${stem}.txt`);
  const jsonPath = join(predictionsDir, `${stem}.json`);
  if (existsSync(txtPath)) return readFileSync(txtPath, 'utf8');
  if (existsSync(jsonPath)) {
    const value = JSON.parse(readFileSync(jsonPath, 'utf8'));
    if (typeof value.fullText === 'string') return value.fullText;
    if (typeof value.text === 'string') return value.text;
    if (Array.isArray(value.lines)) {
      return value.lines
        .map((line) => (typeof line === 'string' ? line : line.text))
        .filter(Boolean)
        .join('\n');
    }
  }
  return '';
}

const results = manifest.samples.map((sample) => {
  const golden = readFileSync(join(datasetRoot, sample.rawGoldenText), 'utf8');
  const prediction = readPredictionText(sample);
  const goldenCer = normalizeForCer(golden);
  const predictionCer = normalizeForCer(prediction);
  const distance = levenshtein(predictionCer, goldenCer);
  const cer = goldenCer.length ? distance / goldenCer.length : 0;
  const goldenTokens = normalizeForCoverage(golden).split(/\s+/).filter(Boolean);
  const predictionCoverage = normalizeForCoverage(prediction);
  const coveredTokens = goldenTokens.filter((token) => predictionCoverage.includes(token));
  return {
    image: sample.image,
    empty: predictionCer.length === 0,
    goldenCharacters: goldenCer.length,
    predictedCharacters: predictionCer.length,
    editDistance: distance,
    normalizedCer: Number(cer.toFixed(4)),
    tokenCoverage: goldenTokens.length
      ? Number((coveredTokens.length / goldenTokens.length).toFixed(4))
      : 1,
  };
});

const emptyCount = results.filter((result) => result.empty).length;
const totalGoldenChars = results.reduce((sum, result) => sum + result.goldenCharacters, 0);
const totalDistance = results.reduce((sum, result) => sum + result.editDistance, 0);
const summary = {
  candidateName,
  sampleCount: results.length,
  emptyResultRate: Number((emptyCount / results.length).toFixed(4)),
  normalizedCer: totalGoldenChars
    ? Number((totalDistance / totalGoldenChars).toFixed(4))
    : 0,
  averageTokenCoverage: Number(
    (results.reduce((sum, result) => sum + result.tokenCoverage, 0) / results.length).toFixed(4),
  ),
};

const report = { summary, results };
console.log(JSON.stringify(report, null, 2));

if (maxNormalizedCerArg !== undefined) {
  const maxNormalizedCer = Number(maxNormalizedCerArg);
  if (!Number.isFinite(maxNormalizedCer)) {
    console.error(`Invalid --max-normalized-cer value: ${maxNormalizedCerArg}`);
    process.exit(2);
  }
  if (summary.normalizedCer > maxNormalizedCer) {
    console.error(
      `normalizedCer ${summary.normalizedCer} exceeds gate ${maxNormalizedCer}`,
    );
    process.exit(1);
  }
}

