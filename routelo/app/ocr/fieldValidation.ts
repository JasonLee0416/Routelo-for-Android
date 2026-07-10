import { OcrFieldResult } from '../models';

const PHONE_PATTERN =
  /(?<!\d)(?:01[016789][-\s]?\d{3,4}[-\s]?\d{4}|02[-\s]?\d{3,4}[-\s]?\d{4}|0[3-6]\d[-\s]?\d{3,4}[-\s]?\d{4})(?!\d)/;

const ADDRESS_HINT =
  /(?:서울|경기|인천|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|부산|대구|대전|광주|울산|세종|제주|[가-힣]{1,12}(?:시|군|구)\s+[가-힣0-9]{1,20}(?:로|길|동|읍|면|리))/u;

const ADDRESS_DETAIL_HINT =
  /(?:[가-힣0-9]+(?:로|길)\s*\d|[가-힣]+(?:동|읍|면|리)\s*\d|(?:빌딩|센터|회관|웨딩|예식장|병원|장례식장|아파트|상가|층|호))/u;

const LABEL_OR_PHONE_HINT =
  /(?:tel|hp|전화|연락처|휴대폰|핸드폰|받는\s*분|수령|인수|발주|배송|화원|주문|상품|리본|메모|비고)/iu;

const VENDOR_BLOCKLIST =
  /(?:tel|hp|전화|연락처|주소|배송지|수령|인수|받는\s*분|상품|화환|근조|축하|리본|메모|비고)/iu;

const PRODUCT_HINT = /(?:화환|근조|축하|쌀화환|난|동양란|서양란|꽃바구니|꽃다발|분화|개업|조화)/u;

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function hasPhone(value: string) {
  return PHONE_PATTERN.test(value);
}

function rejectValue(
  field: OcrFieldResult,
  reason: string,
): OcrFieldResult {
  return {
    ...field,
    value: '',
    confidence: 0,
    status: field.required ? 'missing' : 'warning',
    validationErrors: [...(field.validationErrors || []), reason],
  };
}

function warnValue(
  field: OcrFieldResult,
  reason: string,
): OcrFieldResult {
  return {
    ...field,
    status: field.status === 'missing' ? 'missing' : 'warning',
    validationErrors: [...(field.validationErrors || []), reason],
  };
}

function validateAddress(field: OcrFieldResult) {
  const value = compact(field.value);
  if (!value) return field;
  if (hasPhone(value) || LABEL_OR_PHONE_HINT.test(value)) {
    return rejectValue(
      field,
      'Address candidate contains label, phone, or recipient/vendor text.',
    );
  }
  if (!ADDRESS_HINT.test(value)) {
    return rejectValue(
      field,
      'Address candidate does not contain a recognizable Korean address pattern.',
    );
  }
  if (!ADDRESS_DETAIL_HINT.test(value)) {
    return warnValue(
      field,
      'Address candidate needs review because it lacks road/building detail.',
    );
  }
  return field;
}

function validatePhone(field: OcrFieldResult) {
  const value = compact(field.value);
  if (!value) return field;
  if (!hasPhone(value)) {
    return rejectValue(field, 'Phone candidate does not match Korean phone format.');
  }
  return field;
}

function validateVendorName(field: OcrFieldResult) {
  const value = compact(field.value);
  if (!value) return field;
  if (hasPhone(value) || VENDOR_BLOCKLIST.test(value) || value.length > 40) {
    return rejectValue(
      field,
      'Vendor candidate contains non-vendor evidence and must not be auto-filled.',
    );
  }
  return field;
}

function validateProductName(field: OcrFieldResult) {
  const value = compact(field.value);
  if (!value) return field;
  if (!PRODUCT_HINT.test(value)) {
    return warnValue(
      field,
      'Product candidate lacks known floral delivery product evidence.',
    );
  }
  return field;
}

function validateRecipientName(field: OcrFieldResult) {
  const value = compact(field.value);
  if (!value) return field;
  if (hasPhone(value) || LABEL_OR_PHONE_HINT.test(value) || ADDRESS_HINT.test(value)) {
    return rejectValue(
      field,
      'Recipient candidate contains label, phone, or address evidence.',
    );
  }
  return field;
}

export function applyOfficialOcrFieldGuardrails(
  fields: OcrFieldResult[],
): OcrFieldResult[] {
  return fields.map((field) => {
    switch (field.key) {
      case 'deliveryAddress':
        return validateAddress(field);
      case 'orderingVendorTel':
      case 'fulfillingVendorTel':
      case 'recipientTel':
        return validatePhone(field);
      case 'orderingVendorName':
      case 'fulfillingVendorName':
      case 'venueName':
        return validateVendorName(field);
      case 'productName':
        return validateProductName(field);
      case 'recipientName':
        return validateRecipientName(field);
      default:
        return field;
    }
  });
}
