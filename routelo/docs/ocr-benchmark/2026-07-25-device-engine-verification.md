# 실기기 OCR 엔진 판정 — PP-OCR primary vs ML Kit primary (2026-07-25)

## 목적
어느 온디바이스 엔진을 **주 엔진(primary)** 으로 둘지 실기기에서 판정한다.
오프라인 벤치마크(#99)는 이미지 리사이즈·조명 정규화가 네이티브와 달라
근사치임이 확인됐으므로, 최종 판정은 실기기에서 한다.

## 환경
- 기기: Galaxy S26 Ultra (SM-S948N, Android 16)
- 방식: CI로 프로파일별 standalone-release APK 빌드 → adb 설치 → 갤러리에
  골든셋 인수증(한국직거래화훼센터 / 아뜰리에몽플라워)을 넣어 OCR
- 비교 대상 APK
  - `high-res-preprocess` → `primary=ppocrv5` (PP-OCR 주 엔진)
  - `ocr-recovery-test` → `primary=android-korean-text` (온디바이스 한국어 엔진
    주 엔진, 진단·엔진비교 on)

## 결과

### high-res APK (PP-OCR primary)
- 같은 인수증 OCR → **필수 인식 0/3** (상호명·주소·전화 모두 미인식)

### ocr-recovery-test APK — 엔진 비교 진단 (같은 인수증)

| 엔진 | 상태 | 지표 | 출력(발췌) |
|---|---|---|---|
| PP-OCRv5 local | **no-text · 0 fields** | regions=12, lines=5, text=45 | `cYamnllowbl 했국아뜰리에몸 그보서기하그다에이 …` (깨짐) |
| 온디바이스 한국어(ML Kit) | **success · 6 fields** | regions=35, lines=39, text=405 | `… 한국직거래화훼센터 인수증 본부팩스:1599-0028 본부전화:1566-0028 주처 아뜰리에동플라워 …` |

같은 이미지·같은 전처리(prepared 2400×1800)에서 PP-OCR은 텍스트를 사실상
못 뽑고(45자, 깨짐), 온디바이스 한국어 엔진은 정상 인식(405자, 6필드)했다.

## 결론
**실기기 네이티브 경로에서 PP-OCR primary는 실패하고 온디바이스 한국어 엔진만
작동한다.** 따라서 기본 `primaryEngine`을 `android-korean-text`로 둔다
(`app/config/ocrRuntimeConfig.ts`). PP-OCR은 참조/opt-in으로 유지하며
`EXPO_PUBLIC_ROUTELO_OCR_ENGINE=ppocrv5`로 강제할 수 있다.

- 프로파일 승격(#99, #120)·PP-OCR 오프라인 CER 비교는 **PP-OCR 참조 경로**의
  품질만 다룬다. 실사용 인식률은 주 엔진이 결정하므로, 이 전환이 사용자 체감
  인식률을 좌우한다.

## 부수 발견 (별도 개선 후보)
- **밝기 품질 게이트가 과노출 스캔본을 감점.** `scoreBrightness`는 mean
  luminance의 이상값을 0.66으로 두고 `|mean-0.66|`을 감점한다. 흰 배경이 큰
  스캔/캡처 문서는 mean이 0.9+로 나와 "밝기 부족"이 아니라 **과노출**로 감점돼
  갤러리 OCR이 시작조차 안 될 수 있다. (본 판정에서는 인수증을 mean 0.66으로
  조정해 게이트를 통과시켜 확인했다.) 실사용 갤러리 경로의 게이트 문구·임계
  재검토가 필요하다.
