import React, { useCallback, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';

import {
  createVisionCameraFrameStreamTelemetry,
  recordVisionCameraFrame,
  recordVisionCameraFrameDrop,
  VisionCameraFrameMetadata,
  visionCameraFrameStreamEnabled,
  VisionCameraFrameStreamTelemetry,
  visionCameraFrameStreamStatusLabel,
} from './visionCameraFrameStream';

declare const require: (moduleName: string) => unknown;

type VisionCameraPermissionState = {
  status: string;
  requestPermission: () => Promise<boolean>;
  hasPermission: boolean;
  canRequestPermission: boolean;
};

type VisionCameraRuntime = {
  Camera: React.ComponentType<Record<string, unknown>>;
  useCameraDevice: (position: 'back' | 'front' | 'external') => unknown;
  useCameraPermission: () => VisionCameraPermissionState;
  useFrameOutput?: (props: Record<string, unknown>) => unknown;
  scheduleOnRN?: <Args extends unknown[]>(
    fun: (...args: Args) => void,
    ...args: Args
  ) => void;
};

export const VISION_CAMERA_PREVIEW_PROBE_ENV =
  'EXPO_PUBLIC_ROUTELO_ENABLE_VISION_CAMERA_PREVIEW';

export function visionCameraPreviewProbeEnabled(
  value = process.env.EXPO_PUBLIC_ROUTELO_ENABLE_VISION_CAMERA_PREVIEW,
): boolean {
  return value === '1';
}

type VisionCameraPreviewProbeProps = {
  enabled?: boolean;
  frameStreamEnabled?: boolean;
  isActive?: boolean;
  style?: StyleProp<ViewStyle>;
};

function loadVisionCameraRuntime(): VisionCameraRuntime | null {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return null;
  }

  try {
    const visionCamera = require(
      'react-native-vision-camera',
    ) as VisionCameraRuntime;
    let scheduleOnRN:
      | VisionCameraRuntime['scheduleOnRN']
      | undefined;
    try {
      scheduleOnRN = (
        require('react-native-worklets') as Pick<
          VisionCameraRuntime,
          'scheduleOnRN'
        >
      ).scheduleOnRN;
    } catch {
      scheduleOnRN = undefined;
    }

    return {
      ...visionCamera,
      scheduleOnRN,
    };
  } catch {
    return null;
  }
}

export function VisionCameraPreviewProbe({
  enabled = visionCameraPreviewProbeEnabled(),
  frameStreamEnabled = visionCameraFrameStreamEnabled(),
  isActive = true,
  style,
}: VisionCameraPreviewProbeProps) {
  const runtime = useMemo(loadVisionCameraRuntime, []);

  if (!enabled) {
    return null;
  }

  if (!runtime) {
    return (
      <ProbeShell style={style}>
        <Text style={styles.title}>VisionCamera preview probe</Text>
        <Text style={styles.caption}>
          Native VisionCamera preview is unavailable on this platform. The
          still-photo OCR fallback remains active.
        </Text>
      </ProbeShell>
    );
  }

  return (
    <VisionCameraPreviewProbeNative
      frameStreamEnabled={frameStreamEnabled}
      isActive={isActive}
      runtime={runtime}
      style={style}
    />
  );
}

function VisionCameraPreviewProbeNative({
  frameStreamEnabled = visionCameraFrameStreamEnabled(),
  isActive,
  runtime,
  style,
}: VisionCameraPreviewProbeProps & { runtime: VisionCameraRuntime }) {
  const CameraView = runtime.Camera;
  const scheduleOnRN = runtime.scheduleOnRN;
  const useFrameOutput = runtime.useFrameOutput;
  const device = runtime.useCameraDevice('back');
  const permission = runtime.useCameraPermission();
  const [frameTelemetry, setFrameTelemetry] =
    useState<VisionCameraFrameStreamTelemetry>(
      createVisionCameraFrameStreamTelemetry,
    );
  const [previewStatus, setPreviewStatus] = useState<
    'idle' | 'started' | 'stopped' | 'error'
  >('idle');
  const [previewError, setPreviewError] = useState<string | null>(null);

  const previewActive = Boolean(isActive && permission.hasPermission && device);
  const frameStreamReady = Boolean(
    frameStreamEnabled && useFrameOutput && scheduleOnRN,
  );

  const recordFrame = useCallback((metadata: VisionCameraFrameMetadata) => {
    setFrameTelemetry((current) =>
      recordVisionCameraFrame(current, metadata),
    );
  }, []);

  const recordDroppedFrame = useCallback((reason: string) => {
    setFrameTelemetry((current) =>
      recordVisionCameraFrameDrop(current, reason),
    );
  }, []);

  const frameOutput = frameStreamReady
    ? useFrameOutput?.({
        targetResolution: { width: 1280, height: 720 },
        pixelFormat: 'yuv',
        dropFramesWhileBusy: true,
        enablePreviewSizedOutputBuffers: true,
        allowDeferredStart: true,
        onFrame(frame: Record<string, unknown> & { dispose?: () => void }) {
          'worklet';
          const metadata = {
            width: Number(frame.width ?? 0),
            height: Number(frame.height ?? 0),
            timestamp: Number(frame.timestamp ?? 0),
            orientation:
              typeof frame.orientation === 'string'
                ? frame.orientation
                : undefined,
            pixelFormat:
              typeof frame.pixelFormat === 'string'
                ? frame.pixelFormat
                : undefined,
            isMirrored:
              typeof frame.isMirrored === 'boolean'
                ? frame.isMirrored
                : undefined,
            isPlanar:
              typeof frame.isPlanar === 'boolean' ? frame.isPlanar : undefined,
            hasPixelBuffer:
              typeof frame.hasPixelBuffer === 'boolean'
                ? frame.hasPixelBuffer
                : undefined,
            capturedAt: Date.now(),
          };
          frame.dispose?.();
          scheduleOnRN?.(recordFrame, metadata);
        },
        onFrameDropped(reason: string) {
          'worklet';
          scheduleOnRN?.(recordDroppedFrame, String(reason));
        },
      })
    : undefined;

  const requestPermission = () => {
    void permission.requestPermission();
  };

  return (
    <ProbeShell style={style}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>VisionCamera preview probe</Text>
          <Text style={styles.caption}>
            Dev-only camera preview check. Frame metadata streaming is optional
            and does not run OCR yet.
          </Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {previewActive ? 'ACTIVE' : 'CHECK'}
          </Text>
        </View>
      </View>

      <View style={styles.previewBox}>
        {previewActive ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={previewActive}
            outputs={frameOutput ? [frameOutput] : []}
            resizeMode="cover"
            enableNativeTapToFocusGesture
            onPreviewStarted={() => {
              setPreviewError(null);
              setPreviewStatus('started');
            }}
            onPreviewStopped={() => setPreviewStatus('stopped')}
            onError={(error: unknown) => {
              setPreviewStatus('error');
              setPreviewError(
                error instanceof Error
                  ? error.message
                  : 'VisionCamera preview failed.',
              );
            }}
          />
        ) : (
          <View style={styles.emptyPreview}>
            <Text style={styles.emptyTitle}>
              {permission.hasPermission
                ? 'Back camera is not available yet.'
                : 'Camera permission is required.'}
            </Text>
            <Text style={styles.emptyCaption}>
              Permission: {permission.status}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.statusRow}>
        <Text style={styles.statusText}>Preview: {previewStatus}</Text>
        <Text style={styles.statusText}>
          Device: {device ? 'back camera found' : 'not found'}
        </Text>
        <Text style={styles.statusText}>
          Frames:{' '}
          {visionCameraFrameStreamStatusLabel(
            frameStreamReady,
            frameTelemetry,
          )}
        </Text>
        <Text style={styles.statusText}>
          Count: {frameTelemetry.receivedFrames}
        </Text>
        <Text style={styles.statusText}>
          Drops: {frameTelemetry.droppedFrames}
        </Text>
      </View>

      {frameStreamEnabled && !frameStreamReady ? (
        <Text style={styles.warningText}>
          Frame stream requested, but VisionCamera Worklets are unavailable.
          Still-photo OCR remains the fallback.
        </Text>
      ) : null}

      {frameTelemetry.lastFrame ? (
        <Text style={styles.frameText}>
          Last frame: {frameTelemetry.lastFrame.width}×
          {frameTelemetry.lastFrame.height} ·{' '}
          {frameTelemetry.lastFrame.pixelFormat ?? 'unknown format'} ·{' '}
          {frameTelemetry.lastFrame.orientation ?? 'unknown orientation'}
        </Text>
      ) : null}

      {frameTelemetry.lastDroppedReason ? (
        <Text style={styles.frameText}>
          Last dropped frame: {frameTelemetry.lastDroppedReason}
        </Text>
      ) : null}

      {previewError ? (
        <Text style={styles.errorText}>{previewError}</Text>
      ) : null}

      {!permission.hasPermission && permission.canRequestPermission ? (
        <Pressable style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant camera access</Text>
        </Pressable>
      ) : null}
    </ProbeShell>
  );
}

function ProbeShell({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.shell, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  shell: {
    gap: 12,
    marginTop: 14,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#BCD3FF',
    backgroundColor: '#EEF5FF',
    padding: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    color: '#153B7A',
    fontSize: 15,
    fontWeight: '800',
  },
  caption: {
    marginTop: 4,
    color: '#4B638B',
    fontSize: 12,
    lineHeight: 17,
  },
  badge: {
    borderRadius: 999,
    backgroundColor: '#1D4ED8',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  previewBox: {
    height: 210,
    overflow: 'hidden',
    borderRadius: 20,
    backgroundColor: '#0B1220',
  },
  emptyPreview: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  emptyTitle: {
    color: '#E8EEF8',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyCaption: {
    marginTop: 6,
    color: '#A9B7D0',
    fontSize: 12,
    textAlign: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusText: {
    borderRadius: 999,
    backgroundColor: '#DCEAFF',
    color: '#244E8F',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  errorText: {
    color: '#B42318',
    fontSize: 12,
    fontWeight: '700',
  },
  warningText: {
    color: '#B54708',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  frameText: {
    color: '#244E8F',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  permissionButton: {
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: '#1D4ED8',
    paddingVertical: 12,
  },
  permissionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});
