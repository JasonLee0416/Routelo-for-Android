import {
  VISION_CAMERA_PREVIEW_PROBE_ENV,
  visionCameraPreviewProbeEnabled,
} from '../VisionCameraPreviewProbe';

describe('VisionCamera preview probe feature flag', () => {
  test('is enabled only by the explicit preview probe flag value', () => {
    expect(visionCameraPreviewProbeEnabled('1')).toBe(true);
    expect(visionCameraPreviewProbeEnabled('true')).toBe(false);
    expect(visionCameraPreviewProbeEnabled('0')).toBe(false);
    expect(visionCameraPreviewProbeEnabled(undefined)).toBe(false);
  });

  test('documents the public Expo flag name used by native test builds', () => {
    expect(VISION_CAMERA_PREVIEW_PROBE_ENV).toBe(
      'EXPO_PUBLIC_ROUTELO_ENABLE_VISION_CAMERA_PREVIEW',
    );
  });
});
