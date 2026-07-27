import { OcrFieldKey, OcrFieldResult, OcrPipelineResult } from '../models';

const getField = (fields: OcrFieldResult[], key: OcrFieldKey) =>
  fields.find((field) => field.key === key);

const hasValue = (field?: OcrFieldResult) => Boolean(field?.value.trim());

function classifyEvent(fields: OcrFieldResult[]): OcrPipelineResult['eventType'] {
  const text = [
    getField(fields, 'productName')?.value,
    getField(fields, 'ribbonText')?.value,
    getField(fields, 'memo')?.value,
  ]
    .filter(Boolean)
    .join(' ');

  if (/근조|조의|부의|상가|장례|빈소/.test(text)) {
    return { type: 'condolence', confidence: 86 };
  }
  if (/개업|오픈|창립|준공/.test(text)) {
    return { type: 'opening', confidence: 80 };
  }
  if (/축하|예식|결혼|웨딩|화환/.test(text)) {
    return { type: 'congratulation', confidence: 78 };
  }
  return { type: 'other', confidence: 40 };
}

function phoneKind(value: string): 'direct' | 'safe' | undefined {
  const digits = value.replace(/\D/g, '');
  if (!digits) return undefined;
  if (/^(15|16|18)\d{6}$/.test(digits) || digits.startsWith('070')) {
    return 'safe';
  }
  if (digits.startsWith('010') || digits.startsWith('02') || /^0[3-6]\d/.test(digits)) {
    return 'direct';
  }
  return undefined;
}

function detectConflicts(fields: OcrFieldResult[]) {
  const conflicts: OcrPipelineResult['conflicts'] = [];
  const strictTime = getField(fields, 'strictTime');
  const eventTime = getField(fields, 'eventTime');
  if (
    strictTime?.value &&
    eventTime?.value &&
    strictTime.value === eventTime.value &&
    strictTime.sourceText !== eventTime.sourceText
  ) {
    conflicts.push({
      keys: ['strictTime', 'eventTime'],
      message: 'Strict delivery time and event time are identical but came from different receipt evidence.',
    });
  }
  return conflicts;
}

export function enrichOcrPipelineResult(
  result: OcrPipelineResult,
): OcrPipelineResult {
  const fields = result.fields.map((field) =>
    field.key === 'recipientTel' ||
    field.key === 'orderingVendorTel' ||
    field.key === 'fulfillingVendorTel'
      ? { ...field, phoneKind: phoneKind(field.value) }
      : field,
  );
  const missingRequired = fields
    .filter((field) => field.required && !hasValue(field))
    .map((field) => field.label);
  const lowConfidence = result.documentConfidence < 82;
  const warningFields = fields.filter(
    (field) => field.status === 'warning' || field.status === 'review',
  );
  const conflicts = detectConflicts(fields);
  const reasons = [
    ...missingRequired.map((label) => `필수 항목 누락: ${label}`),
    ...(lowConfidence ? [`문서 신뢰도 낮음: ${result.documentConfidence}%`] : []),
    ...warningFields
      .filter((field) => field.required)
      .map((field) => `필수 항목 확인 필요: ${field.label}`),
    ...conflicts.map((conflict) => conflict.message),
  ];

  return {
    ...result,
    fields,
    conflicts,
    cloudFallback: {
      trigger: reasons.length > 0,
      reasons,
    },
    eventType: classifyEvent(fields),
  };
}
