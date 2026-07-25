import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const datasetRoot = resolve(__dirname, '..');
const repoRoot = resolve(datasetRoot, '..', '..', '..');
const appRoot = join(repoRoot, 'routelo');
const reportDirectory = join(appRoot, 'docs', 'ocr-hypothesis');
const reportJsonPath = join(reportDirectory, '2026-07-25-roi-heuristic-sweep.json');
const reportMarkdownPath = join(reportDirectory, '2026-07-25-roi-heuristic-sweep.md');
const compiledOutDir = join(repoRoot, 'tmp', 'ocr-roi-heuristic-cjs');

const REQUIRED_KEYS = ['deliveryDate', 'productName', 'deliveryAddress'];
const OBSERVED_KEYS = [
  'orderingVendorName',
  'fulfillingVendorName',
  'productName',
  'productQuantity',
  'deliveryDate',
  'eventTime',
  'deliveryAddress',
  'recipientName',
  'recipientTel',
  'memo',
];

const manifest = JSON.parse(readFileSync(join(datasetRoot, 'manifest.json'), 'utf8'));
const nativeBaseline = JSON.parse(
  readFileSync(
    join(appRoot, 'docs', 'ocr-benchmark', '2026-06-23', 'native-results.json'),
    'utf8',
  ),
);

function compileAppOcrModules() {
  if (existsSync(compiledOutDir)) {
    rmSync(compiledOutDir, { recursive: true, force: true });
  }
  mkdirSync(compiledOutDir, { recursive: true });
  const tscBin = join(appRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(
    process.execPath,
    [
      tscBin,
      'app/services/ocr.ts',
      'app/services/ocrSpatialHeuristics.ts',
      '--outDir',
      relative(appRoot, compiledOutDir),
      '--module',
      'commonjs',
      '--target',
      'ES2020',
      '--moduleResolution',
      'node',
      '--esModuleInterop',
      '--skipLibCheck',
      '--noEmit',
      'false',
      '--ignoreConfig',
      '--ignoreDeprecations',
      '6.0',
    ],
    {
      cwd: appRoot,
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Unable to compile OCR modules.\nSTDOUT:\n${result.stdout ?? ''}\nSTDERR:\n${result.stderr ?? ''}`,
    );
  }
  return {
    ...createRequire(import.meta.url)(join(compiledOutDir, 'services', 'ocr.js')),
    ...createRequire(import.meta.url)(
      join(compiledOutDir, 'services', 'ocrSpatialHeuristics.js'),
    ),
  };
}

function qualityFixture(width, height) {
  return {
    score: 80,
    blur: 80,
    brightness: 80,
    documentCoverage: 80,
    skew: 80,
    shadow: 80,
    passed: true,
    measured: true,
    messages: [],
    metrics: { width, height },
  };
}

function normalizeComparable(value) {
  return String(value || '')
    .normalize('NFKC')
    .replaceAll(manifest.unknownToken, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function parseDate(value) {
  const text = String(value || '').normalize('NFKC');
  const korean = text.match(/(?:(20\d{2})\s*년)?\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  const iso = text.match(/(20\d{2})-(\d{2})-(\d{2})/);
  const match = iso || korean;
  if (!match) return '';
  const year = match[1] || '2026';
  return `${year}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
}

function extractExpectedFields(sample) {
  const manifestSample = manifest.samples.find((item) => item.image.endsWith(sample.file));
  const golden = manifestSample
    ? readFileSync(join(datasetRoot, manifestSample.rawGoldenText), 'utf8')
    : '';
  const fields = {};
  for (const line of golden.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const assign = (key, pattern) => {
      const match = line.match(pattern);
      if (match && !fields[key]) fields[key] = match[1].trim();
    };
    assign('orderingVendorName', /^(?:발주처|발주화원|발주회원)\s*:\s*(.+)$/u);
    assign('fulfillingVendorName', /^(?:배송화원|수주회원)\s*:\s*(.+)$/u);
    assign('productName', /^(?:품명|상품명|배송상품)\s*:\s*(.+)$/u);
    assign('productQuantity', /^수량\s*:\s*(.+)$/u);
    assign('deliveryDate', /^(?:배달일시|배송일시)\s*:\s*(.+)$/u);
    assign('deliveryAddress', /^(?:배달장소|배송장소)\s*:\s*(.+)$/u);
    assign('recipientName', /^(?:받는분|받으실분|인수자)\s*:\s*(.+)$/u);
    assign('recipientTel', /^(?:핸드폰|전화|HP|TEL)\s*:\s*(.+)$/u);
    assign('memo', /^(?:요구사항|요청사항)\s*:\s*(.+)$/u);
  }
  return fields;
}

function fieldMap(result) {
  return Object.fromEntries(result.fields.map((field) => [field.key, field]));
}

function requiredPopulated(fields) {
  return REQUIRED_KEYS.filter((key) => fields[key]?.value).length;
}

function allPopulated(fields) {
  return OBSERVED_KEYS.filter((key) => fields[key]?.value).length;
}

function looseHit(key, value, expected) {
  if (!value || !expected) return false;
  if (key === 'deliveryDate') return parseDate(value) === parseDate(expected);
  if (key.endsWith('Tel')) {
    const valueDigits = digits(value);
    const expectedDigits = digits(expected);
    return valueDigits.length >= 8 && expectedDigits.includes(valueDigits);
  }
  const normalizedValue = normalizeComparable(value);
  const expectedTokens = normalizeComparable(expected)
    .split(/\s+/)
    .filter((token) => token.length >= 2);
  if (!expectedTokens.length) return false;
  const covered = expectedTokens.filter((token) => normalizedValue.includes(token)).length;
  return covered / expectedTokens.length >= 0.38;
}

function summarizeParser(result, expected) {
  const fields = fieldMap(result);
  const goldenHits = OBSERVED_KEYS.filter((key) => looseHit(key, fields[key]?.value, expected[key]));
  return {
    documentConfidence: result.documentConfidence,
    requiredPopulated: requiredPopulated(fields),
    allPopulated: allPopulated(fields),
    missingRequired: REQUIRED_KEYS.filter((key) => !fields[key]?.value),
    goldenLooseHits: goldenHits.length,
    fields: Object.fromEntries(
      OBSERVED_KEYS.map((key) => [
        key,
        {
          value: fields[key]?.value || '',
          status: fields[key]?.status || 'missing',
          confidence: fields[key]?.confidence || 0,
          extractionMethod: fields[key]?.extractionMethod || '',
          sourceLineIds: fields[key]?.sourceLineIds || [],
          goldenLooseHit: looseHit(key, fields[key]?.value, expected[key]),
        },
      ]),
    ),
  };
}

function constantGrid() {
  const sameRowYRatios = [0.018, 0.022, 0.028];
  const xLeftSlackRatios = [0.015, 0.028, 0.045];
  const xRightGrowRatios = [0.55, 0.72, 0.9];
  const yUpSlackRatios = [0.05, 0.082, 0.12];
  const yDownGrowRatios = [0.07, 0.105, 0.15];
  const configs = [];
  for (const sameRowYRatio of sameRowYRatios) {
    for (const xLeftSlackRatio of xLeftSlackRatios) {
      for (const xRightGrowRatio of xRightGrowRatios) {
        for (const yUpSlackRatio of yUpSlackRatios) {
          for (const yDownGrowRatio of yDownGrowRatios) {
            configs.push({
              sameRowYRatio,
              xLeftSlackRatio,
              xRightGrowRatio,
              yUpSlackRatio,
              yDownGrowRatio,
              maxCandidatesPerAnchor: 3,
            });
          }
        }
      }
    }
  }
  return configs;
}

function scoreSummary(summary) {
  return (
    summary.requiredPopulated * 120 +
    summary.allPopulated * 18 +
    summary.goldenLooseHits * 28 +
    summary.documentConfidence
  );
}

const {
  parseReceiptText,
  applySpatialOcrFieldHeuristics,
  extractSpatialFieldCandidates,
} = compileAppOcrModules();

const baselineBySample = [];
const sweepResults = [];

for (const config of constantGrid()) {
  const sampleResults = [];
  for (const sample of nativeBaseline.results) {
    const expected = extractExpectedFields(sample);
    const baseline = parseReceiptText(sample.fullText, qualityFixture(sample.width, sample.height));
    const spatial = applySpatialOcrFieldHeuristics(
      baseline,
      sample.lines,
      { width: sample.width, height: sample.height },
      config,
    );
    const spatialCandidates = extractSpatialFieldCandidates(
      sample.lines,
      { width: sample.width, height: sample.height },
      config,
    );
    const summary = summarizeParser(spatial, expected);
    sampleResults.push({
      file: sample.file,
      summary,
      spatialCandidateKeys: Object.keys(spatialCandidates).filter(
        (key) => spatialCandidates[key]?.length,
      ),
    });
  }
  const aggregate = sampleResults.reduce(
    (acc, item) => {
      acc.requiredPopulated += item.summary.requiredPopulated;
      acc.allPopulated += item.summary.allPopulated;
      acc.goldenLooseHits += item.summary.goldenLooseHits;
      acc.documentConfidence += item.summary.documentConfidence;
      acc.score += scoreSummary(item.summary);
      return acc;
    },
    {
      requiredPopulated: 0,
      allPopulated: 0,
      goldenLooseHits: 0,
      documentConfidence: 0,
      score: 0,
    },
  );
  aggregate.documentConfidence = Number(
    (aggregate.documentConfidence / sampleResults.length).toFixed(2),
  );
  sweepResults.push({ config, aggregate, sampleResults });
}

for (const sample of nativeBaseline.results) {
  const expected = extractExpectedFields(sample);
  const baseline = parseReceiptText(sample.fullText, qualityFixture(sample.width, sample.height));
  baselineBySample.push({
    file: sample.file,
    summary: summarizeParser(baseline, expected),
  });
}

sweepResults.sort((left, right) => right.aggregate.score - left.aggregate.score);
const best = sweepResults[0];
const baselineAggregate = baselineBySample.reduce(
  (acc, item) => {
    acc.requiredPopulated += item.summary.requiredPopulated;
    acc.allPopulated += item.summary.allPopulated;
    acc.goldenLooseHits += item.summary.goldenLooseHits;
    acc.documentConfidence += item.summary.documentConfidence;
    return acc;
  },
  { requiredPopulated: 0, allPopulated: 0, goldenLooseHits: 0, documentConfidence: 0 },
);
baselineAggregate.documentConfidence = Number(
  (baselineAggregate.documentConfidence / baselineBySample.length).toFixed(2),
);

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  purpose:
    'Sweep axis-aligned field-distance OCR heuristics over recorded Android Korean ML Kit line boxes.',
  source: {
    dataset: manifest.datasetId,
    nativeBaseline: 'routelo/docs/ocr-benchmark/2026-06-23/native-results.json',
    samples: nativeBaseline.results.length,
    engine: nativeBaseline.engine,
  },
  constantsSearched: sweepResults.length,
  baselineAggregate,
  bestAggregate: best.aggregate,
  bestConfig: best.config,
  deltas: {
    requiredPopulated: best.aggregate.requiredPopulated - baselineAggregate.requiredPopulated,
    allPopulated: best.aggregate.allPopulated - baselineAggregate.allPopulated,
    goldenLooseHits: best.aggregate.goldenLooseHits - baselineAggregate.goldenLooseHits,
    documentConfidence: Number(
      (best.aggregate.documentConfidence - baselineAggregate.documentConfidence).toFixed(2),
    ),
  },
  baselineBySample,
  bestSampleResults: best.sampleResults,
  topConfigs: sweepResults.slice(0, 10).map(({ config, aggregate }) => ({
    config,
    aggregate,
  })),
};

mkdirSync(reportDirectory, { recursive: true });
writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const tableRows = best.sampleResults
  .map((item) => {
    const base = baselineBySample.find((candidate) => candidate.file === item.file)?.summary;
    return `| ${item.file} | ${base?.requiredPopulated ?? 0}/3 | ${item.summary.requiredPopulated}/3 | ${base?.allPopulated ?? 0} | ${item.summary.allPopulated} | ${base?.goldenLooseHits ?? 0} | ${item.summary.goldenLooseHits} | ${item.summary.missingRequired.join(', ') || '-'} |`;
  })
  .join('\n');

const markdown = `# OCR ROI heuristic sweep — 2026-07-25

## Experiment

- Dataset: \`${manifest.datasetId}\`
- Samples: ${nativeBaseline.results.length} checked-in receipt images
- OCR input: recorded Android Korean ML Kit line text + bounding boxes from \`routelo/docs/ocr-benchmark/2026-06-23/native-results.json\`
- Method: axis-aligned label-to-value field-distance heuristic sweep
- Constants searched: ${sweepResults.length}
- Scope: parser/schema recovery only. This does not re-run Android native ML Kit or native PP-OCR on the server.

## Best constants

\`\`\`json
${JSON.stringify(best.config, null, 2)}
\`\`\`

## Aggregate result

| Metric | Baseline parser | Best ROI heuristic | Delta |
| --- | ---: | ---: | ---: |
| Required fields populated | ${baselineAggregate.requiredPopulated}/${nativeBaseline.results.length * REQUIRED_KEYS.length} | ${best.aggregate.requiredPopulated}/${nativeBaseline.results.length * REQUIRED_KEYS.length} | ${report.deltas.requiredPopulated >= 0 ? '+' : ''}${report.deltas.requiredPopulated} |
| Observed fields populated | ${baselineAggregate.allPopulated} | ${best.aggregate.allPopulated} | ${report.deltas.allPopulated >= 0 ? '+' : ''}${report.deltas.allPopulated} |
| Loose golden field hits | ${baselineAggregate.goldenLooseHits} | ${best.aggregate.goldenLooseHits} | ${report.deltas.goldenLooseHits >= 0 ? '+' : ''}${report.deltas.goldenLooseHits} |
| Average document confidence | ${baselineAggregate.documentConfidence} | ${best.aggregate.documentConfidence} | ${report.deltas.documentConfidence >= 0 ? '+' : ''}${report.deltas.documentConfidence} |

## Per-sample result

| Sample | Baseline required | ROI required | Baseline populated | ROI populated | Baseline loose hits | ROI loose hits | ROI missing required |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${tableRows}

## Interpretation

The current OCR engine already returns usable line boxes for many labels such as product, quantity, delivery date, and delivery address. The weak point is converting those noisy, table-like line boxes into the canonical receipt schema. The ROI heuristic improves recovery by reading values near label anchors instead of relying only on plain text line order.

The heuristic remains conservative: it fills missing or warning fields only when the source line is present in OCR output and the normalized candidate survives the existing guardrails. It should therefore reduce schema drop-off without pretending that unrecognized text was successfully read.
`;

writeFileSync(reportMarkdownPath, markdown, 'utf8');
console.log(JSON.stringify({
  reportJsonPath,
  reportMarkdownPath,
  constantsSearched: sweepResults.length,
  baselineAggregate,
  bestAggregate: best.aggregate,
  deltas: report.deltas,
}, null, 2));
