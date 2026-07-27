import { ArchivedReceipt } from '../../domain';
import { OcrPipelineResult } from '../../models';
import {
  archiveScannedReceipt,
  deleteArchivedReceipt,
  listArchivedReceiptWeeks,
  ReceiptArchiveDeps,
} from '../receiptArchive';

function makeFakeDeps(now: () => string) {
  const store: ArchivedReceipt[] = [];
  const deletedFiles: string[] = [];
  const deps: ReceiptArchiveDeps = {
    list: async () => [...store],
    listNewestFirst: async () =>
      [...store].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)),
    save: async (record) => {
      const index = store.findIndex((item) => item.id === record.id);
      if (index >= 0) store[index] = record;
      else store.push(record);
    },
    remove: async (id) => {
      const index = store.findIndex((item) => item.id === id);
      if (index >= 0) store.splice(index, 1);
    },
    persistImage: async (id) => `receipt-photos/${id}-archive.jpg`,
    resolveUri: (relativePath) => `file:///doc/${relativePath}`,
    deleteFile: async (uri) => {
      deletedFiles.push(uri);
    },
    now,
  };
  return { deps, store, deletedFiles };
}

const makeResult = (overrides: Partial<OcrPipelineResult> = {}): OcrPipelineResult => ({
  engine: 'fixture',
  rawText: '축하화환\n서울 강남구',
  fields: [
    {
      key: 'deliveryAddress',
      label: '배송 주소',
      value: '서울 강남구 테헤란로 1',
      confidence: 70,
      required: true,
      sourceText: '',
      alternatives: [],
      status: 'review',
    },
    {
      key: 'productName',
      label: '상품명',
      value: '근조화환',
      confidence: 80,
      required: true,
      sourceText: '',
      alternatives: [],
      status: 'review',
    },
  ],
  documentConfidence: 61,
  quality: {
    score: 90,
    blur: 90,
    brightness: 90,
    documentCoverage: 90,
    skew: 90,
    shadow: 90,
    passed: true,
    messages: [],
  },
  processingMs: 1,
  variantsCompared: 1,
  unmapped: [],
  ...overrides,
});

describe('receipt archive service', () => {
  it('촬영본을 이미지 경로·주별 키·요약과 함께 저장한다', async () => {
    const { deps, store } = makeFakeDeps(() => '2026-06-10T09:00:00.000Z');
    const record = await archiveScannedReceipt(
      { id: 'receipt-1', imageUri: 'file:///cam/a.jpg', result: makeResult() },
      deps,
    );
    expect(store).toHaveLength(1);
    expect(record.imagePath).toBe('receipt-photos/receipt-1-archive.jpg');
    expect(record.weekKey).toMatch(/^2026-W\d{2}$/);
    expect(record.summary?.deliveryAddress).toBe('서울 강남구 테헤란로 1');
    expect(record.summary?.productName).toBe('근조화환');
    expect(record.summary?.documentConfidence).toBe(61);
  });

  it('같은 id로 재보관하면 중복을 만들지 않고 덮어쓴다', async () => {
    const { deps, store } = makeFakeDeps(() => '2026-06-10T09:00:00.000Z');
    await archiveScannedReceipt({ id: 'r', imageUri: 'file:///a.jpg' }, deps);
    await archiveScannedReceipt(
      { id: 'r', imageUri: 'file:///a.jpg', result: makeResult() },
      deps,
    );
    expect(store).toHaveLength(1);
    expect(store[0].summary?.productName).toBe('근조화환');
  });

  it('삭제 시 레코드와 원본 이미지 파일을 함께 제거한다', async () => {
    const { deps, store, deletedFiles } = makeFakeDeps(
      () => '2026-06-10T09:00:00.000Z',
    );
    await archiveScannedReceipt({ id: 'r', imageUri: 'file:///a.jpg' }, deps);
    await deleteArchivedReceipt('r', deps);
    expect(store).toHaveLength(0);
    expect(deletedFiles).toEqual(['file:///doc/receipt-photos/r-archive.jpg']);
  });

  it('주별로 묶어 최신 주가 먼저 오도록 반환한다', async () => {
    let clock = '2026-06-01T09:00:00.000Z';
    const { deps } = makeFakeDeps(() => clock);
    clock = '2026-06-02T09:00:00.000Z'; // 6월 첫째 주
    await archiveScannedReceipt({ id: 'a', imageUri: 'file:///a.jpg' }, deps);
    clock = '2026-06-16T09:00:00.000Z'; // 2주 뒤
    await archiveScannedReceipt({ id: 'b', imageUri: 'file:///b.jpg' }, deps);
    clock = '2026-06-17T09:00:00.000Z'; // 같은 주(b와)
    await archiveScannedReceipt({ id: 'c', imageUri: 'file:///c.jpg' }, deps);

    const weeks = await listArchivedReceiptWeeks(deps);
    expect(weeks).toHaveLength(2);
    // 최신 주(6-16/17)가 먼저.
    expect(weeks[0].receipts.map((r) => r.id).sort()).toEqual(['b', 'c']);
    expect(weeks[1].receipts.map((r) => r.id)).toEqual(['a']);
    expect(weeks[0].label).toMatch(/^\d{4}\.\d{2}\.\d{2} ~ \d{2}\.\d{2}$/);
  });
});
