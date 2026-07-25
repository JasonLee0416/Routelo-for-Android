# OCR ROI heuristic sweep — 2026-07-25

## Experiment

- Dataset: `routelo-receipt-samples-2026-06-21`
- Samples: 8 checked-in receipt images
- OCR input: recorded Android Korean ML Kit line text + bounding boxes from `routelo/docs/ocr-benchmark/2026-06-23/native-results.json`
- Method: axis-aligned label-to-value field-distance heuristic sweep
- Constants searched: 243
- Scope: parser/schema recovery only. This does not re-run Android native ML Kit or native PP-OCR on the server.

## Best constants

```json
{
  "sameRowYRatio": 0.018,
  "xLeftSlackRatio": 0.015,
  "xRightGrowRatio": 0.55,
  "yUpSlackRatio": 0.12,
  "yDownGrowRatio": 0.07,
  "maxCandidatesPerAnchor": 3
}
```

## Aggregate result

| Metric | Baseline parser | Best ROI heuristic | Delta |
| --- | ---: | ---: | ---: |
| Required fields populated | 13/24 | 24/24 | +11 |
| Observed fields populated | 21 | 50 | +29 |
| Loose golden field hits | 12 | 29 | +17 |
| Average document confidence | 45.75 | 83.25 | +37.5 |

## Per-sample result

| Sample | Baseline required | ROI required | Baseline populated | ROI populated | Baseline loose hits | ROI loose hits | ROI missing required |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| KakaoTalk_20260621_070828835.jpg | 1/3 | 3/3 | 3 | 6 | 2 | 3 | - |
| KakaoTalk_20260621_070828835_01.jpg | 1/3 | 3/3 | 2 | 6 | 0 | 3 | - |
| KakaoTalk_20260621_070828835_02.jpg | 3/3 | 3/3 | 4 | 6 | 3 | 5 | - |
| KakaoTalk_20260621_070828835_03.jpg | 3/3 | 3/3 | 4 | 8 | 3 | 4 | - |
| KakaoTalk_20260621_070828835_04.jpg | 2/3 | 3/3 | 3 | 6 | 1 | 2 | - |
| KakaoTalk_20260621_070828835_05.jpg | 0/3 | 3/3 | 0 | 5 | 0 | 3 | - |
| KakaoTalk_20260621_070828835_06.jpg | 1/3 | 3/3 | 3 | 7 | 2 | 5 | - |
| KakaoTalk_20260621_070828835_07.jpg | 2/3 | 3/3 | 2 | 6 | 1 | 4 | - |

## Interpretation

The current OCR engine already returns usable line boxes for many labels such as product, quantity, delivery date, and delivery address. The weak point is converting those noisy, table-like line boxes into the canonical receipt schema. The ROI heuristic improves recovery by reading values near label anchors instead of relying only on plain text line order.

The heuristic remains conservative: it fills missing or warning fields only when the source line is present in OCR output and the normalized candidate survives the existing guardrails. It should therefore reduce schema drop-off without pretending that unrecognized text was successfully read.

## Known limitations

- This experiment proves parser/schema recovery, not a new native OCR engine result.
- Required fields reached full population in the recorded baseline, but some optional fields still show review-grade false positives, especially vendor name, recipient name, and memo.
- Production UX should keep these spatially recovered values in review state unless confidence and field-specific evidence are both strong.
- Remaining OCR accuracy work should focus on native capture input quality, deskew/crop correctness, and better Korean recognizer output before auto-registration thresholds are relaxed.
