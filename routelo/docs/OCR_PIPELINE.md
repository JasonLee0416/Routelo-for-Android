# RouteLO OCR Pipeline

> Current architecture: RouteLO uses a pinned PP-OCRv5 detector and Korean
> recognizer through ONNX Runtime React Native. Google ML Kit is no longer a
> production dependency. The shared parser must normalize text into RouteLO
> receipt fields without fabricating unsupported values.

## 1. Production pipeline

```text
Camera / gallery frame
  -> capture quality gate
  -> optional receipt-region crop, rotation, and perspective normalization
  -> on-device PP-OCRv5 detector + Korean recognizer
  -> layout reconstruction
  -> normalizeReceipt / parseReceiptText
  -> field confidence + provenance scoring
  -> optional Google Places vendor verification, default OFF
  -> user review
  -> delivery registration only after user confirmation
```

The first production rule is zero fabrication: missing OCR evidence must remain
missing or review-required. The app must never replace an unavailable OCR value
with a demo fixture, guessed phone number, guessed address, or generated vendor.

## 2. Live camera accumulation

The current Expo flow still captures frames through ImagePicker, so true camera
preview sampling requires a native camera adapter. The app-level accumulator is
already designed around the future native flow:

1. sample an accepted frame;
2. run quality checks;
3. run local OCR;
4. map fields with confidence;
5. update rolling field candidates only when the new evidence is stronger;
6. lock the three minimum scan fields after repeated stable evidence;
7. move to review, not auto-save.

Current implementation status:

- `LiveOcrFrameScanner` accepts frame assets from a future native camera source.
- `liveCameraFrameSourceCapability()` is the platform gate for that source. It
  reports Android/iOS as `native-adapter-missing` until a bundled native preview
  frame adapter is registered, so the app cannot pretend live OCR is available
  while only the ImagePicker still-photo flow exists.
- It enforces a configurable sampling interval, initially suitable for the
  400-700 ms range discussed in #61.
- It rejects poor-quality frames before OCR.
- It keeps only one OCR inference in flight and drops frames under backpressure
  instead of queueing unbounded work.
- It reuses the existing rolling live OCR accumulator and returns `ready` only
  when the review threshold is met.
- It records telemetry for sampled frames, interval skips, backpressure skips,
  quality rejections, OCR runs/failures, accepted frames, promoted fields, and
  last OCR latency.

Still missing: the native camera preview adapter that supplies continuous frame
assets. The adapter must implement the `LiveCameraFrameSource` contract, emit
`LiveOcrFrameAsset` objects into `LiveOcrFrameScanner`, and keep still-photo OCR
as the fallback when preview frames are unavailable. The engine is intentionally
platform-neutral so Android and iOS can use the same accumulation policy once
the adapter exists.

Current implementation direction: use VisionCamera as the first native frame
source candidate. See
`docs/decisions/2026-07-03-live-ocr-frame-source-visioncamera.md` for the
decision record and revisit triggers.

VisionCamera integration status:

- VisionCamera, Nitro Modules, and Nitro Image are installed.
- `inspectVisionCameraLiveOcrReadiness()` can detect platform support, camera
  permission state, and whether a back camera is available.
- `VisionCameraPreviewProbe` can render a dev-only native preview inside the
  scanner when `EXPO_PUBLIC_ROUTELO_ENABLE_VISION_CAMERA_PREVIEW=1` is set.
  This is a device-readiness probe only; it does not feed preview frames into
  OCR yet.
- `VisionCameraPreviewProbe` can also attach a dev-only VisionCamera frame
  output when `EXPO_PUBLIC_ROUTELO_ENABLE_VISION_CAMERA_FRAME_STREAM=1` is set.
  The current stream records frame metadata and dropped-frame telemetry only.
  It intentionally does not convert native buffers into OCR assets, so the app
  cannot invent receipt data from a frame that has not been decoded.
- The app still reports live frame OCR as unavailable until preview frame
  streaming is wired into `LiveOcrFrameScanner`.
- `ImagePicker` still-photo OCR remains the safe fallback.

Minimum live-scan checklist:

- merchant / ordering vendor name;
- address / delivery destination;
- phone number candidate.

Each item starts missing. It becomes a candidate after one strong frame and
locked only after at least two stable supporting frames. Phone candidates must
pass phone-format validation. Lower-confidence different candidates cannot
overwrite stronger existing evidence.

## 3. OCR benchmark loop

The repository benchmark lives outside the mobile bundle:

```text
benchmarks/ocr/receipt-samples/
  images/
  golden/raw_golden_answer_text/
  manifest.json
  scripts/
```

Validation commands:

```bash
cd benchmarks/ocr/receipt-samples
node scripts/validate-dataset.mjs
node scripts/evaluate-text-candidate.mjs \
  --candidate-name golden-self-check \
  --predictions-dir golden/raw_golden_answer_text \
  --max-normalized-cer 0
```

App parser tests now read this golden text dataset and verify both extraction
quality and anti-fabrication behavior.

## 4. OCR accuracy improvement order

Before increasing model size, improve the image and post-processing pipeline:

1. orientation candidates or orientation classification;
2. receipt/paper region detection;
3. perspective-corrected text-line crops;
4. real DB polygon post-processing;
5. field-level accumulation across frames;
6. only then compare larger or alternate OCR models.

This order keeps APK size and device load under control while addressing the
highest-probability causes of Korean receipt OCR failure.

Current implementation status:

- PP-OCR now evaluates the original orientation first.
- If the original result is weak, it evaluates 90, 180, and 270 degree rotation
  candidates and chooses the strongest result by line count, meaningful text
  length, recognizer confidence, and detector region score.
- This is an adaptive fallback, so normal upright receipts avoid the 4x OCR cost.
- Receipt-region detection, four-point perspective crops, and real polygon DB
  post-processing are still the next accuracy layer.

## 5. Field extraction and review rules

- Dates must support both `YYYY-MM-DD` and Korean forms such as
  `2026년 06월 14일`.
- Times must support `HH:mm` and Korean forms such as `12시20분`.
- Event time is extracted from explicit event/wedding labels such as `예식`.
- Product quantity can come from `수량`, `개`, or flower stand expressions such
  as `축하3단`.
- Phone fields require a valid Korean mobile or landline pattern.
- Recipient phone ownership is never inferred from an unlabeled phone line.
- Address and vendor values remain review-required unless confidence and source
  evidence are strong.

Review UI remains responsible for final user confirmation, correction, vendor
verification display, and save.

## 6. Google Places vendor verification

Vendor verification is optional and default OFF. When enabled, the provider is
Google Places via `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY`.

Network guardrails:

- send only a sanitized business-name query;
- reject mixed OCR lines containing phone/address/recipient-looking fragments;
- attach verification as provenance only;
- never auto-select or auto-overwrite user-visible receipt fields.

## 7. Privacy

- Preserve raw OCR text only when the privacy setting allows it.
- Keep source evidence lines for review and debugging.
- Do not send recipient names, recipient phones, full addresses, or mixed OCR
  blocks to external vendor verification.
- Treat benchmark images in the repository as fictional test material.
