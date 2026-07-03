const fs = require('fs');
const path = require('path');

const { withDangerousMod } = require('@expo/config-plugins');

const PACKAGE_ADD_MARKER = 'add(RouteloAndroidPpocrFrameRecognizerPackage())';

function packageNameToPath(packageName) {
  return packageName.split('.').join(path.sep);
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeFileIfChanged(filePath, contents) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === contents) {
    return;
  }

  fs.writeFileSync(filePath, contents);
}

function patchMainApplication(mainApplicationPath, packageName) {
  if (!fs.existsSync(mainApplicationPath)) {
    throw new Error(
      `Unable to find MainApplication.kt at ${mainApplicationPath}. Run Expo prebuild before applying the Android PP-OCR frame recognizer plugin.`,
    );
  }

  let source = fs.readFileSync(mainApplicationPath, 'utf8');
  const importMarker = `import ${packageName}.ocr.RouteloAndroidPpocrFrameRecognizerPackage`;

  if (!source.includes(importMarker)) {
    source = source.replace(
      new RegExp(`package ${packageName.replace(/\./g, '\\.')}\\r?\\n`),
      (match) => `${match}\n${importMarker}\n`,
    );
  }

  if (!source.includes(PACKAGE_ADD_MARKER)) {
    source = source.replace(
      /PackageList\(this\)\.packages\.apply \{\r?\n/,
      (match) => `${match}          ${PACKAGE_ADD_MARKER}\n`,
    );
  }

  fs.writeFileSync(mainApplicationPath, source);
}

function androidModuleSource(packageName) {
  return `package ${packageName}.ocr

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableNativeMap

class RouteloAndroidPpocrFrameRecognizerModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = NAME

  override fun getConstants(): MutableMap<String, Any> = hashMapOf(
    "bundled" to true,
    "frameBufferRecognitionReady" to false,
    "recognizerId" to "android-native-ppocr",
    "implementationStage" to "native-module-scaffold"
  )

  @ReactMethod
  fun getStatus(promise: Promise) {
    val status = WritableNativeMap()
    status.putBoolean("bundled", true)
    status.putBoolean("frameBufferRecognitionReady", false)
    status.putString("recognizerId", "android-native-ppocr")
    status.putString("implementationStage", "native-module-scaffold")
    status.putString(
      "reason",
      "Android native PP-OCR module is bundled, but direct frame-buffer recognition is not implemented yet."
    )
    promise.resolve(status)
  }

  @ReactMethod
  fun recognizeFrameMetadata(metadata: ReadableMap, promise: Promise) {
    promise.reject(
      "E_ANDROID_PPOCR_FRAME_BUFFER_NOT_IMPLEMENTED",
      "Android native PP-OCR frame-buffer recognition is not implemented yet. The module is intentionally fail-closed until the PP-OCR runtime can process VisionCamera frame buffers directly."
    )
  }

  companion object {
    const val NAME = "RouteloAndroidPpocrFrameRecognizer"
  }
}
`;
}

function androidPackageSource(packageName) {
  return `package ${packageName}.ocr

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class RouteloAndroidPpocrFrameRecognizerPackage : ReactPackage {
  override fun createNativeModules(
    reactContext: ReactApplicationContext
  ): MutableList<NativeModule> = mutableListOf(
    RouteloAndroidPpocrFrameRecognizerModule(reactContext)
  )

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): MutableList<ViewManager<*, *>> = mutableListOf()
}
`;
}

module.exports = function withAndroidPpocrFrameRecognizer(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const androidPackage = config.android?.package;

      if (!androidPackage) {
        throw new Error(
          'android.package is required before adding the Android PP-OCR frame recognizer module.',
        );
      }

      const projectRoot = config.modRequest.platformProjectRoot;
      const javaRoot = path.join(
        projectRoot,
        'app',
        'src',
        'main',
        'java',
        packageNameToPath(androidPackage),
      );
      const ocrRoot = path.join(javaRoot, 'ocr');

      ensureDirectory(ocrRoot);
      writeFileIfChanged(
        path.join(ocrRoot, 'RouteloAndroidPpocrFrameRecognizerModule.kt'),
        androidModuleSource(androidPackage),
      );
      writeFileIfChanged(
        path.join(ocrRoot, 'RouteloAndroidPpocrFrameRecognizerPackage.kt'),
        androidPackageSource(androidPackage),
      );
      patchMainApplication(path.join(javaRoot, 'MainApplication.kt'), androidPackage);

      return config;
    },
  ]);
};
