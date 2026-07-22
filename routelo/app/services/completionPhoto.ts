import * as FileSystem from 'expo-file-system/legacy';

export const COMPLETION_PHOTO_DIR = 'completion-photos';
export const RECEIPT_PHOTO_DIR = 'receipt-photos';

const withSlash = (value: string) => (value.endsWith('/') ? value : `${value}/`);
const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_') || 'x';

export function photoRelativePath(dir: string, orderId: string, token: string) {
  return `${dir}/${safe(orderId)}-${safe(token)}.jpg`;
}

export function completionPhotoRelativePath(orderId: string, token: string) {
  return photoRelativePath(COMPLETION_PHOTO_DIR, orderId, token);
}

// 저장은 상대 경로, 표시는 현재 문서 디렉터리 기준으로 다시 해석한다.
export function completionPhotoUri(relativePath: string) {
  return `${withSlash(FileSystem.documentDirectory || '')}${relativePath}`;
}

export const receiptPhotoUri = completionPhotoUri;

async function persistPhoto(
  dir: string,
  orderId: string,
  sourceUri: string,
  token: string,
): Promise<string> {
  const documentDir = withSlash(FileSystem.documentDirectory || '');
  const target = `${documentDir}${dir}/`;
  const info = await FileSystem.getInfoAsync(target);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(target, { intermediates: true });
  }
  const relativePath = photoRelativePath(dir, orderId, token);
  await FileSystem.copyAsync({
    from: sourceUri,
    to: `${documentDir}${relativePath}`,
  });
  return relativePath;
}

export function persistCompletionPhoto(
  orderId: string,
  sourceUri: string,
  token = String(Date.now()),
): Promise<string> {
  return persistPhoto(COMPLETION_PHOTO_DIR, orderId, sourceUri, token);
}

// 인수증 원본을 보관해 달력에서 과거 기록을 다시 열람할 수 있게 한다.
export function persistReceiptPhoto(
  orderId: string,
  sourceUri: string,
  token = String(Date.now()),
): Promise<string> {
  return persistPhoto(RECEIPT_PHOTO_DIR, orderId, sourceUri, token);
}
