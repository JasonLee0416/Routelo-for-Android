# OCR Hypothesis Report — 2026-07-24

This report tests the current OCR failure hypotheses against the checked-in receipt sample dataset before another manual Galaxy APK test.

## Dataset

- Dataset: `routelo-receipt-samples-2026-06-21`
- Samples: 8
- Images: `benchmarks/ocr/receipt-samples/images`
- Golden text: `benchmarks/ocr/receipt-samples/golden/raw_golden_answer_text`
- Recorded native baseline: `routelo/docs/ocr-benchmark/2026-06-23/native-results.json`
- Current parser: `routelo/app/services/ocr.ts::parseReceiptText`

## Summary

- Quality pass count: **8/8**
- Recorded ML Kit non-empty count: **8/8**
- Average recorded ML Kit CER: **0.6025**
- Average recorded ML Kit token coverage: **0.851**
- Average current parser populated fields: **3.5**
- Samples missing at least two required fields after current parsing: **4/8**
- Quality false-positive candidates: **4/8**

## Hypothesis Status

| ID | Hypothesis | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Diagnostic/engine flags are not reliably reflected in release APKs | needs-apk-runtime-probe | This Node report cannot inspect an installed APK runtime, but it establishes the baseline that checked-in images have non-empty ML Kit results. Device 0/3 therefore needs runtime config visibility in-app. |
| 2 | Captured image and OCR input image may differ | partially-tested | This report records original and prepared dimensions/file data for repository samples. The APK should display the same kind of image facts and OCR input preview. |
| 3 | PP-OCR preprocessing/detection is failing | native-only-blocker | The checked-in server/runtime entrypoint intentionally throws outside Android/iOS, while the native implementation depends on React Native/Expo image APIs and onnxruntime-react-native rather than a Node OCR runner. |
| 4 | Quality gate is not predictive of OCR success | supported | 4/8 samples passed quality but still missed at least two required parser fields or had empty OCR text. |
| 5 | Android Korean Text can read samples but app cannot use the result | supported | 8/8 recorded ML Kit baseline samples produced non-empty text. |
| 6 | Parser fails to map raw OCR text into required fields | supported | 4/8 samples are missing at least two required fields after current parser processing. |

## Sample Results

| Sample | Image | Prepared | Quality | ML Kit text | CER | Token coverage | Parser fields | Missing required | Labels |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| KakaoTalk_20260621_070828835.jpg | 4000x3000 | 2400x1800 normalized | 71 pass | 421 chars / 41 lines | 0.5741 | 0.6849 | 3 | deliveryDate, deliveryAddress | QUALITY_GATE_FALSE_POSITIVE, PARSER_MAPPING_FAILURE, PPOCR_NATIVE_ONLY_BLOCKER |
| KakaoTalk_20260621_070828835_01.jpg | 4000x3000 | 2400x1800 normalized | 81 pass | 343 chars / 33 lines | 0.6096 | 0.9306 | 4 | deliveryDate, deliveryAddress | QUALITY_GATE_FALSE_POSITIVE, PARSER_MAPPING_FAILURE, PPOCR_NATIVE_ONLY_BLOCKER |
| KakaoTalk_20260621_070828835_02.jpg | 4000x3000 | 2400x1800 normalized | 83 pass | 461 chars / 34 lines | 0.4704 | 0.9326 | 5 | - | PPOCR_NATIVE_ONLY_BLOCKER |
| KakaoTalk_20260621_070828835_03.jpg | 4000x3000 | 2400x1800 normalized | 75 pass | 432 chars / 34 lines | 0.621 | 0.925 | 5 | - | PPOCR_NATIVE_ONLY_BLOCKER |
| KakaoTalk_20260621_070828835_04.jpg | 4000x3000 | 2400x1800 normalized | 70 pass | 416 chars / 39 lines | 0.6088 | 0.7949 | 3 | deliveryAddress | PPOCR_NATIVE_ONLY_BLOCKER |
| KakaoTalk_20260621_070828835_05.jpg | 4000x3000 | 2400x1800 normalized | 78 pass | 409 chars / 37 lines | 0.7301 | 0.7308 | 0 | deliveryDate, productName, deliveryAddress | QUALITY_GATE_FALSE_POSITIVE, PARSER_MAPPING_FAILURE, PPOCR_NATIVE_ONLY_BLOCKER |
| KakaoTalk_20260621_070828835_06.jpg | 4000x3000 | 2400x1800 normalized | 83 pass | 450 chars / 38 lines | 0.6816 | 0.8824 | 4 | deliveryDate, deliveryAddress | QUALITY_GATE_FALSE_POSITIVE, PARSER_MAPPING_FAILURE, PPOCR_NATIVE_ONLY_BLOCKER |
| KakaoTalk_20260621_070828835_07.jpg | 4000x3000 | 2400x1800 normalized | 81 pass | 396 chars / 37 lines | 0.5245 | 0.9268 | 4 | deliveryDate | PPOCR_NATIVE_ONLY_BLOCKER |

## PP-OCR Server Probe

- Status: **native-only-blocker**
- Can run on this Node server: **no**
- Blocking imports: `onnxruntime-react-native`, `expo-asset`, `expo-image-manipulator`, `react-native Image.getSize`
- Reason: The checked-in server/runtime entrypoint intentionally throws outside Android/iOS, while the native implementation depends on React Native/Expo image APIs and onnxruntime-react-native rather than a Node OCR runner.
- Next action: Use the Android APK or an emulator instrumentation harness for PP-OCR runtime numbers; keep Node reports focused on image prep, ML Kit recorded baseline, and parser regression.

## Interpretation

The repository samples already have non-empty recorded ML Kit Korean text output, but current parser mapping still misses at least two required fields on 4/8 samples. This supports two parallel conclusions:

1. The Galaxy APK showing 0/3 likely needs runtime/input-path visibility first, because the repository baseline proves the samples are not universally unreadable.
2. Even when OCR text exists, parser mapping is still too weak for automatic registration and should remain guarded by manual review.

