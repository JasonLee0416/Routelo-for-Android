import {
  createVisionCameraFrameStreamTelemetry,
  recordVisionCameraFrame,
  recordVisionCameraFrameDrop,
  VISION_CAMERA_FRAME_STREAM_ENV,
  visionCameraFrameStreamEnabled,
  visionCameraFrameStreamStatusLabel,
} from '../visionCameraFrameStream';

describe('VisionCamera frame stream telemetry', () => {
  test('is enabled only by the explicit frame-stream flag', () => {
    expect(visionCameraFrameStreamEnabled('1')).toBe(true);
    expect(visionCameraFrameStreamEnabled('true')).toBe(false);
    expect(visionCameraFrameStreamEnabled('0')).toBe(false);
    expect(visionCameraFrameStreamEnabled(undefined)).toBe(false);
  });

  test('documents the Expo public flag name', () => {
    expect(VISION_CAMERA_FRAME_STREAM_ENV).toBe(
      'EXPO_PUBLIC_ROUTELO_ENABLE_VISION_CAMERA_FRAME_STREAM',
    );
  });

  test('records received frames without inventing OCR input assets', () => {
    const telemetry = recordVisionCameraFrame(
      createVisionCameraFrameStreamTelemetry(),
      {
        width: 1280,
        height: 720,
        timestamp: 123,
        orientation: 'right',
        pixelFormat: 'yuv-420-8-bit-video',
        capturedAt: 456,
      },
    );

    expect(telemetry).toMatchObject({
      receivedFrames: 1,
      droppedFrames: 0,
      lastFrame: {
        width: 1280,
        height: 720,
        orientation: 'right',
        pixelFormat: 'yuv-420-8-bit-video',
      },
    });
  });

  test('records dropped frame reasons separately from received frames', () => {
    const telemetry = recordVisionCameraFrameDrop(
      createVisionCameraFrameStreamTelemetry(),
      'out-of-buffers',
    );

    expect(telemetry).toEqual({
      receivedFrames: 0,
      droppedFrames: 1,
      lastDroppedReason: 'out-of-buffers',
    });
  });

  test('summarizes the stream state', () => {
    expect(
      visionCameraFrameStreamStatusLabel(
        false,
        createVisionCameraFrameStreamTelemetry(),
      ),
    ).toBe('disabled');

    expect(
      visionCameraFrameStreamStatusLabel(
        true,
        createVisionCameraFrameStreamTelemetry(),
      ),
    ).toBe('waiting for frames');

    expect(
      visionCameraFrameStreamStatusLabel(
        true,
        recordVisionCameraFrame(createVisionCameraFrameStreamTelemetry(), {
          width: 1,
          height: 1,
          timestamp: 1,
          capturedAt: 1,
        }),
      ),
    ).toBe('streaming');
  });
});
