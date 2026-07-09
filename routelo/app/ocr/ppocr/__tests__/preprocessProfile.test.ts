import {
  detectorTensorData,
  recognizerTensorData,
  type DecodedJpeg,
} from '../image';
import {
  PP_OCR_PREPROCESS_PROFILES,
  selectPpOcrPreprocessProfile,
} from '../profile';

const image = (value: number): DecodedJpeg => ({
  width: 2,
  height: 1,
  rgba: new Uint8Array([
    value,
    value,
    value,
    255,
    Math.min(255, value + 4),
    Math.min(255, value + 4),
    Math.min(255, value + 4),
    255,
  ]),
});

describe('PP-OCR preprocess profiles', () => {
  it('keeps the stable mobile profile as the default', () => {
    expect(selectPpOcrPreprocessProfile({})).toBe(
      PP_OCR_PREPROCESS_PROFILES.stableMobile,
    );
  });

  it('selects high-res preprocessing only when explicitly requested', () => {
    expect(
      selectPpOcrPreprocessProfile({
        EXPO_PUBLIC_ROUTELO_OCR_PROFILE: 'high-res-preprocess',
      }),
    ).toMatchObject({
      id: 'high-res-preprocess',
      detectorMaxSide: 1536,
      recognizerTargetWidth: 480,
      minLineConfidence: 0.48,
      tensor: { illuminationNormalization: true },
    });
  });

  it('changes low-contrast tensor values only for the guarded preprocessing path', () => {
    const dark = image(42);
    const stableDetector = detectorTensorData(
      dark,
      PP_OCR_PREPROCESS_PROFILES.stableMobile.tensor,
    );
    const guardedDetector = detectorTensorData(
      dark,
      PP_OCR_PREPROCESS_PROFILES.highResPreprocess.tensor,
    );
    const stableRecognizer = recognizerTensorData(
      dark,
      PP_OCR_PREPROCESS_PROFILES.stableMobile.recognizerTargetWidth,
      PP_OCR_PREPROCESS_PROFILES.stableMobile.tensor,
    );
    const guardedRecognizer = recognizerTensorData(
      dark,
      PP_OCR_PREPROCESS_PROFILES.highResPreprocess.recognizerTargetWidth,
      PP_OCR_PREPROCESS_PROFILES.highResPreprocess.tensor,
    );

    expect(guardedDetector[0]).not.toBeCloseTo(stableDetector[0]);
    expect(guardedRecognizer[0]).not.toBeCloseTo(stableRecognizer[0]);
    expect(guardedRecognizer.length).toBe(480 * dark.height * 3);
  });
});
