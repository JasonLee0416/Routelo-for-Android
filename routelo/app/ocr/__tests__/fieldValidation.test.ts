import { OcrFieldResult } from '../../models';
import { applyOfficialOcrFieldGuardrails } from '../fieldValidation';

function makeField(
  key: OcrFieldResult['key'],
  value: string,
  required = false,
): OcrFieldResult {
  return {
    key,
    label: key,
    value,
    rawValue: value,
    confidence: 84,
    required,
    sourceText: value,
    alternatives: [],
    status: 'review',
  };
}

describe('official OCR field guardrails', () => {
  it('rejects recipient or telephone text that was incorrectly mapped as address', () => {
    const [field] = applyOfficialOcrFieldGuardrails([
      makeField('deliveryAddress', '받는분: 고인김기회 TEL', true),
    ]);

    expect(field.value).toBe('');
    expect(field.status).toBe('missing');
    expect(field.validationErrors?.[0]).toContain('Address candidate');
  });

  it('keeps Korean road addresses that include district and road detail', () => {
    const [field] = applyOfficialOcrFieldGuardrails([
      makeField('deliveryAddress', '서울 강남구 테헤란로 123 예식장 3층', true),
    ]);

    expect(field.value).toBe('서울 강남구 테헤란로 123 예식장 3층');
    expect(field.validationErrors).toBeUndefined();
  });

  it('rejects vendor names that contain phone labels or phone numbers', () => {
    const [field] = applyOfficialOcrFieldGuardrails([
      makeField('orderingVendorName', '행복화원 TEL 02-123-4567'),
    ]);

    expect(field.value).toBe('');
    expect(field.status).toBe('warning');
  });

  it('rejects malformed phone candidates instead of auto-confirming them', () => {
    const [field] = applyOfficialOcrFieldGuardrails([
      makeField('recipientTel', '받는분 고인김기회'),
    ]);

    expect(field.value).toBe('');
    expect(field.validationErrors?.[0]).toContain('Phone candidate');
  });
});
