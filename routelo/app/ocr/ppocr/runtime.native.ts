import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { decodeCtc } from './ctc';
import { extractDbTextRegions } from './dbPostprocess';
import {
  detectorTensorData,
  prepareDetectorImage,
  prepareOrientationVariantUri,
  prepareRecognitionCrop,
  recognizerTensorData,
} from './image';
import { PP_OCR_MODEL_VERSION } from './modelManifest';
import { selectPpOcrPreprocessProfile } from './profile';
import {
  chooseBestOrientationCandidate,
  isGoodOrientationCandidate,
  PP_OCR_ORIENTATION_CANDIDATES,
  PpOcrOrientation,
  PpOcrOrientationCandidate,
} from './orientation';
import type { PpOcrLine, PpOcrResult } from './types';

const DETECTOR_ASSET = require('../../../assets/ocr/ch_PP-OCRv5_det_mobile.onnx');
const RECOGNIZER_ASSET = require('../../../assets/ocr/korean_PP-OCRv5_rec_mobile.onnx');
const DICTIONARY_ASSET = require('../../../assets/ocr/ppocrv5_korean_dict.txt');

type OrtModule = typeof import('onnxruntime-react-native');
type OrtSession = import('onnxruntime-react-native').InferenceSession;

let runtimePromise: Promise<{
  ort: OrtModule;
  detector: OrtSession;
  recognizer: OrtSession;
  dictionary: string[];
}> | null = null;

async function localAssetUri(moduleId: number): Promise<string> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri || asset.uri;
  if (!uri) throw new Error(`Unable to resolve bundled OCR asset ${asset.name}.`);
  return uri;
}

async function loadDictionary(uri: string) {
  const content = await FileSystem.readAsStringAsync(uri);
  return content
    .split(/\r?\n/)
    .map((entry) => entry.trimEnd())
    .filter(Boolean);
}

async function loadRuntime() {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('PP-OCR requires an Android or iOS native build.');
  }
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const ort = await import('onnxruntime-react-native');
      const [detectorUri, recognizerUri, dictionaryUri] = await Promise.all([
        localAssetUri(DETECTOR_ASSET),
        localAssetUri(RECOGNIZER_ASSET),
        localAssetUri(DICTIONARY_ASSET),
      ]);
      const [detector, recognizer, dictionary] = await Promise.all([
        ort.InferenceSession.create(detectorUri, {
          executionProviders: ['cpu'],
          graphOptimizationLevel: 'all',
        }),
        ort.InferenceSession.create(recognizerUri, {
          executionProviders: ['cpu'],
          graphOptimizationLevel: 'all',
        }),
        loadDictionary(dictionaryUri),
      ]);
      return { ort, detector, recognizer, dictionary };
    })();
  }
  return runtimePromise;
}

function tensorShape(output: import('onnxruntime-react-native').Tensor) {
  return output.dims.map(Number);
}

export function ppOcrCapability() {
  const available = Platform.OS === 'android' || Platform.OS === 'ios';
  return {
    available,
    engine: 'ppocrv5' as const,
    modelVersion: PP_OCR_MODEL_VERSION,
    reason: available
      ? undefined
      : `PP-OCR is unavailable on ${Platform.OS}.`,
  };
}

export async function recognizeReceiptWithPpOcr(
  imageUri: string,
): Promise<PpOcrResult> {
  if (!imageUri.trim()) throw new Error('Receipt image URI is required.');
  const startedAt = Date.now();
  const { ort, detector, recognizer, dictionary } = await loadRuntime();
  const profile = selectPpOcrPreprocessProfile();

  const runOrientationCandidate = async (
    orientation: PpOcrOrientation,
  ): Promise<PpOcrOrientationCandidate> => {
    const candidateStartedAt = Date.now();
    const variantUri = await prepareOrientationVariantUri(imageUri, orientation);
    const detectorImage = await prepareDetectorImage(
      variantUri,
      profile.detectorMaxSide,
    );
    const detectorInput = new ort.Tensor(
      'float32',
      detectorTensorData(detectorImage, profile.tensor),
      [1, 3, detectorImage.height, detectorImage.width],
    );
    const detectorOutputMap = await detector.run({
      [detector.inputNames[0]]: detectorInput,
    });
    const detectorOutput = detectorOutputMap[detector.outputNames[0]];
    const detectorShape = tensorShape(detectorOutput);
    const mapHeight = detectorShape.at(-2);
    const mapWidth = detectorShape.at(-1);
    if (!mapHeight || !mapWidth) {
      throw new Error(`Unexpected PP-OCR detector output: ${detectorShape}.`);
    }
    const probabilities = detectorOutput.data as Float32Array;
    const mapOffset = probabilities.length - mapHeight * mapWidth;
    const regions = extractDbTextRegions(
      probabilities.subarray(mapOffset),
      mapWidth,
      mapHeight,
      detectorImage.sourceWidth,
      detectorImage.sourceHeight,
      profile.dbPostprocess,
    );

    const lines: PpOcrLine[] = [];
    for (const region of regions) {
      const crop = await prepareRecognitionCrop(
        variantUri,
        region,
        profile.recognizerTargetHeight,
        profile.recognizerTargetWidth,
      );
      const input = new ort.Tensor(
        'float32',
        recognizerTensorData(
          crop,
          profile.recognizerTargetWidth,
          profile.tensor,
        ),
        [1, 3, crop.height, profile.recognizerTargetWidth],
      );
      const outputMap = await recognizer.run({
        [recognizer.inputNames[0]]: input,
      });
      const output = outputMap[recognizer.outputNames[0]];
      const shape = tensorShape(output);
      const steps = shape.at(-2);
      const classes = shape.at(-1);
      if (!steps || !classes) continue;
      const decoded = decodeCtc(
        output.data as Float32Array,
        steps,
        classes,
        dictionary,
      );
      if (decoded.text && decoded.confidence >= profile.minLineConfidence) {
        lines.push({
          text: decoded.text,
          confidence: decoded.confidence,
          boundingBox: region.boundingBox,
          cornerPoints: region.cornerPoints,
        });
      }
    }

    return {
      orientation,
      lines,
      regions,
      processingMs: Date.now() - candidateStartedAt,
    };
  };

  const candidates: PpOcrOrientationCandidate[] = [];
  const original = await runOrientationCandidate(0);
  candidates.push(original);
  if (!isGoodOrientationCandidate(original)) {
    for (const orientation of PP_OCR_ORIENTATION_CANDIDATES.slice(1)) {
      candidates.push(await runOrientationCandidate(orientation));
    }
  }
  const best = chooseBestOrientationCandidate(candidates);

  return {
    engine: 'ppocrv5',
    modelVersion: PP_OCR_MODEL_VERSION,
    fullText: best.lines.map(({ text }) => text).join('\n'),
    lines: best.lines,
    processingMs: Date.now() - startedAt,
    orientationDegrees: best.orientation,
    variantsCompared: candidates.length,
    preprocessProfileId: profile.id,
  };
}
