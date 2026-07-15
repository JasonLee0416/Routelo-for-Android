import * as FileSystem from 'expo-file-system/legacy';

export const COMPLETION_PHOTO_DIR = 'completion-photos';

const withSlash = (value: string) => (value.endsWith('/') ? value : `${value}/`);
const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_') || 'x';

export function completionPhotoRelativePath(orderId: string, token: string) {
  return `${COMPLETION_PHOTO_DIR}/${safe(orderId)}-${safe(token)}.jpg`;
}

export function completionPhotoUri(relativePath: string) {
  return `${withSlash(FileSystem.documentDirectory || '')}${relativePath}`;
}

export async function persistCompletionPhoto(
  orderId: string,
  sourceUri: string,
  token = String(Date.now()),
): Promise<string> {
  const documentDir = withSlash(FileSystem.documentDirectory || '');
  const dir = `${documentDir}${COMPLETION_PHOTO_DIR}/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  const relativePath = completionPhotoRelativePath(orderId, token);
  await FileSystem.copyAsync({
    from: sourceUri,
    to: `${documentDir}${relativePath}`,
  });
  return relativePath;
}
