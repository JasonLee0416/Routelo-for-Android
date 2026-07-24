import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const datasetRoot = resolve(__dirname, '..');
const repoRoot = resolve(datasetRoot, '..', '..', '..');
const appRoot = join(repoRoot, 'routelo');
const reportDirectory = join(appRoot, 'docs', 'ocr-hypothesis');
const reportJsonPath = join(reportDirectory, '2026-07-24-hypothesis-report.json');
const reportMarkdownPath = join(reportDirectory, '2026-07-24-hypothesis-report.md');
const parserOutDir = join(repoRoot, 'tmp', 'ocr-hypothesis-parser-cjs');

const requireFromApp = createRequire(join(appRoot, 'package.json'));
const { decode } = requireFromApp('jpeg-js');

const manifest = JSON.parse(readFileSync(join(datasetRoot, 'manifest.json'), 'utf8'));
const nativeBaselinePath = join(
  appRoot,
  'docs',
  'ocr-benchmark',
  '2026-06-23',
  'native-results.json',
);
const recordedParsedPath = join(
  appRoot,
  'docs',
  'ocr-benchmark',
  '2026-06-23',
  'parsed-results.json',
);

const OCR_TARGET_LONG_SIDE = 2400;
const OCR_MIN_SHORT_SIDE = 1080;
const REQUIRED_KEYS = ['deliveryDate', 'productName', 'deliveryAddress'];

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const percent = (value) => Math.round(clamp(value));

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function compactText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[|·•]/g, '')
    .trim();
}

function normalizeForCoverage(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

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

function textMetrics(golden, predicted) {
  const left = compactText(golden.replaceAll(manifest.unknownToken, ''));
  const right = compactText(predicted);
  const distance = levenshtein(right, left);
  const goldenTokens = normalizeForCoverage(golden)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token !== normalizeForCoverage(manifest.unknownToken));
  const predictedCoverage = normalizeForCoverage(predicted);
  const coveredTokens = goldenTokens.filter((token) => predictedCoverage.includes(token));
  return {
    empty: right.length === 0,
    goldenCharacters: left.length,
    predictedCharacters: right.length,
    normalizedCer: left.length ? Number((distance / left.length).toFixed(4)) : 0,
    tokenCoverage: goldenTokens.length
      ? Number((coveredTokens.length / goldenTokens.length).toFixed(4))
      : 1,
  };
}

function rgbToHsvSaturation(red, green, blue) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return max === 0 ? 0 : (max - min) / max;
}

function nearestAxisAngle(degrees) {
  const normalized = Math.abs(degrees) % 90;
  return Math.min(normalized, 90 - normalized);
}

function scoreBrightness(mean, darkRatio, blownRatio) {
  return percent(100 - Math.abs(mean - 0.66) * 115 - darkRatio * 65 - blownRatio * 45);
}

function scoreSharpness(laplacianVariance) {
  return percent(Math.log10(laplacianVariance + 1) * 34);
}

function scoreShadow(tileStd) {
  return percent(100 - tileStd * 185);
}

function scoreSkew(skewDegrees) {
  if (skewDegrees === undefined) return 35;
  return percent(100 - nearestAxisAngle(skewDegrees) * 5.5);
}

function scoreCoverage(boxRatio, paperRatio) {
  if (paperRatio < 0.04) return 20;
  if (boxRatio < 0.22) return percent(boxRatio * 180);
  if (boxRatio > 0.98) return 88;
  return percent(52 + boxRatio * 55);
}

function inspectJpegQuality(imagePath) {
  const buffer = readFileSync(imagePath);
  const decoded = decode(buffer, { useTArray: true, formatAsRGBA: true });
  const pixels = decoded.width * decoded.height;
  const luminance = new Float32Array(pixels);
  let sum = 0;
  let darkPixels = 0;
  let blownPixels = 0;
  let paperPixels = 0;
  let minX = decoded.width;
  let minY = decoded.height;
  let maxX = -1;
  let maxY = -1;
  let paperSumX = 0;
  let paperSumY = 0;
  let paperSumXX = 0;
  let paperSumYY = 0;
  let paperSumXY = 0;

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    const red = decoded.data[offset];
    const green = decoded.data[offset + 1];
    const blue = decoded.data[offset + 2];
    const y = Math.floor(pixel / decoded.width);
    const x = pixel - y * decoded.width;
    const lum = (red * 0.299 + green * 0.587 + blue * 0.114) / 255;
    const saturation = rgbToHsvSaturation(red, green, blue);
    luminance[pixel] = lum;
    sum += lum;
    if (lum < 0.18) darkPixels += 1;
    if (lum > 0.94) blownPixels += 1;

    const paperLike = lum > 0.48 && saturation < 0.42;
    if (paperLike) {
      paperPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      paperSumX += x;
      paperSumY += y;
      paperSumXX += x * x;
      paperSumYY += y * y;
      paperSumXY += x * y;
    }
  }

  let laplacianSum = 0;
  let laplacianSquares = 0;
  let laplacianCount = 0;
  for (let y = 1; y < decoded.height - 1; y += 2) {
    for (let x = 1; x < decoded.width - 1; x += 2) {
      const center = luminance[y * decoded.width + x];
      const laplacian =
        luminance[(y - 1) * decoded.width + x] +
        luminance[(y + 1) * decoded.width + x] +
        luminance[y * decoded.width + x - 1] +
        luminance[y * decoded.width + x + 1] -
        center * 4;
      laplacianSum += laplacian;
      laplacianSquares += laplacian * laplacian;
      laplacianCount += 1;
    }
  }

  const mean = pixels ? sum / pixels : 0;
  const laplacianMean = laplacianCount ? laplacianSum / laplacianCount : 0;
  const laplacianVariance =
    Math.max(0, laplacianCount ? laplacianSquares / laplacianCount - laplacianMean ** 2 : 0) *
    255 *
    255;
  const hasPaper = paperPixels > pixels * 0.035 && maxX >= minX && maxY >= minY;
  const boxRatio = hasPaper ? ((maxX - minX + 1) * (maxY - minY + 1)) / pixels : 0;
  const paperRatio = paperPixels / Math.max(1, pixels);

  let skewDegrees;
  if (hasPaper) {
    const cx = paperSumX / paperPixels;
    const cy = paperSumY / paperPixels;
    const covXX = paperSumXX / paperPixels - cx * cx;
    const covYY = paperSumYY / paperPixels - cy * cy;
    const covXY = paperSumXY / paperPixels - cx * cy;
    skewDegrees = (0.5 * Math.atan2(2 * covXY, covXX - covYY) * 180) / Math.PI;
  }

  const tileMeans = [];
  const columns = 6;
  const rows = 8;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let tileSum = 0;
      let tileCount = 0;
      const startX = Math.floor((column * decoded.width) / columns);
      const endX = Math.floor(((column + 1) * decoded.width) / columns);
      const startY = Math.floor((row * decoded.height) / rows);
      const endY = Math.floor(((row + 1) * decoded.height) / rows);
      for (let y = startY; y < endY; y += 2) {
        for (let x = startX; x < endX; x += 2) {
          tileSum += luminance[y * decoded.width + x];
          tileCount += 1;
        }
      }
      if (tileCount) tileMeans.push(tileSum / tileCount);
    }
  }
  const tileAverage = tileMeans.reduce((total, value) => total + value, 0) / tileMeans.length;
  const tileStd = Math.sqrt(
    tileMeans.reduce((total, value) => total + (value - tileAverage) ** 2, 0) /
      Math.max(tileMeans.length, 1),
  );

  const brightness = scoreBrightness(mean, darkPixels / pixels, blownPixels / pixels);
  const blur = scoreSharpness(laplacianVariance);
  const documentCoverage = scoreCoverage(boxRatio, paperRatio);
  const skew = scoreSkew(skewDegrees);
  const shadow = scoreShadow(tileStd);
  const score = Math.round(
    blur * 0.27 + brightness * 0.19 + documentCoverage * 0.24 + skew * 0.15 + shadow * 0.15,
  );
  return {
    measured: true,
    passed: score >= 62 && blur >= 38 && brightness >= 35 && documentCoverage >= 35,
    score,
    blur,
    brightness,
    documentCoverage,
    skew,
    shadow,
    metrics: {
      width: decoded.width,
      height: decoded.height,
      sharpnessVariance: Number(laplacianVariance.toFixed(2)),
      luminanceMean: Number(mean.toFixed(3)),
      paperPixelRatio: Number(paperRatio.toFixed(3)),
      documentBoxRatio: Number(boxRatio.toFixed(3)),
      shadowTileStd: Number(tileStd.toFixed(3)),
      skewDegrees: skewDegrees === undefined ? undefined : Number(skewDegrees.toFixed(1)),
    },
  };
}

function preparedImageInfo(width, height, fileSize) {
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  const normalized = longSide > OCR_TARGET_LONG_SIDE;
  const scale = normalized ? OCR_TARGET_LONG_SIDE / longSide : 1;
  const preparedWidth = Math.round(width * scale);
  const preparedHeight = Math.round(height * scale);
  return {
    width: preparedWidth,
    height: preparedHeight,
    normalized,
    scale: Number(scale.toFixed(4)),
    fileSize,
    minShortSidePass: Math.min(preparedWidth, preparedHeight) >= OCR_MIN_SHORT_SIDE,
    notes: [
      normalized ? `long side normalized to ${OCR_TARGET_LONG_SIDE}px` : 'original dimensions kept',
      shortSide < OCR_MIN_SHORT_SIDE
        ? `original short side below ${OCR_MIN_SHORT_SIDE}px`
        : undefined,
    ].filter(Boolean),
  };
}

function compileParser() {
  mkdirSync(parserOutDir, { recursive: true });
  const tscBin = join(appRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(
    process.execPath,
    [
      tscBin,
      'app/services/ocr.ts',
      '--outDir',
      relative(appRoot, parserOutDir),
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
      `Unable to compile current parser.\nERROR:\n${result.error?.message ?? ''}\nSTDOUT:\n${result.stdout ?? ''}\nSTDERR:\n${result.stderr ?? ''}`,
    );
  }
  const compiledPath = join(parserOutDir, 'services', 'ocr.js');
  if (!existsSync(compiledPath)) {
    throw new Error(`Compiled parser not found: ${compiledPath}`);
  }
  return createRequire(import.meta.url)(compiledPath);
}

function parserSummary(parsed, rawText) {
  const rawCompact = compactText(rawText);
  const fields = parsed.fields.map((field) => {
    const value = String(field.value || '');
    const sourceText = String(field.sourceText || '');
    const valueCompact = compactText(value);
    const sourceCompact = compactText(sourceText);
    const provenance = !value
      ? 'missing'
      : sourceText && rawCompact.includes(sourceCompact)
        ? 'sourceText'
        : valueCompact && rawCompact.includes(valueCompact)
          ? 'rawFallback'
          : 'unsupported';
    return {
      key: field.key,
      value,
      confidence: field.confidence,
      status: field.status,
      provenance,
    };
  });
  const populated = fields.filter((field) => field.value);
  const missingRequiredFields = REQUIRED_KEYS.filter(
    (key) => !fields.find((field) => field.key === key && field.value),
  );
  return {
    documentConfidence: parsed.documentConfidence,
    populatedFieldCount: populated.length,
    unsupportedFieldCount: fields.filter((field) => field.provenance === 'unsupported').length,
    rawFallbackFieldCount: fields.filter((field) => field.provenance === 'rawFallback').length,
    requiredFieldCount: REQUIRED_KEYS.length,
    missingRequiredFields,
    fields,
  };
}

function ppOcrServerProbe() {
  const genericRuntime = readFileSync(join(appRoot, 'app', 'ocr', 'ppocr', 'runtime.ts'), 'utf8');
  const nativeRuntime = readFileSync(join(appRoot, 'app', 'ocr', 'ppocr', 'runtime.native.ts'), 'utf8');
  const imageRuntime = readFileSync(join(appRoot, 'app', 'ocr', 'ppocr', 'image.ts'), 'utf8');
  const blockingImports = [
    nativeRuntime.includes('onnxruntime-react-native') ? 'onnxruntime-react-native' : undefined,
    nativeRuntime.includes('expo-asset') ? 'expo-asset' : undefined,
    imageRuntime.includes('expo-image-manipulator') ? 'expo-image-manipulator' : undefined,
    imageRuntime.includes('react-native') ? 'react-native Image.getSize' : undefined,
  ].filter(Boolean);
  return {
    status: genericRuntime.includes('PP-OCR requires an Android or iOS native build.')
      ? 'native-only-blocker'
      : 'unknown',
    canRunOnNodeServer: false,
    blockingImports,
    reason:
      'The checked-in server/runtime entrypoint intentionally throws outside Android/iOS, while the native implementation depends on React Native/Expo image APIs and onnxruntime-react-native rather than a Node OCR runner.',
    nextAction:
      'Use the Android APK or an emulator instrumentation harness for PP-OCR runtime numbers; keep Node reports focused on image prep, ML Kit recorded baseline, and parser regression.',
  };
}

function classifyHypotheses({ quality, mlkitMetrics, currentParser, previousParser }) {
  const labels = [];
  if (quality.passed && (mlkitMetrics.empty || currentParser.missingRequiredFields.length >= 2)) {
    labels.push('QUALITY_GATE_FALSE_POSITIVE');
  }
  if (!mlkitMetrics.empty && currentParser.missingRequiredFields.length >= 2) {
    labels.push('PARSER_MAPPING_FAILURE');
  }
  if (
    !mlkitMetrics.empty &&
    previousParser &&
    currentParser.populatedFieldCount < previousParser.populatedFieldCount
  ) {
    labels.push('CURRENT_PARSER_REGRESSION');
  }
  labels.push('PPOCR_NATIVE_ONLY_BLOCKER');
  return labels;
}

function markdownTable(rows, columns) {
  const header = `| ${columns.map((column) => column.label).join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map(
    (row) =>
      `| ${columns
        .map((column) => String(column.value(row)).replace(/\n/g, '<br>').replace(/\|/g, '\\|'))
        .join(' | ')} |`,
  );
  return [header, divider, ...body].join('\n');
}

const { parseReceiptText } = compileParser();
const nativeBaseline = JSON.parse(readFileSync(nativeBaselinePath, 'utf8'));
const recordedParsed = JSON.parse(readFileSync(recordedParsedPath, 'utf8'));
const recordedParsedByFile = new Map(recordedParsed.results.map((result) => [result.file, result]));
const nativeByFile = new Map(nativeBaseline.results.map((result) => [result.file, result]));
const ppOcrProbe = ppOcrServerProbe();

const samples = manifest.samples.map((sample) => {
  const imagePath = join(datasetRoot, sample.image);
  const imageBuffer = readFileSync(imagePath);
  const decoded = decode(imageBuffer, { useTArray: false });
  const file = basename(sample.image);
  const native = nativeByFile.get(file);
  if (!native) throw new Error(`Missing recorded native ML Kit baseline for ${file}`);
  const golden = readFileSync(join(datasetRoot, sample.rawGoldenText), 'utf8');
  const quality = inspectJpegQuality(imagePath);
  const prepared = preparedImageInfo(decoded.width, decoded.height, statSync(imagePath).size);
  const currentParsed = parseReceiptText(native.fullText, {
    score: quality.score,
    blur: quality.blur,
    brightness: quality.brightness,
    documentCoverage: quality.documentCoverage,
    skew: quality.skew,
    shadow: quality.shadow,
    passed: quality.passed,
    measured: quality.measured,
    messages: [],
    metrics: quality.metrics,
  });
  const currentParser = parserSummary(currentParsed, native.fullText);
  const previousParser = recordedParsedByFile.get(file)?.parser;
  const mlkitMetrics = textMetrics(golden, native.fullText);
  return {
    file,
    sha256: sha256(imageBuffer),
    notes: sample.notes,
    image: {
      width: decoded.width,
      height: decoded.height,
      fileSize: statSync(imagePath).size,
    },
    prepared,
    quality,
    recordedMlkitBaseline: {
      engine: nativeBaseline.engine,
      device: nativeBaseline.device,
      processingMs: native.processingMs,
      lineCount: native.lineCount,
      rawTextLength: native.fullText.length,
      ...mlkitMetrics,
    },
    currentParser,
    recordedParserComparison: previousParser
      ? {
          previousPopulatedFieldCount: previousParser.populatedFieldCount,
          currentPopulatedFieldCount: currentParser.populatedFieldCount,
          populatedFieldDelta:
            currentParser.populatedFieldCount - previousParser.populatedFieldCount,
          previousDocumentConfidence: previousParser.documentConfidence,
          currentDocumentConfidence: currentParser.documentConfidence,
          documentConfidenceDelta:
            currentParser.documentConfidence - previousParser.documentConfidence,
        }
      : undefined,
    hypothesisLabels: classifyHypotheses({
      quality,
      mlkitMetrics,
      currentParser,
      previousParser,
    }),
  };
});

const summary = {
  generatedAt: new Date().toISOString(),
  datasetId: manifest.datasetId,
  sampleCount: samples.length,
  qualityPassCount: samples.filter((sample) => sample.quality.passed).length,
  mlkitNonEmptyCount: samples.filter((sample) => !sample.recordedMlkitBaseline.empty).length,
  averageMlkitNormalizedCer: Number(
    (
      samples.reduce((sum, sample) => sum + sample.recordedMlkitBaseline.normalizedCer, 0) /
      samples.length
    ).toFixed(4),
  ),
  averageMlkitTokenCoverage: Number(
    (
      samples.reduce((sum, sample) => sum + sample.recordedMlkitBaseline.tokenCoverage, 0) /
      samples.length
    ).toFixed(4),
  ),
  averageCurrentParserPopulatedFields: Number(
    (
      samples.reduce((sum, sample) => sum + sample.currentParser.populatedFieldCount, 0) /
      samples.length
    ).toFixed(2),
  ),
  samplesMissingAtLeastTwoRequiredFields: samples.filter(
    (sample) => sample.currentParser.missingRequiredFields.length >= 2,
  ).length,
  qualityFalsePositiveCount: samples.filter((sample) =>
    sample.hypothesisLabels.includes('QUALITY_GATE_FALSE_POSITIVE'),
  ).length,
  ppOcrServerProbe: ppOcrProbe,
};

const report = {
  schemaVersion: 1,
  purpose:
    'Test OCR failure hypotheses against checked-in receipt images before another manual Galaxy APK test.',
  hypotheses: [
    {
      id: 1,
      name: 'Diagnostic/engine flags are not reliably reflected in release APKs',
      evidence:
        'This Node report cannot inspect an installed APK runtime, but it establishes the baseline that checked-in images have non-empty ML Kit results. Device 0/3 therefore needs runtime config visibility in-app.',
      status: 'needs-apk-runtime-probe',
    },
    {
      id: 2,
      name: 'Captured image and OCR input image may differ',
      evidence:
        'This report records original and prepared dimensions/file data for repository samples. The APK should display the same kind of image facts and OCR input preview.',
      status: 'partially-tested',
    },
    {
      id: 3,
      name: 'PP-OCR preprocessing/detection is failing',
      evidence: ppOcrProbe.reason,
      status: ppOcrProbe.status,
    },
    {
      id: 4,
      name: 'Quality gate is not predictive of OCR success',
      evidence: `${summary.qualityFalsePositiveCount}/${summary.sampleCount} samples passed quality but still missed at least two required parser fields or had empty OCR text.`,
      status: summary.qualityFalsePositiveCount ? 'supported' : 'not-supported-by-recorded-baseline',
    },
    {
      id: 5,
      name: 'Android Korean Text can read samples but app cannot use the result',
      evidence: `${summary.mlkitNonEmptyCount}/${summary.sampleCount} recorded ML Kit baseline samples produced non-empty text.`,
      status: summary.mlkitNonEmptyCount === summary.sampleCount ? 'supported' : 'mixed',
    },
    {
      id: 6,
      name: 'Parser fails to map raw OCR text into required fields',
      evidence: `${summary.samplesMissingAtLeastTwoRequiredFields}/${summary.sampleCount} samples are missing at least two required fields after current parser processing.`,
      status: summary.samplesMissingAtLeastTwoRequiredFields ? 'supported' : 'not-supported',
    },
  ],
  summary,
  samples,
};

mkdirSync(reportDirectory, { recursive: true });
writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);

const markdown = `# OCR Hypothesis Report — 2026-07-24

This report tests the current OCR failure hypotheses against the checked-in receipt sample dataset before another manual Galaxy APK test.

## Dataset

- Dataset: \`${manifest.datasetId}\`
- Samples: ${summary.sampleCount}
- Images: \`benchmarks/ocr/receipt-samples/images\`
- Golden text: \`benchmarks/ocr/receipt-samples/golden/raw_golden_answer_text\`
- Recorded native baseline: \`routelo/docs/ocr-benchmark/2026-06-23/native-results.json\`
- Current parser: \`routelo/app/services/ocr.ts::parseReceiptText\`

## Summary

- Quality pass count: **${summary.qualityPassCount}/${summary.sampleCount}**
- Recorded ML Kit non-empty count: **${summary.mlkitNonEmptyCount}/${summary.sampleCount}**
- Average recorded ML Kit CER: **${summary.averageMlkitNormalizedCer}**
- Average recorded ML Kit token coverage: **${summary.averageMlkitTokenCoverage}**
- Average current parser populated fields: **${summary.averageCurrentParserPopulatedFields}**
- Samples missing at least two required fields after current parsing: **${summary.samplesMissingAtLeastTwoRequiredFields}/${summary.sampleCount}**
- Quality false-positive candidates: **${summary.qualityFalsePositiveCount}/${summary.sampleCount}**

## Hypothesis Status

${markdownTable(report.hypotheses, [
  { label: 'ID', value: (row) => row.id },
  { label: 'Hypothesis', value: (row) => row.name },
  { label: 'Status', value: (row) => row.status },
  { label: 'Evidence', value: (row) => row.evidence },
])}

## Sample Results

${markdownTable(samples, [
  { label: 'Sample', value: (row) => row.file },
  { label: 'Image', value: (row) => `${row.image.width}x${row.image.height}` },
  { label: 'Prepared', value: (row) => `${row.prepared.width}x${row.prepared.height}${row.prepared.normalized ? ' normalized' : ''}` },
  { label: 'Quality', value: (row) => `${row.quality.score}${row.quality.passed ? ' pass' : ' fail'}` },
  { label: 'ML Kit text', value: (row) => `${row.recordedMlkitBaseline.rawTextLength} chars / ${row.recordedMlkitBaseline.lineCount} lines` },
  { label: 'CER', value: (row) => row.recordedMlkitBaseline.normalizedCer },
  { label: 'Token coverage', value: (row) => row.recordedMlkitBaseline.tokenCoverage },
  { label: 'Parser fields', value: (row) => row.currentParser.populatedFieldCount },
  { label: 'Missing required', value: (row) => row.currentParser.missingRequiredFields.join(', ') || '-' },
  { label: 'Labels', value: (row) => row.hypothesisLabels.join(', ') },
])}

## PP-OCR Server Probe

- Status: **${ppOcrProbe.status}**
- Can run on this Node server: **${ppOcrProbe.canRunOnNodeServer ? 'yes' : 'no'}**
- Blocking imports: ${ppOcrProbe.blockingImports.map((item) => `\`${item}\``).join(', ')}
- Reason: ${ppOcrProbe.reason}
- Next action: ${ppOcrProbe.nextAction}

## Interpretation

The repository samples already have non-empty recorded ML Kit Korean text output, but current parser mapping still misses at least two required fields on ${summary.samplesMissingAtLeastTwoRequiredFields}/${summary.sampleCount} samples. This supports two parallel conclusions:

1. The Galaxy APK showing 0/3 likely needs runtime/input-path visibility first, because the repository baseline proves the samples are not universally unreadable.
2. Even when OCR text exists, parser mapping is still too weak for automatic registration and should remain guarded by manual review.

`;

writeFileSync(reportMarkdownPath, markdown);

console.log(
  JSON.stringify(
    {
      summary,
      reports: {
        json: reportJsonPath,
        markdown: reportMarkdownPath,
      },
    },
    null,
    2,
  ),
);
