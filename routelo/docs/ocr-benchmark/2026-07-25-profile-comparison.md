# RouteLO PP-OCR 오프라인 프로파일 비교 (2026-07-25)

## 목적 (#99)
기기 없이 8장 골든 영수증에 **현재 프로덕션 파이프라인**을 돌려 전처리
프로파일들의 문자 정확도(CER)를 비교한다. 어느 프로파일을 기본으로 둘지
데이터로 좁히기 위함(최종 승격 판정은 실기기).

## 러너
`benchmarks/ocr/receipt-samples/scripts/run-routelo-ppocr.mjs`
(`npm run routelo:run -- --profile <id>`)

- 앱과 **동일한 ONNX 모델·한국어 사전**을 사용.
- DB 후처리·원근 워프·CTC 디코딩(NFC 포함)은 **프로덕션 TS 모듈을 그대로 import**
  하고, 프로파일별 `dbPostprocess` 옵션도 앱과 동일하게 넘긴다. `onnxruntime-node`로 실행.
- 평가는 기존 `scripts/evaluate-text-candidate.mjs`(정규화 CER) 재사용.

## 결과 (3 프로파일, dbPostprocess 프로파일 옵션까지 정합)

| 프로파일 | detectorMaxSide | 정규화 CER↓ | 토큰 커버리지↑ | 빈 결과율 |
|---|---|---|---|---|
| stable-mobile (현재 기본) | 960 | 0.8807 | 0.1977 | 0.0000 |
| **high-res-preprocess** | 1536 | **0.8451** | **0.2435** | 0.0000 |
| ocr-recovery-test | 1920 | 0.8494 | 0.2322 | **0.1250** |

프로파일 파라미터: `stable-mobile` recWidth=320/minConf=0.35,
`high-res-preprocess` recWidth=480/minConf=0.48+조명정규화,
`ocr-recovery-test` recWidth=640/minConf=0.22+조명정규화.

> **정합 주의:** 초기 측정(dbPostprocess 미반영)에선 high-res CER이 0.7944로
> 낙관적으로 나왔으나, 프로파일별 DB 후처리 옵션까지 앱과 정합시키자 0.8451로
> 교정됐다. 상대 순위(high-res 최선)는 유지된다.

## 해석
1. **high-res-preprocess가 최선이다.** 3개 중 CER 최저·커버리지 최고이며 빈
   결과 없음. 검출기 960→1536px + 조명 정규화가 실효를 낸다. 최소 신뢰도를
   0.35→0.48로 **더 엄격히** 했음에도 이겼다(오탐이 아닌 실제 인식 향상).
   #84 P0-D(960px에서 작은 한글 손실) 가설이 데이터로 확인됨.
2. **더 공격적인 프로파일은 역효과.** `ocr-recovery-test`(1920px, minConf 0.22)는
   해상도를 더 올렸는데도 high-res보다 나쁘고, **8장 중 1장이 완전 실패**(빈
   결과율 12.5%). 해상도·완화 임계값을 무작정 키우면 오히려 손해.
3. **그래도 ML Kit보다 약하다.** ML Kit 한국어 베이스라인은 CER 0.6173 /
   커버리지 0.8468(#106, 네이티브 실측). high-res로도 격차가 크다.

## 주의 (근사치 한계)
- 이 러너의 **이미지 리사이즈는 앱의 네이티브 경로(`expo-image-manipulator`)와
  다르고**(jpeg-js + 순수 JS 이중선형), 조명 정규화도 앱의 채널별 stats 방식을
  이미지 단 근사로 대체한다. 따라서 **절대 CER은 실기기와 다를 수 있다.**
- 프로파일 간 상대 비교(동일 러너)는 방향성 판단에 유효하나, ML Kit 네이티브
  수치와의 직접 비교는 참고용이다.
- **프로파일 승격 최종 판정은 갤럭시 실기기에서 같은 영수증으로 확정한다.**

## 다음 단계
1. 데이터가 `high-res-preprocess`를 지지하고 `ocr-recovery-test`는 배제한다.
   → **실기기에서 stable vs high-res 비교** 후 기본 승격 여부 결정.
2. 촬영 자체 해상도 향상(Tier 1-A)은 `expo-image-picker`로는 제한적이라
   VisionCamera 도입과 함께 별도로 다룬다.
3. 엔진 격차(vs ML Kit)는 프로파일 튜닝만으로는 못 좁히므로, 그 다음은 촬영
   품질·크롭/디스큐·조명 보정을 더 파야 한다.
