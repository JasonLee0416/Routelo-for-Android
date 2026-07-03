import React, { useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';

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
  isActive?: boolean;
  style?: StyleProp<ViewStyle>;
};

function loadVisionCameraRuntime(): VisionCameraRuntime | null {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return null;
  }

  try {
    return require('react-native-vision-camera') as VisionCameraRuntime;
  } catch {
    return null;
  }
}

export function VisionCameraPreviewProbe({
  enabled = visionCameraPreviewProbeEnabled(),
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
      isActive={isActive}
      runtime={runtime}
      style={style}
    />
  );
}

function VisionCameraPreviewProbeNative({
  isActive,
  runtime,
  style,
}: VisionCameraPreviewProbeProps & { runtime: VisionCameraRuntime }) {
  const CameraView = runtime.Camera;
  const device = runtime.useCameraDevice('back');
  const permission = runtime.useCameraPermission();
  const [previewStatus, setPreviewStatus] = useState<
    'idle' | 'started' | 'stopped' | 'error'
  >('idle');
  const [previewError, setPreviewError] = useState<string | null>(null);

  const previewActive = Boolean(isActive && permission.hasPermission && device);

  const requestPermission = () => {
    void permission.requestPermission();
  };

  return (
    <ProbeShell style={style}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>VisionCamera preview probe</Text>
          <Text style={styles.caption}>
            Dev-only camera preview check. OCR frame streaming is not wired yet.
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
      </View>

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
