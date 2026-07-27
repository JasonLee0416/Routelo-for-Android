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

  // deskew 2-pass: 라인 박스 기울기가 confident할 때만 회전 후 재인식하고, 인식
  // 품질이 실제로 나아질 때만 회전본을 채택한다(부호/각도 오류·실패 시 원본 유지).
  // 라벨 행(단일 박스, 파싱 대상)과 다중 컬럼 노이즈 행(기울기 신호용, 별도 행이라
  // 값 오염 없음)을 alphaDeg로 함께 기울여 만든다. 투영 프로파일이 기울기를
  // 감지하려면 한 행에 여러 점이 있어야 해서 노이즈 행을 둔다.
  const tiltedBox = (cx: number, cy: number, alphaDeg: number) => {
    const rad = (alphaDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      x: cx * cos - cy * sin - 60,
      y: cx * sin + cy * cos - 12,
      width: 120,
      height: 24,
    };
  };
  const tiltedReceipt = (alphaDeg: number, labelTexts: string[]) => {
    const lines = labelTexts.map((text, index) => ({
      text,
      boundingBox: tiltedBox(300, 200 + index * 46, alphaDeg),
    }));
    // 노이즈 행 4개 × 3열: 같은 cy에 여러 점을 만들어 기울기 감지 신호를 준다.
    for (let row = 0; row < 4; row += 1) {
      const cy = 500 + row * 46;
      for (const cx of [150, 300, 450]) {
        lines.push({ text: '표', boundingBox: tiltedBox(cx, cy, alphaDeg) });
      }
    }
    return lines;
  };

  it('deskew: 기울기 신호가 약하면 1-pass로 끝나고 회전을 시도하지 않는다', async () => {
    let recognizeCalls = 0;
    let rotateCalls = 0;
    const recognize = async () => {
      recognizeCalls += 1;
      return {
        fullText:
          '상품명: 근조화환 3단\n배송주소: 서울 강남구 테헤란로 1\n수령인 전화: 010-1234-5678',
        processingMs: 1,
        lines: [],
      };
    };
    const rotate = async (uri: string) => {
      rotateCalls += 1;
      return { uri: `${uri}#rot` };
    };
    const result = await runReceiptOcr(
      { uri: 'file:///flat.jpg', width: 1200, height: 1600 },
      undefined,
      recognize,
      quality,
      rotate,
    );
    expect(recognizeCalls).toBe(1);
    expect(rotateCalls).toBe(0);
    expect(result.variantsCompared).toBe(1);
    expect(result.fields.find(({ key }) => key === 'productName')?.value).toBe(
      '근조화환 3단',
    );
  });

  it('deskew: 회전본이 더 많은 필드를 주면 채택한다(recognize 2회, variants=2)', async () => {
    let recognizeCalls = 0;
    const firstTexts = [
      '상품명: 근조화환 3단',
      '배송주소: 서울 강남구 테헤란로 1',
      '수령인 전화: 010-1234-5678',
      '잡음3',
      '잡음4',
      '잡음5',
      '잡음6',
    ];
    const rotatedTexts = [
      '상품명: 근조화환 3단',
      '배송주소: 서울 강남구 테헤란로 1',
      '수령인 전화: 010-1234-5678',
      '리본문구: 삼가 고인의 명복을 빕니다',
      '잡음4',
      '잡음5',
      '잡음6',
    ];
    const recognize = async (uri: string) => {
      recognizeCalls += 1;
      const rotated = uri.includes('#rot');
      const texts = rotated ? rotatedTexts : firstTexts;
      return {
        fullText: texts.join('\n'),
        processingMs: 1,
        lines: tiltedReceipt(rotated ? 0 : 8, texts),
      };
    };
    const rotate = async (uri: string) => ({ uri: `${uri}#rot`, width: 1200, height: 1600 });
    const result = await runReceiptOcr(
      { uri: 'file:///tilted.jpg', width: 1200, height: 1600 },
      undefined,
      recognize,
      quality,
      rotate,
    );
    expect(recognizeCalls).toBe(2);
    expect(result.variantsCompared).toBe(2);
    // 회전본에서만 잡힌 리본 문구가 최종 결과에 반영된다.
    expect(result.fields.find(({ key }) => key === 'ribbonText')?.value).toContain(
      '삼가 고인의 명복을 빕니다',
    );
  });

  it('deskew: 회전/재인식이 실패하면 조용히 1차 결과를 유지한다', async () => {
    let recognizeCalls = 0;
    const texts = [
      '상품명: 근조화환 3단',
      '배송주소: 서울 강남구 테헤란로 1',
      '수령인 전화: 010-1234-5678',
      '잡음3',
      '잡음4',
      '잡음5',
      '잡음6',
    ];
    const recognize = async () => {
      recognizeCalls += 1;
      return { fullText: texts.join('\n'), processingMs: 1, lines: tiltedReceipt(8, texts) };
    };
    const rotate = async () => {
      throw new Error('rotate failed');
    };
    const result = await runReceiptOcr(
      { uri: 'file:///tilted.jpg', width: 1200, height: 1600 },
      undefined,
      recognize,
      quality,
      rotate,
    );
    expect(recognizeCalls).toBe(1);
    expect(result.variantsCompared).toBe(1);
    expect(result.fields.find(({ key }) => key === 'productName')?.value).toBe(
      '근조화환 3단',
    );
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

// 완벽 OCR 텍스트(골든 정답)에서도 드러난 파싱 버그를 고정한다. 실제 인수증
// 8장에서 관찰된 표면형을 인라인 픽스처로 옮겨 회귀를 막는다.
describe('OCR single-image parsing quality (golden-observed)', () => {
  const field = (result: ReturnType<typeof parseReceiptText>, key: string) =>
    result.fields.find((item) => item.key === key);

  it('라벨 경계: "상품코드"를 상품명으로 오인하지 않고 "배송상품"을 택한다', () => {
    const text = ['상품코드: TFP-NO 100 OPT', '배송상품: 근조화환 1개 (새꽃정 풀화환)'].join(
      '\n',
    );
    expect(field(parseReceiptText(text, quality), 'productName')?.value).toBe(
      '근조화환 1개 (새꽃정 풀화환)',
    );
  });

  it('2차 라벨 제거: "배달장소: 주소 서울…"에서 "주소"를 걷어낸다', () => {
    const text = '배달장소: 주소 서울 동작구 흑석로 102 중앙대병원 장례식장 5호';
    expect(field(parseReceiptText(text, quality), 'deliveryAddress')?.value).toBe(
      '서울 동작구 흑석로 102 중앙대병원 장례식장 5호',
    );
  });

  it('리본 중첩 라벨: "리본: 경조사어: 삼가…"에서 메시지만 남긴다', () => {
    const text = '리본: 경조사어: 삼가 고인의 명복을 빕니다';
    expect(field(parseReceiptText(text, quality), 'ribbonText')?.value).toBe(
      '삼가 고인의 명복을 빕니다',
    );
  });

  it('[불명] 토큰만 남는 값은 채우지 않는다', () => {
    const result = parseReceiptText('인수자명: [불명]', quality);
    const recipient = field(result, 'recipientName');
    expect(recipient?.value).toBe('');
    expect(recipient?.status).toBe('missing');
  });

  it('수령자 별칭 확장: "받으실분"을 인식한다', () => {
    expect(
      field(parseReceiptText('받으실분: 유기열 부친상', quality), 'recipientName')
        ?.value,
    ).toBe('유기열 부친상');
  });

  it('화원명 복구(KDFC 대시형): 괄호 안 화원명을 뽑고 review로 둔다', () => {
    const result = parseReceiptText(
      '발주화원: 경기 의정부시-경기의정21호(임플라워)-010-5898-9543',
      quality,
    );
    const vendor = field(result, 'orderingVendorName');
    expect(vendor?.value).toBe('임플라워');
    expect(vendor?.status).toBe('review');
  });

  it('화원명 복구(네이버 대괄호형): 지역태그·HP괄호를 제거한다', () => {
    expect(
      field(
        parseReceiptText(
          '발주회원: [서울 마포구] 가든스로즈블리 (HP:010-4482-9119)',
          quality,
        ),
        'orderingVendorName',
      )?.value,
    ).toBe('가든스로즈블리');
  });

  it('깨끗한 화원명은 그대로 둔다(정제 부작용 없음)', () => {
    expect(
      field(parseReceiptText('발주처: KDFC한길화원', quality), 'orderingVendorName')
        ?.value,
    ).toBe('KDFC한길화원');
  });

  it('전각 콜론(：) 구분자도 라벨로 인정한다', () => {
    expect(
      field(parseReceiptText('상품명：근조화환 1개', quality), 'productName')?.value,
    ).toBe('근조화환 1개');
  });

  it('값 안의 콜론 없는 위치 토큰(배송지)에서 잘리지 않는다: 메모 유실 방지', () => {
    // 콜론 없는 공백 경계로는 자르지 않으므로 "배송지" 뒤 지시문이 살아있다.
    // (콜론 없는 분리를 허용하면 "…배송지 변경 확인"이 잘려나가는 회귀가 있었다)
    const memo = field(
      parseReceiptText('요청사항: 냉장 유지 배송지 변경 확인', quality),
      'memo',
    )?.value;
    expect(memo).toContain('배송지 변경 확인');
  });

  it('콜론 없는 공백 경계로는 리본/이름 같은 토큰을 지우지 않는다', () => {
    // "리본:" 라벨만 벗기고, 값이 "이름"으로 시작해도(공백 경계) 지우지 않는다.
    // (콜론 구분자가 있을 때만 2차 라벨로 제거)
    expect(
      field(parseReceiptText('리본: 이름 새겨주세요', quality), 'ribbonText')?.value,
    ).toBe('이름 새겨주세요');
  });

  it('화원 괄호 없이 전화만 섞인 복합값은 fail-closed로 거절한다', () => {
    // 전화 포함 복합값은 화원명 검증기가 거절해야 한다(정제가 전화만 벗겨
    // 통과시키면 안 됨). 괄호로 화원명이 분리되지 않으므로 원본 유지→거절.
    const result = parseReceiptText(
      '발주화원: 경기 의정부시 임플라워 010-5898-9543',
      quality,
    );
    expect(field(result, 'orderingVendorName')?.value).toBe('');
  });

  it('화원명이 아닌 괄호(대표/담당)는 화원명으로 뽑지 않는다', () => {
    expect(
      field(
        parseReceiptText('발주화원: 행복플라워(대표 김철수)', quality),
        'orderingVendorName',
      )?.value,
    ).toBe('행복플라워');
  });

  it('한 줄에 병합된 라벨을 분리해 여러 필드를 복원한다(ML Kit 셀 병합 보완)', () => {
    // ML Kit이 여러 셀을 한 줄로 뭉친 실제 케이스. 예전엔 배송지만 살아남았다.
    const text =
      '보내는 분 : (주)제이콘솔라인 대표이사 김장호 경조사어 : 삼가 고인의 명복을 빕니다 주소 서울 동작구 중앙대병원 장례식장 5호';
    const result = parseReceiptText(text, quality);
    // 배송지·리본이 같은 줄에서 함께 복원된다.
    expect(field(result, 'deliveryAddress')?.value).toContain('중앙대병원 장례식장');
    expect(field(result, 'ribbonText')?.value).toContain('삼가 고인의 명복을 빕니다');
  });
});
