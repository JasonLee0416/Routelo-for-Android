/// <reference types="node" />

import fs from 'fs';
import path from 'path';

import { inspectCaptureQuality, parseReceiptText } from '../ocr';

const datasetRoot = path.resolve(
  __dirname,
  '../../../../benchmarks/ocr/receipt-samples',
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(datasetRoot, 'manifest.json'), 'utf8'),
) as {
  samples: Array<{
    image: string;
    rawGoldenText: string;
  }>;
};

const compact = (value: string) =>
  value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

describe('receipt golden text parser benchmark', () => {
  it('parses core Korean receipt fields from the first golden sample', () => {
    const sample = manifest.samples[0];
    const rawText = fs.readFileSync(
      path.join(datasetRoot, sample.rawGoldenText),
      'utf8',
    );
    const parsed = parseReceiptText(
      rawText,
      inspectCaptureQuality({ width: 1440, height: 1920 }),
    );
    const valueOf = (key: string) =>
      parsed.fields.find((field) => field.key === key)?.value;

    expect(valueOf('orderingVendorName')).toBe('아뜰리에몽플라워');
    expect(valueOf('productName')).toContain('축하');
    expect(valueOf('productQuantity')).toBe('3');
    expect(valueOf('deliveryDate')).toBe('2026-06-14');
    expect(valueOf('eventTime')).toBe('12:20');
    expect(valueOf('deliveryAddress')).toContain('서울 영등포구 공군호텔');
    expect(valueOf('memo')).toBe('반드시 이름으로');
  });

  it('never confirms a populated parser field without source text or raw-text evidence', () => {
    for (const sample of manifest.samples) {
      const rawText = fs.readFileSync(
        path.join(datasetRoot, sample.rawGoldenText),
        'utf8',
      );
      const parsed = parseReceiptText(
        rawText,
        inspectCaptureQuality({ width: 1440, height: 1920 }),
      );
      const compactRaw = compact(rawText);
      for (const field of parsed.fields) {
        if (!field.value.trim()) continue;
        const sourceSupported =
          field.sourceText && compactRaw.includes(compact(field.sourceText));
        const valueSupported = compactRaw.includes(compact(field.value));
        expect({
          image: sample.image,
          key: field.key,
          value: field.value,
          sourceText: field.sourceText,
        }).toEqual(
          expect.objectContaining(
            sourceSupported || valueSupported
              ? {}
              : { unsupportedFieldMustFail: true },
          ),
        );
      }
    }
  });
});
