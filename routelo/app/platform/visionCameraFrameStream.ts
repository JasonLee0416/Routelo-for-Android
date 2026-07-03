export const VISION_CAMERA_FRAME_STREAM_ENV =
  'EXPO_PUBLIC_ROUTELO_ENABLE_VISION_CAMERA_FRAME_STREAM';

export type VisionCameraFrameMetadata = {
  width: number;
  height: number;
  timestamp: number;
  orientation?: string;
  pixelFormat?: string;
  isMirrored?: boolean;
  isPlanar?: boolean;
  hasPixelBuffer?: boolean;
  capturedAt: number;
};

export type VisionCameraFrameStreamTelemetry = {
  receivedFrames: number;
  droppedFrames: number;
  lastFrame?: VisionCameraFrameMetadata;
  lastDroppedReason?: string;
};

export function visionCameraFrameStreamEnabled(
  value = process.env.EXPO_PUBLIC_ROUTELO_ENABLE_VISION_CAMERA_FRAME_STREAM,
): boolean {
  return value === '1';
}

export function createVisionCameraFrameStreamTelemetry(): VisionCameraFrameStreamTelemetry {
  return {
    receivedFrames: 0,
    droppedFrames: 0,
  };
}

export function recordVisionCameraFrame(
  telemetry: VisionCameraFrameStreamTelemetry,
  frame: VisionCameraFrameMetadata,
): VisionCameraFrameStreamTelemetry {
  return {
    ...telemetry,
    receivedFrames: telemetry.receivedFrames + 1,
    lastFrame: frame,
  };
}

export function recordVisionCameraFrameDrop(
  telemetry: VisionCameraFrameStreamTelemetry,
  reason: string,
): VisionCameraFrameStreamTelemetry {
  return {
    ...telemetry,
    droppedFrames: telemetry.droppedFrames + 1,
    lastDroppedReason: reason,
  };
}

export function visionCameraFrameStreamStatusLabel(
  enabled: boolean,
  telemetry: VisionCameraFrameStreamTelemetry,
): string {
  if (!enabled) {
    return 'disabled';
  }

  return telemetry.receivedFrames > 0 ? 'streaming' : 'waiting for frames';
}
