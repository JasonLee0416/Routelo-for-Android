# Decision: recognize Android receipt OCR directly from native camera frame buffers

Date: 2026-07-04

## Status

Accepted for the Android live OCR path.

## Context

VisionCamera can now show a hidden preview probe and emit frame metadata in the
scanner. The current Routelo repository is now Android-focused; iOS work has
been split into a separate Routelo for iOS repository. The remaining Android
decision is how to turn live camera frames into receipt OCR evidence without
lowering accuracy or inventing data.

The rejected shortcut is to treat a VisionCamera native frame as if it were a
normal image asset and pass it into the existing still-photo OCR function. A
native frame is not a file URI, and disposing or copying it incorrectly can
stall the camera pipeline. More importantly, a fake image-asset bridge would
make it easier for the app to pretend that OCR ran on data that was never
properly decoded.

## Decision

Use an Android-native recognizer that processes camera frame buffers directly:

- Android: native PP-OCR frame recognizer.
- iOS: out of scope for this repository and handled in the dedicated iOS repo.
- Cloud fallback: CLOVA OCR only when the user explicitly consents, and only as
  a later Android fallback.
- Manual entry remains the final fallback when required fields are missing.

The shared JavaScript pipeline should receive already-recognized OCR evidence
through `LiveOcrFrameScanner.acceptRecognizedNativeFrame()`. That keeps field
accumulation, confidence rules, quality gating, backpressure, and review-before-
save behavior shared across Android live OCR and still-photo OCR.

## Safety rules

- Do not convert native frames into fake `LiveOcrFrameAsset` URI inputs.
- Do not auto-save delivery data from a single frame.
- Do not produce placeholder OCR fields when the native recognizer is missing.
- Android native recognizers must fail closed and keep still-photo OCR
  available.
- CLOVA must remain opt-in because it sends image/text data off device.

## Implementation sequence

1. Add the shared native-frame recognizer contract and scanner ingestion path.
2. Add Android native PP-OCR binding against VisionCamera frame buffers.
3. Add device benchmark logging for real Android receipt samples.
4. Consider CLOVA fallback only after the local native path reports missing
   required fields and the user has opted in.

## Revisit triggers

- VisionCamera frame output cannot deliver stable buffers on target devices.
- PP-OCR native inference is too slow for the delivery workflow.
- Native build size or compile time becomes unacceptable.
