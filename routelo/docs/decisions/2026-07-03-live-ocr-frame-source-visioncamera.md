# Decision: Use VisionCamera as the first native live OCR frame source candidate

Date: 2026-07-03

Status: Accepted as first implementation direction, but revisit after the first
native build spike.

Related work:

- GitHub issue: #61
- Decision issue: #69
- Existing shared engine: `app/services/liveFrameScanner.ts`
- Existing platform gate: `app/platform/liveCameraFrameSource.ts`

## Context

RouteLO currently has a safe still-photo OCR flow based on `ImagePicker`. The
shared live OCR engine already exists, but it still needs a native preview-frame
source before the app can actually sample camera frames continuously.

The product goal is not just camera preview. The OCR scanner needs controlled
frame sampling, backpressure, quality gating, and eventually native access to
camera frames for receipt preprocessing and PP-OCR input preparation.

Official VisionCamera documentation describes it as a React Native camera
library built on AVFoundation for iOS and CameraX for Android, with extensible
native code integration. Its docs also expose a streaming-frame path and Native
Frame Processor Plugins, which can access platform-native frame buffers.

Reference links:

- VisionCamera Getting Started:
  https://visioncamera.margelo.com/docs
- VisionCamera Native Frame Processor Plugins:
  https://visioncamera.margelo.com/docs/native-frame-processor-plugins

## Decision

Use VisionCamera as the first candidate for RouteLO's native live OCR frame
source.

This does not mean immediately replacing the current still-photo OCR flow. The
current fallback remains the safe production path until a native adapter is
proven on device.

The first VisionCamera implementation should connect to the existing
`LiveCameraFrameSource` contract and feed `LiveOcrFrameAsset`-compatible frame
events into `LiveOcrFrameScanner`.

## Why VisionCamera first

- It is designed for React Native camera preview and streaming camera frames.
- It supports native frame processor plugins, which is the likely path for
  efficient receipt-region detection, frame conversion, and future native
  preprocessing.
- It maps well to RouteLO's already-merged architecture:
  - `LiveCameraFrameSource` owns native preview-frame availability;
  - `LiveOcrFrameScanner` owns sampling, quality gating, backpressure, and
    accumulation;
  - still-photo OCR remains the fallback.
- It gives us a more realistic path than trying to force repeated OCR through
  one-shot `ImagePicker` captures.

## Constraints and risks

- VisionCamera requires native rebuilding; it cannot be treated as a pure Expo Go
  JavaScript-only feature.
- The current VisionCamera ecosystem uses Nitro/native frame processor concepts,
  so Android/iOS integration may require extra native build work.
- Adding the dependency may affect Expo prebuild, Android CI, and iOS CI.
- Frame processors can be performance-sensitive. The app must not OCR every
  preview frame.
- Raw camera frames must not be uploaded for this workflow. OCR remains
  on-device by default.

## Guardrails for the first implementation PR

The first VisionCamera PR should be a small native capability spike, not a full
scanner rewrite.

Acceptance guardrails:

- Keep `ImagePicker` still-photo OCR working.
- Keep `liveCameraFrameSourceCapability()` returning unavailable unless the
  native adapter is actually bundled and reachable.
- Add VisionCamera dependencies and config only if Expo prebuild, Android CI, and
  iOS CI stay green.
- Do not call vendor or map APIs per frame.
- Do not save or upload raw preview frames.
- Feed only sampled/accepted frame metadata or temporary frame assets into
  `LiveOcrFrameScanner`.
- Preserve the current `LiveOcrFrameScanner` backpressure rule: one OCR inference
  at a time.

## Revisit triggers

Reconsider this decision if any of the following happens:

- VisionCamera dependency installation breaks Expo SDK 56 prebuild or CI in a
  way that requires broad native restructuring.
- The frame processor path cannot produce a suitable image asset or native buffer
  for PP-OCR without excessive copying, latency, heat, or memory pressure.
- Device testing shows live preview OCR is less reliable than a guided
  still-photo capture flow.
- A lighter Expo-native camera path becomes able to provide the same frame-level
  access with lower native-maintenance cost.

## Next step

Open a small PR that installs and configures VisionCamera behind the existing
`LiveCameraFrameSource` gate. That PR should prove native build compatibility
first. Only after that should we wire real frame events into the OCR accumulator.
