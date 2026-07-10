# Routelo OCR engine guidelines

This document is the working guideline for rebuilding Routelo OCR around
official engine behavior instead of undocumented assumptions.

## Baseline principle

Routelo must not treat OCR text as trusted delivery data. A recognized line can
be promoted to a delivery field only when both conditions are true:

1. The OCR engine returned direct evidence for the text.
2. Field-specific validation agrees with the field type.

Examples:

- A phone field must match a Korean phone-number pattern.
- An address field must contain Korean address evidence such as city/district
  and road/building detail.
- A vendor field must not contain phone labels, phone numbers, address labels,
  product names, or recipient labels.
- A product field that does not contain known floral-delivery product evidence
  remains review-only.

If a required field fails validation, Routelo must leave it empty and ask for
review/manual input instead of showing fabricated data.

## Official-engine comparison order

Use the same receipt image across all candidates before changing the app engine.

1. Google ML Kit Text Recognition v2 Korean on-device baseline.
2. Official PaddleOCR / PP-OCR pipeline baseline.
3. Current Routelo on-device PP-OCR ONNX path.
4. User-consented cloud fallback when required fields are missing:
   - NAVER Cloud CLOVA OCR Template for repeated receipt layouts.
   - Google Cloud Vision OCR or Google Document AI for benchmark/fallback
     experiments.

## Why this matters

The current Android test showed high-confidence text fragments being mapped to
the wrong field. Confidence from OCR recognition alone is not sufficient. The
field parser must verify semantic evidence before a value becomes visible as an
accepted delivery field.

## Capture and frame requirements

Follow the official mobile OCR guidance:

- Capture enough pixels for small printed text.
- Reject blurred or low-coverage captures before parsing.
- Prefer stable repeated evidence from multiple frames over a single frame.
- Keep raw OCR lines, bounding boxes, and rejected candidates for debugging.

## Implementation policy

- The app can keep PP-OCR as an on-device candidate, but app changes must be
  benchmarked against official PaddleOCR output before claiming improvement.
- ML Kit v2 Korean should be used as the Android on-device baseline candidate
  for comparison because it provides block, line, element, and symbol structure.
- Cloud OCR is opt-in only and should be invoked only when local OCR misses
  required fields or the user explicitly requests improved recognition.

## References

- Google ML Kit Text Recognition v2 Android:
  https://developers.google.com/ml-kit/vision/text-recognition/v2/android
- ML Kit supported languages:
  https://developers.google.com/ml-kit/vision/text-recognition/v2/languages
- PaddleOCR PP-OCRv5 multilingual:
  https://paddlepaddle.github.io/PaddleOCR/main/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.html
- PaddleOCR general OCR pipeline:
  https://paddlepaddle.github.io/PaddleOCR/main/en/version3.x/pipeline_usage/OCR.html
- NAVER Cloud CLOVA OCR Template:
  https://guide.ncloud-docs.com/docs/en/clovaocr-template
- Google Cloud Vision OCR:
  https://docs.cloud.google.com/vision/docs/ocr
- Google Document AI:
  https://cloud.google.com/document-ai
