# Android performance and motion guide

This guide defines the Android UX/performance rules for Routelo. The target is
a standalone release APK on a physical Galaxy/Android device, not Expo Go and
not a Metro development server.

## Goals

- Keep interactions responsive on Android devices.
- Avoid jank in navigation, list scrolling, bottom sheets, OCR entry, and search.
- Use motion only to clarify state changes, not as decoration.
- Respect Android reduce-motion accessibility settings.
- Prefer measurable release-build behavior over development-build impressions.

## Motion rules

- Use short, consistent motion durations:
  - quick state changes: about 140 ms;
  - normal layout changes: about 220 ms;
  - sheet/modal expansion: about 260 ms.
- Prefer opacity and transform-based motion.
- Avoid animating width, height, top, left, heavy shadows, or blur every frame.
- Do not add motion to dense data cards unless it helps explain a change.
- If reduce motion is enabled, skip large layout transitions.

## Rendering rules

- Use `FlatList` or `SectionList` for screens that can grow with delivery,
  receipt, district, notification, or finance records.
- Avoid `ScrollView + map` for long data sets.
- Memoize expensive cards and render callbacks where practical.
- Keep list item components stable with `keyExtractor`, `React.memo`,
  `useMemo`, and `useCallback` where appropriate.
- Use conservative list settings first:
  - `initialNumToRender`: 8-12;
  - `maxToRenderPerBatch`: 8-12;
  - `windowSize`: 7-9;
  - `removeClippedSubviews`: enabled on Android after visual verification.

## Heavy work rules

- Do not start OCR model loading, image processing, vendor verification, file
  export, or backup parsing during the first render unless that screen needs it
  immediately.
- Keep OCR frame/image processing off the normal render path.
- When recognition is uncertain, fail safely into review/manual input rather
  than filling fabricated data.

## Release APK validation

Build a standalone APK:

```bash
npm run validate
npm run build:android:standalone
```

Install it:

```bash
adb install -r "C:\Users\zxhu12\Desktop\루텔로 최종버전\Routelo-standalone-android.apk"
```

Confirm it does not need Metro:

```bash
adb shell am force-stop com.jasonlee0312.routelo
adb shell am start -W com.jasonlee0312.routelo/.MainActivity
```

Check frame rendering:

```bash
adb shell dumpsys gfxinfo com.jasonlee0312.routelo reset
adb shell dumpsys gfxinfo com.jasonlee0312.routelo framestats
```

Inspect the APK:

```bash
aapt dump badging Routelo-standalone.apk
```

The APK must contain:

```text
assets/index.android.bundle
res/*.onnx
lib/arm64-v8a/
```

## Suggested engineering prompt

```text
Routelo Android 앱을 standalone release APK 기준으로, Android Vitals/React Native 공식 성능 원칙에 맞춰 jank 없는 실기기 UX로 최적화해줘. 애니메이션은 Material motion 기반의 짧고 기능적인 전환만 사용하고, FlatList 최적화·Hermes·reduce motion·GPU overdraw·adb gfxinfo 검증까지 포함해줘.
```

## Current app baseline

- Bottom navigation uses color-only active state.
- Today’s Delivery uses virtualized `FlatList` for searchable/sortable records.
- Shared layout motion uses a reduce-motion aware helper.
- Standalone APK build copies installable artifacts to:
  - `D:\zxhu12\routelo-artifacts\standalone\`
  - `C:\Users\zxhu12\Desktop\루텔로 최종버전\`
