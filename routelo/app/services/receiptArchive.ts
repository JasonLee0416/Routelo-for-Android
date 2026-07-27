import * as FileSystem from 'expo-file-system/legacy';

import {
  ArchivedReceipt,
  DOMAIN_SCHEMA_VERSION,
  isoWeekKey,
  weekRangeLabel,
} from '../domain';
import { OcrPipelineResult } from '../models';
import type { LocalReceiptArchiveRepository } from '../repositories/local';
import { persistReceiptPhoto, receiptPhotoUri } from './completionPhoto';

// 저장소(AsyncStorage 의존)는 지연 로드한다. deps를 주입하는 테스트에서는
// 이 경로가 실행되지 않아 네이티브 모듈을 로드하지 않는다.
let cachedRepository: LocalReceiptArchiveRepository | undefined;
function archiveRepository(): LocalReceiptArchiveRepository {
  if (!cachedRepository) {
    cachedRepository =
      require('../repositories/native').receiptArchiveRepository as LocalReceiptArchiveRepository;
  }
  return cachedRepository;
}

// 촬영한 인수증을 주별로 영구 보관하기 위한 서비스. 원본 이미지를 앱 문서
// 디렉터리(receipt-photos/…)로 복사하고 경량 레코드를 저장한다. 사용자가
// 명시적으로 삭제하기 전까지 유지된다.

export type ArchiveWeekGroup = {
  weekKey: string;
  label: string;
  receipts: ArchivedReceipt[];
};

export type ReceiptArchiveDeps = {
  list: () => Promise<ArchivedReceipt[]>;
  listNewestFirst: () => Promise<ArchivedReceipt[]>;
  save: (record: ArchivedReceipt) => Promise<void>;
  remove: (id: string) => Promise<void>;
  persistImage: (id: string, sourceUri: string) => Promise<string>;
  resolveUri: (relativePath: string) => string | undefined;
  deleteFile: (uri: string) => Promise<void>;
  now: () => string;
};

const defaultDeps: ReceiptArchiveDeps = {
  list: () => archiveRepository().list(),
  listNewestFirst: () => archiveRepository().listNewestFirst(),
  save: (record) => archiveRepository().save(record),
  remove: (id) => archiveRepository().remove(id),
  // 보관 전용 토큰으로 복사 → receipt-photos/{id}-archive.jpg
  persistImage: (id, sourceUri) => persistReceiptPhoto(id, sourceUri, 'archive'),
  resolveUri: (relativePath) => receiptPhotoUri(relativePath),
  deleteFile: (uri) => FileSystem.deleteAsync(uri, { idempotent: true }),
  now: () => new Date().toISOString(),
};

function summarize(result: OcrPipelineResult): ArchivedReceipt['summary'] {
  const valueOf = (key: string) =>
    result.fields.find((field) => field.key === key)?.value?.trim() || undefined;
  return {
    deliveryAddress: valueOf('deliveryAddress'),
    recipientName: valueOf('recipientName'),
    productName: valueOf('productName'),
    documentConfidence: result.documentConfidence,
  };
}

/**
 * 촬영본을 보관함에 저장/갱신한다. 같은 id로 다시 호출하면(같은 촬영의 재분석)
 * 레코드를 덮어써 중복을 만들지 않는다. 이미지 복사가 실패해도 예외를 던지지
 * 않고 이미지 없는 레코드로 저장을 시도하지 않는다(경로 없으면 throw).
 */
export async function archiveScannedReceipt(
  input: { id: string; imageUri: string; result?: OcrPipelineResult; linkedDeliveryId?: string },
  deps: ReceiptArchiveDeps = defaultDeps,
): Promise<ArchivedReceipt> {
  const capturedAt = deps.now();
  const imagePath = await deps.persistImage(input.id, input.imageUri);
  const record: ArchivedReceipt = {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    id: input.id,
    imagePath,
    capturedAt,
    weekKey: isoWeekKey(capturedAt),
    summary: input.result ? summarize(input.result) : undefined,
    linkedDeliveryId: input.linkedDeliveryId,
  };
  await deps.save(record);
  return record;
}

/** 보관함 레코드를 삭제하고 원본 이미지 파일도 지운다(사용자 명시 삭제 전용). */
export async function deleteArchivedReceipt(
  id: string,
  deps: ReceiptArchiveDeps = defaultDeps,
): Promise<void> {
  const record = (await deps.list()).find((item) => item.id === id);
  if (record) {
    const uri = deps.resolveUri(record.imagePath);
    if (uri) {
      await deps.deleteFile(uri).catch(() => undefined);
    }
  }
  await deps.remove(id);
}

/** 최신 주가 위로 오도록 주별로 묶어 반환한다. */
export async function listArchivedReceiptWeeks(
  deps: ReceiptArchiveDeps = defaultDeps,
): Promise<ArchiveWeekGroup[]> {
  const records = await deps.listNewestFirst();
  const groups = new Map<string, ArchivedReceipt[]>();
  for (const record of records) {
    const key = record.weekKey || 'unknown';
    const bucket = groups.get(key);
    if (bucket) bucket.push(record);
    else groups.set(key, [record]);
  }
  return [...groups.entries()]
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([weekKey, receipts]) => ({
      weekKey,
      label: receipts[0] ? weekRangeLabel(receipts[0].capturedAt) : weekKey,
      receipts,
    }));
}
