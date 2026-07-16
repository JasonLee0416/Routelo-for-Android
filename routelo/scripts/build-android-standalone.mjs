import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);

function existingPath(value) {
  return value && fs.existsSync(value) ? value : undefined;
}

function resolveJavaHome() {
  const candidates = [
    process.env.JAVA_HOME,
    'D:\\Android\\Android Studio\\jbr',
    'C:\\Program Files\\Android\\Android Studio\\jbr',
    'D:\\Java\\jdk-17',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Java',
  ];
  for (const candidate of candidates) {
    const found = existingPath(candidate);
    if (!found) continue;
    const stat = fs.statSync(found);
    if (!stat.isDirectory()) continue;
    const javaExe = path.join(found, 'bin', isWindows ? 'java.exe' : 'java');
    if (fs.existsSync(javaExe)) return found;
    const nested = fs
      .readdirSync(found, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(found, entry.name))
      .find((entryPath) =>
        fs.existsSync(path.join(entryPath, 'bin', isWindows ? 'java.exe' : 'java')),
      );
    if (nested) return nested;
  }
  return undefined;
}

const javaHome = resolveJavaHome();
if (javaHome) {
  console.log(`Using JAVA_HOME=${javaHome}`);
} else {
  console.warn('JAVA_HOME could not be resolved automatically.');
}

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: {
      ...process.env,
      ...(javaHome
        ? {
            JAVA_HOME: javaHome,
            PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
          }
        : {}),
      NODE_ENV: process.env.NODE_ENV ?? 'production',
      EXPO_PUBLIC_ROUTELO_OCR_PROFILE:
        process.env.EXPO_PUBLIC_ROUTELO_OCR_PROFILE ?? 'stable-mobile',
    },
    shell: isWindows,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function shortSha() {
  const result = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], {
    cwd: root,
    shell: isWindows,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : 'nogit';
}

function verifyBundledOcrModels() {
  const metadataPath = path.join(root, 'dist-android', 'metadata.json');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const assets = metadata.fileMetadata?.android?.assets ?? [];
  const models = assets.filter((asset) => asset.ext === 'onnx');
  if (models.length < 2) {
    throw new Error(
      `Expected at least 2 bundled ONNX OCR models, found ${models.length}.`,
    );
  }
  console.log(
    `Bundled OCR models verified: ${models.map((asset) => asset.path).join(', ')}`,
  );
}

function findReleaseApk() {
  const releaseDir = path.join(
    root,
    'android',
    'app',
    'build',
    'outputs',
    'apk',
    'release',
  );
  const apks = fs
    .readdirSync(releaseDir)
    .filter((file) => file.endsWith('.apk'))
    .map((file) => path.join(releaseDir, file));
  if (!apks.length) {
    throw new Error(`No release APK found in ${releaseDir}`);
  }
  return apks[0];
}

function copyArtifact(apkPath) {
  const version = packageJson.version ?? '0.0.0';
  const profile = process.env.EXPO_PUBLIC_ROUTELO_OCR_PROFILE ?? 'stable-mobile';
  const name = `Routelo-standalone-android-v${version}-${profile}-${shortSha()}.apk`;
  const artifactDir = path.join('D:', 'zxhu12', 'routelo-artifacts', 'standalone');
  const desktopDir = path.join(os.homedir(), 'Desktop', '루텔로 최종버전');
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.mkdirSync(desktopDir, { recursive: true });
  const artifactPath = path.join(artifactDir, name);
  const desktopPath = path.join(desktopDir, name);
  fs.copyFileSync(apkPath, artifactPath);
  fs.copyFileSync(apkPath, desktopPath);
  console.log('\nStandalone APK created successfully.');
  console.log(`Primary artifact: ${artifactPath}`);
  console.log(`Desktop copy: ${desktopPath}`);
}

run('npx', ['expo', 'export', '--platform', 'android', '--output-dir', 'dist-android']);
verifyBundledOcrModels();
run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean', '--no-install']);
fs.rmSync(
  path.join(root, 'node_modules', 'react-native-vision-camera-worklets', 'android', '.cxx'),
  { recursive: true, force: true },
);
run(isWindows ? 'gradlew.bat' : './gradlew', [
  ':app:assembleRelease',
  '-PreactNativeArchitectures=arm64-v8a',
  '--no-daemon',
], {
  cwd: path.join(root, 'android'),
});
copyArtifact(findReleaseApk());
