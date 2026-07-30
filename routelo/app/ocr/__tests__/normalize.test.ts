import { DEFAULT_FIELD_REGISTRY } from '../fieldRegistry';
import { levenshtein, matchField, normalizeReceipt, parseLine } from '../normalize';

// 실제 출하 레지스트리(DEFAULT_FIELD_REGISTRY = OcrFieldKey 9필드)로 검증한다.
const REGISTRY = DEFAULT_FIELD_REGISTRY;

describe('levenshtein', () => {
  it('동일 문자열은 0', () => {
    expect(levenshtein('연락처', '연락처')).toBe(0);
  });
  it('한 글자 차이는 1', () => {
    expect(levenshtein('연락처', '연락쳐')).toBe(1);
  });
});

describe('matchField', () => {
  it('같은 의미의 라벨 변형은 모두 한 키로 모인다', () => {
    for (const label of ['배송일자', '배달일자', '배송일', '납품일']) {
      expect(matchField(label, REGISTRY)?.key).toBe('deliveryDate');
    }
  });

  it('오타도 퍼지 매칭으로 흡수한다', () => {
    expect(matchField('연락쳐', REGISTRY)?.key).toBe('recipientTel');
  });

  it('비슷하지만 다른 필드를 혼동하지 않는다', () => {
    expect(matchField('배달 엄수', REGISTRY)?.key).toBe('strictTime');
    expect(matchField('예식 시간', REGISTRY)?.key).toBe('eventTime');
    expect(matchField('배송주소', REGISTRY)?.key).toBe('deliveryAddress');
  });

  it('배달장소·배송장소 라벨도 배송 주소로 매핑한다', () => {
    expect(matchField('배달장소', REGISTRY)?.key).toBe('deliveryAddress');
    expect(matchField('배송장소', REGISTRY)?.key).toBe('deliveryAddress');
  });

  it('관련 없는 텍스트는 매칭하지 않는다', () => {
    expect(matchField('합계 금액', REGISTRY)).toBeNull();
  });
});

describe('parseLine', () => {
  it('콜론으로 라벨/값을 나눈다', () => {
    expect(parseLine('업체명: 더채플앳청담', REGISTRY)).toMatchObject({
      field: { key: 'venueName' },
      value: '더채플앳청담',
    });
  });

  it('값 안의 콜론(시간)은 라벨 구분자로 쓰지 않는다', () => {
    expect(parseLine('배달 엄수 10:30까지', REGISTRY)).toMatchObject({
      field: { key: 'strictTime' },
      value: '10:30까지',
    });
  });

  it('공백이 들어간 라벨은 가장 긴 매칭을 택해 값을 보존한다', () => {
    expect(parseLine('받는 분 김민준 실장', REGISTRY)).toMatchObject({
      field: { key: 'recipientName' },
      value: '김민준 실장',
    });
  });

  it('매칭 안 되는 줄은 값/고아로 둔다', () => {
    expect(parseLine('배송 인수증', REGISTRY)).toMatchObject({ field: null, label: '', value: '배송 인수증' });
  });
});

describe('normalizeReceipt', () => {
  const result = normalizeReceipt(
    [
      '배송 인수증',
      '배송일자 2026.06.21',
      '업체명 더채플앳청담',
      '배송주소 서울 강남구 선릉로 757 더채플앳청담 3층',
      '받는 분 김민준 실장',
      '연락처 010-4821-7732',
      '배달 엄수 10:30까지',
      '예식 시간 오전 11시',
      '상품 축하 3단 화환 2개',
      '요청사항 예식 시작 30분 전 설치 완료',
    ],
    REGISTRY,
  );

  it('혼합 레이아웃에서 지원 필드를 정확히 추출한다', () => {
    expect(result.fields).toEqual({
      productName: '축하 3단 화환 2개',
      deliveryDate: '2026.06.21',
      venueName: '더채플앳청담',
      deliveryAddress: '서울 강남구 선릉로 757 더채플앳청담 3층',
      recipientName: '김민준 실장',
      recipientTel: '010-4821-7732',
      strictTime: '10:30까지',
      eventTime: '오전 11시',
      memo: '예식 시작 30분 전 설치 완료',
    });
  });

  it('매칭 실패 줄은 버리지 않고 unmapped에 보존한다(무손실)', () => {
    expect(result.unmapped).toEqual([
      { label: '', value: '배송 인수증' },
    ]);
  });
});

describe('normalizeReceipt — 값→라벨 역순 레이아웃(표 셀 순서 뒤집힘)', () => {
  // 실제 인수증 표는 PP-OCR이 "값 → 라벨" 순으로 셀을 읽어내기도 한다.
  // (예: "서울 보라매병원 1호" 다음 줄에 라벨 "배달장소")
  it('라벨 줄이 값보다 뒤에 와도 직전 고아값을 필드로 되끌어온다', () => {
    const r = normalizeReceipt(
      ['서울 보라매병원 1호', '배달장소', '받는분 고인 김기회'],
      REGISTRY,
    );
    expect(r.fields.deliveryAddress).toBe('서울 보라매병원 1호');
    expect(r.fields.recipientName).toBe('고인 김기회');
    // 되끌어왔으므로 주소는 더 이상 unmapped에 남지 않는다.
    expect(r.unmapped.some((u) => u.value.includes('보라매'))).toBe(false);
  });

  it('직전 줄이 고아값이 아니면 되끌어오지 않는다(오연결 방지)', () => {
    const r = normalizeReceipt(['상품 축하 3단', '배달장소'], REGISTRY);
    // 직전은 상품명(필드)이라 배달장소는 값 없는 라벨로 남고 흡수 안 함.
    expect(r.fields.deliveryAddress).toBeUndefined();
    expect(r.fields.productName).toBe('축하 3단');
  });
});
