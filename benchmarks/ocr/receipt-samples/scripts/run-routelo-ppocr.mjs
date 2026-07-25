// RouteLO PP-OCR 오프라인 배치 러너.
//
// 목적: 기기 없이 8장 골든셋에 현재 파이프라인을 돌려 프로파일별 CER을 비교한다(#99).
// 앱과 동일한 ONNX 모델·사전을 쓰고, DB 후처리/워프/CTC 디코딩은 프로덕션 TS 모듈을
// 그대로 import 한다(재구현하면 측정값이 앱과 달라져 판정 근거가 되지 못한다).
//
// 앱과 다른 유일한 부분은 이미지 디코드/리사이즈다. 앱은 expo-image-manipulator(네이티브)를
// 쓰지만 Node에는 없으므로 jpeg-js + 순수 JS 이중선형 리사이즈로 대체한다. 두 프로파일에
// 동일하게 적용되므로 프로파일 간 비교에는 영향이 없다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const datasetRoot = join(__dirname, '..');
const repoRoot = join(datasetRoot, '..', '..', '..');
const appRoot = join(repoRoot, 'routelo');

// 벤치마크는 별도 패키지라 자체 node_modules가 없다. 앱과 완전히 동일한 런타임을
// 쓰기 위해 앱 패키지 기준으로 해석한다.
const requireFromApp = createRequire(join(appRoot, 'package.json'));
const ort = requireFromApp('onnxruntime-node');
const jpeg = requireFromApp('jpeg-js');

// Windows 절대 경로는 file:// URL로 넘겨야 ESM 로더가 받는다.
const appModule = (relative) =>
  import(pathToFileURL(join(appRoot, relative)).href);

const { extractDbTextRegions } = await appModule(
  'app/ocr/ppocr/dbPostprocess.ts',
);
const { decodeCtc } = await appModule('app/ocr/ppocr/ctc.ts');
const { stripWidthForQuad, warpQuadToStrip } = await appModule(
  'app/ocr/ppocr/warp.ts',
);
const { PP_OCR_PREPROCESS_PROFILES } = await appModule(
  'app/ocr/ppocr/profile.ts',
);

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith('--')) continue;
  const next = process.argv[index + 1];
  args.set(arg.slice(2), next && !next.startsWith('--') ? next : 'true');
  if (next && !next.startsWith('--')) index += 1;
}

const profileId = args.get('profile') || 'stable-mobile';
// 프로덕션과 동일한 id로 프로파일을 고른다(값 오타 방지).
const profile = Object.values(PP_OCR_PREPROCESS_PROFILES).find(
  (entry) => entry.id === profileId,
);
if (!profile) {
  const ids = Object.values(PP_OCR_PREPROCESS_PROFILES).map((p) => p.id);
  console.error(`unknown profile "${profileId}". known: ${ids.join(', ')}`);
  process.exit(2);
}
const outDir = join(repoRoot, args.get('out') || `tmp/ocr-runs/routelo-${profileId}`);

const manifest = JSON.parse(
  readFileSync(join(datasetRoot, 'manifest.json'), 'utf8'),
);
// manifest의 image는 데이터셋 루트 기준 상대 경로("images/....jpg")다.
const imagePaths = (manifest.samples || []).map((entry) =>
  typeof entry === 'string' ? entry : entry.image,
);

const dictionary = readFileSync(
  join(appRoot, 'assets/ocr/ppocrv5_korean_dict.txt'),
  'utf8',
)
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .filter(Boolean);

// --- 이미지 유틸 (앱의 네이티브 조작 대체) ---------------------------------

function decodeJpeg(path) {
  const decoded = jpeg.decode(readFileSync(path), {
    useTArray: true,
    formatAsRGBA: true,
  });
  return { width: decoded.width, height: decoded.height, rgba: decoded.data };
}

// 이중선형 리사이즈. 최근접보다 글자 획이 덜 깨져 인식기 입력 품질이 앱에 가깝다.
function resizeRgba(image, width, height) {
  const out = new Uint8Array(width * height * 4);
  const xRatio = image.width / width;
  const yRatio = image.height / height;
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(image.height - 1, (y + 0.5) * yRatio - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(image.height - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(image.width - 1, (x + 0.5) * xRatio - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(image.width - 1, x0 + 1);
      const wx = sx - x0;
      const target = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const p00 = image.rgba[(y0 * image.width + x0) * 4 + channel];
        const p01 = image.rgba[(y0 * image.width + x1) * 4 + channel];
        const p10 = image.rgba[(y1 * image.width + x0) * 4 + channel];
        const p11 = image.rgba[(y1 * image.width + x1) * 4 + channel];
        out[target + channel] =
          p00 * (1 - wx) * (1 - wy) +
          p01 * wx * (1 - wy) +
          p10 * (1 - wx) * wy +
          p11 * wx * wy;
      }
    }
  }
  return { width, height, rgba: out };
}

function cropRgba(image, originX, originY, width, height) {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.max(0, originY + y));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.max(0, originX + x));
      const from = (sourceY * image.width + sourceX) * 4;
      const to = (y * width + x) * 4;
      out[to] = image.rgba[from];
      out[to + 1] = image.rgba[from + 1];
      out[to + 2] = image.rgba[from + 2];
      out[to + 3] = image.rgba[from + 3];
    }
  }
  return { width, height, rgba: out };
}

// 조명 정규화: 고해상도 프로파일이 켜는 옵션. 그레이 채널의 백분위로 스트레치해
// 그림자/저대비 영수증의 획을 살린다.
function normalizeIllumination(image) {
  const gray = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < gray.length; pixel += 1) {
    const rgba = pixel * 4;
    gray[pixel] =
      0.299 * image.rgba[rgba] +
      0.587 * image.rgba[rgba + 1] +
      0.114 * image.rgba[rgba + 2];
  }
  const histogram = new Uint32Array(256);
  for (const value of gray) histogram[value] += 1;
  const lowCut = gray.length * 0.02;
  const highCut = gray.length * 0.98;
  let cumulative = 0;
  let low = 0;
  let high = 255;
  for (let value = 0; value < 256; value += 1) {
    cumulative += histogram[value];
    if (cumulative <= lowCut) low = value;
    if (cumulative <= highCut) high = value;
  }
  if (high <= low) return image;
  const scale = 255 / (high - low);
  const out = new Uint8Array(image.rgba.length);
  for (let pixel = 0; pixel < gray.length; pixel += 1) {
    const rgba = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = (image.rgba[rgba + channel] - low) * scale;
      out[rgba + channel] = value < 0 ? 0 : value > 255 ? 255 : value;
    }
    out[rgba + 3] = 255;
  }
  return { width: image.width, height: image.height, rgba: out };
}

// --- 텐서 변환 (앱 image.ts와 동일한 정규화) --------------------------------

function detectorTensorData(image) {
  const plane = image.width * image.height;
  const values = new Float32Array(plane * 3);
  for (let pixel = 0; pixel < plane; pixel += 1) {
    const rgba = pixel * 4;
    values[pixel] = (image.rgba[rgba] / 255 - 0.485) / 0.229;
    values[plane + pixel] = (image.rgba[rgba + 1] / 255 - 0.456) / 0.224;
    values[plane * 2 + pixel] = (image.rgba[rgba + 2] / 255 - 0.406) / 0.225;
  }
  return values;
}

function recognizerTensorData(image, targetWidth) {
  const plane = targetWidth * image.height;
  const values = new Float32Array(plane * 3);
  values.fill(1);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < Math.min(image.width, targetWidth); x += 1) {
      const source = (y * image.width + x) * 4;
      const target = y * targetWidth + x;
      values[target] = image.rgba[source] / 127.5 - 1;
      values[plane + target] = image.rgba[source + 1] / 127.5 - 1;
      values[plane * 2 + target] = image.rgba[source + 2] / 127.5 - 1;
    }
  }
  return values;
}

// --- 파이프라인 -------------------------------------------------------------

const detector = await ort.InferenceSession.create(
  join(appRoot, 'assets/ocr/ch_PP-OCRv5_det_mobile.onnx'),
);
const recognizer = await ort.InferenceSession.create(
  join(appRoot, 'assets/ocr/korean_PP-OCRv5_rec_mobile.onnx'),
);

async function recognize(imagePath) {
  const original = decodeJpeg(imagePath);
  const source = profile.tensor.illuminationNormalization
    ? normalizeIllumination(original)
    : original;

  const scale = Math.min(
    1,
    profile.detectorMaxSide / Math.max(source.width, source.height),
  );
  const width = Math.max(32, Math.ceil((source.width * scale) / 32) * 32);
  const height = Math.max(32, Math.ceil((source.height * scale) / 32) * 32);
  const detectorImage = resizeRgba(source, width, height);

  const detectorOutput = await detector.run({
    [detector.inputNames[0]]: new ort.Tensor(
      'float32',
      detectorTensorData(detectorImage),
      [1, 3, height, width],
    ),
  });
  const probabilities = detectorOutput[detector.outputNames[0]];
  const dims = probabilities.dims.map(Number);
  const mapHeight = dims.at(-2);
  const mapWidth = dims.at(-1);
  const data = probabilities.data;
  const offset = data.length - mapHeight * mapWidth;

  const regions = extractDbTextRegions(
    data.subarray(offset),
    mapWidth,
    mapHeight,
    source.width,
    source.height,
    // 프로파일별 DB 후처리 튜닝(threshold/unclip/maxRegions)을 앱과 동일하게 넘긴다.
    profile.dbPostprocess,
  );

  const lines = [];
  for (const region of regions) {
    const box = region.boundingBox;
    const originX = Math.max(0, Math.floor(box.x));
    const originY = Math.max(0, Math.floor(box.y));
    const cropWidth = Math.max(1, Math.round(box.width));
    const cropHeight = Math.max(1, Math.round(box.height));
    const cropped = cropRgba(source, originX, originY, cropWidth, cropHeight);
    const quad = region.cornerPoints.map((point) => ({
      x: point.x - originX,
      y: point.y - originY,
    }));
    const stripWidth = stripWidthForQuad(
      quad,
      profile.recognizerTargetHeight,
      profile.recognizerTargetWidth,
    );
    const strip = warpQuadToStrip(
      cropped,
      quad,
      stripWidth,
      profile.recognizerTargetHeight,
    );

    const output = await recognizer.run({
      [recognizer.inputNames[0]]: new ort.Tensor(
        'float32',
        recognizerTensorData(strip, profile.recognizerTargetWidth),
        [1, 3, profile.recognizerTargetHeight, profile.recognizerTargetWidth],
      ),
    });
    const logits = output[recognizer.outputNames[0]];
    const shape = logits.dims.map(Number);
    const decoded = decodeCtc(
      logits.data,
      shape.at(-2),
      shape.at(-1),
      dictionary,
    );
    if (decoded.text && decoded.confidence >= profile.minLineConfidence) {
      lines.push({ text: decoded.text, y: box.y, x: box.x });
    }
  }

  // 앱은 검토 화면에서 위→아래로 읽으므로 같은 순서로 직렬화한다.
  lines.sort((a, b) => a.y - b.y || a.x - b.x);
  return lines.map((line) => line.text).join('\n');
}

mkdirSync(outDir, { recursive: true });
console.log(`profile=${profile.id} detectorMaxSide=${profile.detectorMaxSide} recWidth=${profile.recognizerTargetWidth} minConf=${profile.minLineConfidence}`);
console.log(`out=${outDir}`);

for (const relativePath of imagePaths) {
  const imagePath = join(datasetRoot, relativePath);
  const name = relativePath.split('/').pop();
  const startedAt = Date.now();
  const text = await recognize(imagePath);
  const target = join(outDir, name.replace(/\.[^.]+$/, '.txt'));
  writeFileSync(target, text, 'utf8');
  console.log(
    `${name}: ${text.length} chars, ${text.split('\n').filter(Boolean).length} lines, ${Date.now() - startedAt}ms`,
  );
}
console.log('done');
