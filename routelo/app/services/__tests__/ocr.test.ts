import {
  inspectCaptureQuality,
  OcrNoTextDetectedError,
  OcrRecognizerUnavailableError,
  parseReceiptText,
  runReceiptOcr,
} from '../ocr';

// 테스트 전용 인수증 픽스처(앱 코드에는 더 이상 샘플/데모 데이터를 두지 않는다).
const DEMO_RECEIPT_TEXT = `
배송 인수증
주문번호 FL-20260621-1842
발주화원 마음꽃화원
발주화원 전화 02-518-2400
배송화원 로즈플라워
배송화원 전화 02-2038-1188
배송일자 2026.06.21
업체명 더채플앳청담
배송주소 서울 강남구 선릉로 757 더채플앳청담 3층
받는 분 김민준 실장
수령인 전화 010-4821-7732
배달 엄수 10:30까지
예식 시간 오전 11시
상품 축하 3단 화환 2개
리본 문구 결혼을 축하드립니다
요청사항 예식 시작 30분 전 설치 완료, 설치 후 사진 전송
`;

const quality = {
  score: 90,
  blur: 90,
  brightness: 90,
  documentCoverage: 90,
  skew: 90,
  shadow: 90,
  passed: true,
  messages: [],
};

describe('OCR zero-fabrication guard', () => {
  it('does not fabricate trusted capture quality scores without pixel analysis', () => {
    const fallbackQuality = inspectCaptureQuality({
      uri: 'file:///same-resolution-receipt.jpg',
      width: 1440,
      height: 1920,
    });

    expect(fallbackQuality.measured).toBe(false);
    expect(fallbackQuality.passed).toBe(false);
    expect(fallbackQuality.score).toBe(0);
    expect(fallbackQuality.brightness).toBe(0);
    expect(fallbackQuality.skew).toBe(0);
    expect(fallbackQuality.shadow).toBe(0);
    expect(fallbackQuality.messages.join(' ')).toContain(
      '픽셀을 분석하지 못해',
    );
  });

  it('rejects a real capture when no recognizer text exists', async () => {
    const recognizer = jest.fn().mockRejectedValue(
      new Error('Native recognizer unavailable'),
    );

    await expect(
      runReceiptOcr({
        uri: 'file:///captured-receipt.jpg',
        width: 1440,
        height: 1920,
      }, undefined, recognizer),
    ).rejects.toBeInstanceOf(OcrRecognizerUnavailableError);
  });

  it('keeps the explicit demo fixture available only when supplied', () => {
    const result = parseReceiptText(DEMO_RECEIPT_TEXT, quality);

    expect(result.rawText).toContain('FL-20260621-1842');
    expect(result.fields.length).toBeGreaterThan(0);
  });

  it('parses actual PP-OCR text returned for a captured image', async () => {
    const recognizer = jest.fn().mockResolvedValue({
      fullText: DEMO_RECEIPT_TEXT,
      lines: [{ text: '주문번호 FL-20260621-1842' }],
      processingMs: 321,
      diagnostics: {
        preprocessProfileId: 'ocr-recovery-test',
        selectedOrientationDegrees: 0,
        regionCount: 12,
        acceptedLineCount: 8,
        rawTextLength: DEMO_RECEIPT_TEXT.length,
        orientationCandidates: [],
      },
    });

    const result = await runReceiptOcr({
      uri: 'file:///captured-receipt.jpg',
      width: 1440,
      height: 1920,
    }, undefined, recognizer);

    expect(recognizer).toHaveBeenCalledWith(
      'file:///captured-receipt.jpg',
    );
    expect(result.engine).toBe('ppocrv5');
    expect(result.processingMs).toBe(321);
    expect(result.rawText).toContain('FL-20260621-1842');
    expect(result.recognizedLines?.[0].text).toContain('주문번호');
    expect(result.ocrDiagnostics).toMatchObject({
      preprocessProfileId: 'ocr-recovery-test',
      regionCount: 12,
      acceptedLineCount: 8,
    });
  });

  it('fails closed when OCR output has no usable receipt evidence', async () => {
    const recognizer = jest.fn().mockResolvedValue({
      fullText: '받는문.고인김기회 TEL',
      lines: [{ text: '받는문.고인김기회 TEL', confidence: 0.84 }],
      processingMs: 84,
    });

    await expect(
      runReceiptOcr({
        uri: 'file:///garbled-receipt.jpg',
        width: 1440,
        height: 1920,
      }, undefined, recognizer),
    ).rejects.toBeInstanceOf(OcrNoTextDetectedError);
  });

  it('includes detector diagnostics when PP-OCR returns no text', async () => {
    const recognizer = jest.fn().mockResolvedValue({
      fullText: '',
      lines: [],
      processingMs: 33,
      diagnostics: {
        preprocessProfileId: 'ocr-recovery-test',
        selectedOrientationDegrees: 0,
        regionCount: 0,
        acceptedLineCount: 0,
        rawTextLength: 0,
        orientationCandidates: [],
      },
    });

    await expect(
      runReceiptOcr({
        uri: 'file:///empty-receipt.jpg',
        width: 1440,
        height: 1920,
      }, undefined, recognizer),
    ).rejects.toThrow(/detectedRegions=0/);
  });

  it('uses PP-OCR geometry to associate labels with values', async () => {
    const recognizer = jest.fn().mockResolvedValue({
      fullText: '김민준\n받는 분\n010-4821-7732\n수령인 전화',
      lines: [
        { text: '김민준', boundingBox: { x: 180, y: 10, width: 80, height: 20 } },
        { text: '받는 분', boundingBox: { x: 10, y: 12, width: 90, height: 20 } },
        { text: '010-4821-7732', boundingBox: { x: 180, y: 50, width: 130, height: 20 } },
        { text: '수령인 전화', boundingBox: { x: 10, y: 48, width: 100, height: 20 } },
      ],
      processingMs: 120,
    });

    const result = await runReceiptOcr(
      { uri: 'file:///layout-receipt.jpg', width: 1200, height: 1600 },
      undefined,
      recognizer,
    );

    expect(result.rawText).toContain('받는 분 김민준');
    expect(
      result.fields.find(({ key }) => key === 'recipientName')?.value,
    ).toBe('김민준');
    expect(
      result.fields.find(({ key }) => key === 'recipientTel')?.value,
    ).toBe('010-4821-7732');
  });
});

// 실기기 ML Kit가 반환한 한국직거래화훼센터 인수증 원문에서, 라벨이 부분 인식된
// 줄(예: "발주처"가 "주처"로 잘림)을 하드코딩 lookup은 놓쳤다. 레지스트리
// 별칭 사전('주처')은 이를 잡는데 그 결과(mapped)가 그동안 버려져 필드가 비었다.
// 아래 테스트는 registrySource 폴백이 그 공백을 메우되 status는 'review'로만 두어
// zero-fabrication을 지키는지 고정한다.
describe('OCR registry alias fallback (dead-code activation)', () => {
  const field = (result: ReturnType<typeof parseReceiptText>, key: string) =>
    result.fields.find((item) => item.key === key);

  it('recovers 발주화원 from the partial "주처" label the hardcoded lookup missed', () => {
    const text = [
      '한국직거래화훼센터 인수증',
      '본부전화:1566-0028',
      '주처 아뜰리에몽플라워',
      '상품명 축하3단',
      '배송주소 서울 영등포구 국제금융로 10',
    ].join('\n');

    const result = parseReceiptText(text, quality);
    const ordering = field(result, 'orderingVendorName');

    expect(ordering?.value).toBe('아뜰리에몽플라워');
    // 복구값은 검토 대상이지 확정이 아니다(zero-fabrication).
    expect(ordering?.status).toBe('review');
  });

  it('does not overwrite a hardcoded hit with the registry value', () => {
    // 레지스트리만 잡는 라벨("주처")을 먼저 두어, 두 경로가 서로 다른 값을
    // 내도록 한다. 하드코딩 우선이 아니면 '아뜰리에몽플라워'가 나올 것이다.
    const text = [
      '주처 아뜰리에몽플라워',
      '발주화원 마음꽃화원',
    ].join('\n');

    // 하드코딩 findLabeledValue가 잡은 "마음꽃화원"이 우선한다.
    expect(field(parseReceiptText(text, quality), 'orderingVendorName')?.value).toBe(
      '마음꽃화원',
    );
  });

  it('keeps a registry-recovered vendor phone in review, never confirmed', () => {
    // "발주처 연락처"는 하드코딩 lookup(발주화원/발주처/발주 전화)엔 없고
    // 레지스트리 별칭에만 있다. 폴백으로 복구되더라도 퍼지 매칭이므로 확정하면
    // 안 되고 검토(review)여야 한다(zero-fabrication).
    const result = parseReceiptText('발주처 연락처 02-1234-5678', quality);
    const tel = field(result, 'orderingVendorTel');
    expect(tel?.value).toBe('02-1234-5678');
    expect(tel?.status).toBe('review');
  });

  it('still confirms an explicitly-labeled vendor phone', () => {
    // 명시 라벨("발주화원 전화")로 잡힌 전화는 기존대로 확정(confirmed) 유지.
    const result = parseReceiptText('발주화원 전화 02-1234-5678', quality);
    const tel = field(result, 'orderingVendorTel');
    expect(tel?.value).toBe('02-1234-5678');
    expect(tel?.status).toBe('confirmed');
  });

  it('leaves fields missing when neither path matches (no fabrication)', () => {
    const result = parseReceiptText('본부전화:1566-0028\n인수증', quality);
    const ordering = field(result, 'orderingVendorName');
    expect(ordering?.value).toBe('');
    expect(ordering?.status).toBe('missing');
  });
});
