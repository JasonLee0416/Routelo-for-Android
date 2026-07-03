import {
  createUnavailableLiveCameraFrameSource,
  liveCameraFrameSourceCapability,
} from '../liveCameraFrameSource';

describe('liveCameraFrameSourceCapability', () => {
  test('keeps Android on still-photo fallback until a native adapter exists', () => {
    expect(liveCameraFrameSourceCapability('android')).toEqual({
      available: false,
      status: 'native-adapter-missing',
      reason:
        'Live camera OCR requires a native preview-frame adapter. Use still-photo OCR until that adapter is bundled in the development build.',
      fallback: 'still-photo',
      recommendedMinIntervalMs: 500,
    });
  });

  test('keeps iOS on still-photo fallback until a native adapter exists', () => {
    expect(liveCameraFrameSourceCapability('ios')).toMatchObject({
      available: false,
      status: 'native-adapter-missing',
      fallback: 'still-photo',
    });
  });

  test('reports web as unsupported instead of pretending live OCR is available', () => {
    expect(liveCameraFrameSourceCapability('web')).toEqual({
      available: false,
      status: 'unsupported-platform',
      reason: 'Live camera OCR is unavailable on web.',
      fallback: 'still-photo',
      recommendedMinIntervalMs: 500,
    });
  });

  test('reports available only when a platform native adapter is registered', () => {
    expect(liveCameraFrameSourceCapability('android', true)).toEqual({
      available: true,
      status: 'available',
      fallback: 'still-photo',
      recommendedMinIntervalMs: 500,
    });
  });

  test('unavailable source fails loudly so the UI cannot silently fake live OCR', async () => {
    const source = createUnavailableLiveCameraFrameSource('android');

    await expect(
      source.start({
        onFrame: jest.fn(),
      }),
    ).rejects.toThrow('native preview-frame adapter');
  });
});
