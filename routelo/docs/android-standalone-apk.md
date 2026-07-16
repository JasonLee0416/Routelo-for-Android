# Android standalone APK build guide

This guide defines the APK path for testing Routelo directly on a Galaxy/Android
device without Expo Go, Metro, or `npx expo start`.

## Target APK behavior

The standalone APK must:

- not require Expo Go;
- not require `npx expo start`;
- not require a Metro development server;
- include the JavaScript bundle and app assets inside the APK;
- open directly into Routelo after installation;
- include camera, OCR model assets, local storage, and notification code paths.

If the app opens the Expo development server screen, the APK is not a valid
standalone test build.

## Build command

From the `routelo` directory:

```bash
npm run build:android:standalone
```

The script performs the same standalone-release path used by CI:

1. exports Android app assets;
2. verifies that PP-OCR ONNX model assets are bundled;
3. regenerates the Android native project with Expo prebuild;
4. builds `:app:assembleRelease` with Gradle;
5. copies the generated APK to the artifact folders below.

For local Galaxy device testing, the Gradle build targets `arm64-v8a`. This is
the correct ABI for modern Galaxy devices and avoids unnecessary 32-bit native
camera/OCR builds.

## Output locations

The APK is copied to both locations:

```text
D:\zxhu12\routelo-artifacts\standalone\
C:\Users\<user>\Desktop\루텔로 최종버전\
```

The file name includes:

- app version;
- OCR profile;
- Git short SHA;
- `standalone-android`.

Example:

```text
Routelo-standalone-android-v1.0.0-stable-mobile-0280ae4.apk
```

## Device install options

### Direct file install

Copy the APK to the Android device, open it from the file manager, and allow
installing unknown apps when prompted.

### USB install

With USB debugging enabled:

```bash
adb install -r path/to/Routelo-standalone-android.apk
```

## Smoke test checklist

After installation, verify:

- Routelo opens directly without the Expo development server screen;
- onboarding/member or guest flow opens;
- bottom navigation does not overlap the Android system navigation area;
- camera permission prompt appears when opening OCR capture;
- OCR screen does not register fabricated data when recognition fails;
- delivery list data persists after app restart;
- fuel/mileage records persist after app restart;
- notification permission and scheduled alert paths are reachable;
- the APK still works while Metro is stopped and the phone is off the
  development Wi-Fi network.
