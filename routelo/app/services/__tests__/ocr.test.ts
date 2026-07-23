import {
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
