# OCR profile APK builds

RouteLO keeps the stable PP-OCR preprocessing path as the default. Experimental
OCR preprocessing must be built explicitly so noisy recognition changes do not
silently reach normal test APKs.

## Profiles

| Profile | Use | Build behavior |
|---|---|---|
| `stable-mobile` | Default smoke/release-candidate testing | Detector max side 960, recognizer width 320, no illumination normalization |
| `high-res-preprocess` | Issue #84 OCR experiment APKs | Detector max side 1536, recognizer width 480, illumination normalization enabled, stricter line confidence gate |

## Build from GitHub Actions

1. Open **Actions → Android → Run workflow**.
2. Choose the branch to build.
3. Set `ocr_profile`:
   - `stable-mobile` for regular APK checks.
   - `high-res-preprocess` for the guarded OCR experiment.
4. Set `apk_kind`:
   - `standalone-release` for direct Galaxy/USB testing without Metro.
   - `development-debug` only when you intentionally want Expo Dev Client + Metro.
5. Download the artifact:
   - `routelo-standalone-release-stable-mobile-<sha>`
   - `routelo-standalone-release-high-res-preprocess-<sha>`
   - or, for Metro/dev-client testing only:
     `routelo-development-debug-<profile>-<sha>`

The workflow bakes the selected profile into the bundle with:

```bash
EXPO_PUBLIC_ROUTELO_OCR_PROFILE=<profile>
```

The workflow also sets:

```bash
ROUTELO_APK_KIND=<standalone-release|development-debug>
```

If an installed APK opens the Expo Development Build launcher and asks for
`npx expo start`, it is a `development-debug` APK, not a standalone test APK.
Use `standalone-release` for normal device testing.

## Local build

From `routelo/`:

```powershell
$env:EXPO_PUBLIC_ROUTELO_OCR_PROFILE='high-res-preprocess'
npx expo export --platform android --output-dir dist-android
npx expo prebuild --platform android --clean --no-install
./android/gradlew -p android :app:assembleRelease --no-daemon
```

For the default app path, omit the environment variable or set:

```powershell
$env:EXPO_PUBLIC_ROUTELO_OCR_PROFILE='stable-mobile'
```

## Benchmark note

Do not promote `high-res-preprocess` to the default profile based on token
coverage alone. Issue #84 showed that wider/high-resolution OCR can read more
tokens while also increasing noisy strings. Promotion requires field-level
accuracy improvement and no increase in false-positive auto-registration risk.
