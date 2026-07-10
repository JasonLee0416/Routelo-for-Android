# OCR official-engine baseline result — 2026-07-10

## Scope

This document records the first reproducible result for issue #99 using the
existing RouteLO receipt benchmark dataset.

- Dataset: `benchmarks/ocr/receipt-samples`
- Images: 8 Korean delivery receipt samples
- Golden text: `golden/raw_golden_answer_text`
- Evaluation script: `scripts/evaluate-text-candidate.mjs`

## Executed baseline

The available executable official-engine baseline was the previously captured
Android ML Kit Korean result:

- Engine: `com.google.mlkit:text-recognition-korean:16.0.1`
- Device: Android emulator, API 35
- Source file: `routelo/docs/ocr-benchmark/2026-06-23/native-results.json`

The native result JSON was exported into the benchmark prediction format with:

```bash
cd benchmarks/ocr/receipt-samples
npm run official:export-native -- \
  --source ../../../routelo/docs/ocr-benchmark/2026-06-23/native-results.json \
  --output-dir ../../../tmp/ocr-runs/mlkit-v2-korean-2026-06-23

node scripts/evaluate-text-candidate.mjs \
  --candidate-name mlkit-v2-korean-2026-06-23 \
  --predictions-dir ../../../tmp/ocr-runs/mlkit-v2-korean-2026-06-23
```

## Result summary

| Candidate | Samples | Empty result rate | Normalized CER | Average token coverage |
|---|---:|---:|---:|---:|
| Golden self-check | 8 | 0.0000 | 0.0000 | 1.0000 |
| ML Kit v2 Korean | 8 | 0.0000 | 0.6173 | 0.8468 |

Per-image ML Kit results:

| Image | Normalized CER | Token coverage |
|---|---:|---:|
| `KakaoTalk_20260621_070828835.jpg` | 0.5741 | 0.6849 |
| `KakaoTalk_20260621_070828835_01.jpg` | 0.6778 | 0.9194 |
| `KakaoTalk_20260621_070828835_02.jpg` | 0.4781 | 0.9318 |
| `KakaoTalk_20260621_070828835_03.jpg` | 0.6210 | 0.9250 |
| `KakaoTalk_20260621_070828835_04.jpg` | 0.6391 | 0.7838 |
| `KakaoTalk_20260621_070828835_05.jpg` | 0.7301 | 0.7308 |
| `KakaoTalk_20260621_070828835_06.jpg` | 0.6816 | 0.8824 |
| `KakaoTalk_20260621_070828835_07.jpg` | 0.5531 | 0.9167 |

## Interpretation

ML Kit returned non-empty OCR text for all 8 images, so it is not an
empty-output failure. However, `0.6173` normalized CER is too high to trust raw
OCR as delivery data. This supports the current RouteLO guardrail direction:

- keep zero-fabrication field validation;
- require address candidate verification before routing/accounting;
- keep user review for required receipt fields;
- compare current RouteLO PP-OCR ONNX and official PaddleOCR before replacing
  the engine.

## Not executed in this environment

### Official PaddleOCR / PP-OCR

This local Windows environment did not have a usable official PaddleOCR runtime:

- `pip` was not available on `PATH`;
- `py` launcher was not available;
- `docker` was not available;
- `python` resolved to a WindowsApps alias, not a working package environment.

### Current RouteLO PP-OCR ONNX batch

The current RouteLO recognizer runs inside the Expo/React Native native runtime.
No Android device was connected during this run:

```text
adb devices -l
List of devices attached
```

## Next action

Add a reproducible Android batch benchmark runner for the current RouteLO
PP-OCR recognizer, and add a CI or D-drive Python environment for official
PaddleOCR. Issue #99 should remain open until at least these three candidates
are comparable on the same images:

1. ML Kit v2 Korean — evaluated here.
2. Official PaddleOCR / PP-OCR — pending runtime.
3. Current RouteLO PP-OCR ONNX — pending native batch runner or connected device.
