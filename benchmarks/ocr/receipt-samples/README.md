# RouteLO OCR receipt sample benchmark

This benchmark dataset is intentionally kept outside `routelo/app` and
`routelo/assets` so it is not bundled into the mobile application.

It contains photographed receipt samples and model-readable golden text files
for OCR pipeline development. The current golden text is `raw_golden_answer_text`:
human-readable line-level text that should be recognized from each image.

Some source images are rotated, skewed, folded, or partially occluded. When a
glyph is not reliably readable from the image, the golden text uses `[불명]`.
Benchmark code should treat those spans as human-review placeholders rather
than exact OCR targets.

## Layout

```text
benchmarks/ocr/receipt-samples/
  images/
    KakaoTalk_20260621_070828835.jpg
    ...
  golden/raw_golden_answer_text/
    KakaoTalk_20260621_070828835.txt
    ...
  manifest.json
  scripts/validate-dataset.mjs
```

## Validate

```bash
cd benchmarks/ocr/receipt-samples
node scripts/validate-dataset.mjs
node scripts/evaluate-text-candidate.mjs \
  --candidate-name golden-self-check \
  --predictions-dir golden/raw_golden_answer_text \
  --max-normalized-cer 0
```

The validator checks that every manifest image exists, has a matching raw
golden text file, and records the expected SHA-256 for reproducibility.

## Evaluate A Candidate

Create a prediction directory with one `.txt` file per image stem:

```text
tmp/ocr-runs/my-candidate/
  KakaoTalk_20260621_070828835.txt
  KakaoTalk_20260621_070828835_01.txt
  ...
```

Then run:

```bash
node scripts/evaluate-text-candidate.mjs \
  --candidate-name my-candidate \
  --predictions-dir ../../../tmp/ocr-runs/my-candidate
```

The evaluator reports:

- `emptyResultRate`: how often the OCR path returned no useful text.
- `normalizedCer`: character error rate after whitespace normalization and
  `[불명]` removal.
- `averageTokenCoverage`: rough token recall for business-facing receipt text.

The script also accepts JSON predictions with `fullText`, `text`, or `lines`.

## Candidate Strategy

See `model-candidates.json` and `performance-gates.json`.

The recommended first experiment is **not** a larger model. It is the current
PP-OCRv5 mobile model plus structural fixes:

1. orientation candidates or orientation classification;
2. real DB polygon post-processing;
3. perspective-correct text-line crops;
4. then model-size comparisons only if the corrected crop pipeline still misses
   dense Korean receipt text.

Video-frame accumulation is also a first-class workflow candidate: sample
preview frames during capture, run lightweight local OCR on stable frames, and
only fill fields after repeated high-confidence evidence. This can improve
quality without increasing the shipped model.
