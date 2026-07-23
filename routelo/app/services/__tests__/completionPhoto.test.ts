import {
  COMPLETION_PHOTO_DIR,
  completionPhotoRelativePath,
  isSafePhotoPath,
  photoRelativePath,
  RECEIPT_PHOTO_DIR,
} from '../completionPhoto';

describe('photo paths', () => {
  it('keeps completion and receipt photos in separate directories', () => {
    expect(completionPhotoRelativePath('order-1', '123')).toBe(
      `${COMPLETION_PHOTO_DIR}/order-1-123.jpg`,
    );
    expect(photoRelativePath(RECEIPT_PHOTO_DIR, 'order-1', '123')).toBe(
      `${RECEIPT_PHOTO_DIR}/order-1-123.jpg`,
    );
  });

  it('sanitizes ids so they cannot escape the photo directory', () => {
    const path = photoRelativePath(RECEIPT_PHOTO_DIR, '../../etc/passwd', 'a b');
    expect(path.startsWith(`${RECEIPT_PHOTO_DIR}/`)).toBe(true);
    expect(path).not.toContain('..');
    expect(path).not.toContain(' ');
  });

  it('stores a relative path so it survives a container change', () => {
    // 절대 경로를 저장하면 앱 컨테이너 UUID가 바뀔 때 사진을 잃는다.
    const path = photoRelativePath(RECEIPT_PHOTO_DIR, 'order-1', '1');
    expect(path.startsWith('file:')).toBe(false);
    expect(path.startsWith('/')).toBe(false);
  });
});

describe('isSafePhotoPath', () => {
  it('accepts paths this app writes', () => {
    expect(isSafePhotoPath(completionPhotoRelativePath('order-1', '1'))).toBe(
      true,
    );
    expect(
      isSafePhotoPath(photoRelativePath(RECEIPT_PHOTO_DIR, 'order-1', '1')),
    ).toBe(true);
  });

  it('rejects traversal and foreign paths that arrive via backups', () => {
    // 손댄 백업 JSON의 receiptPhotoPath가 그대로 file:// URI가 되면 안 된다.
    expect(isSafePhotoPath('../../../etc/passwd')).toBe(false);
    expect(isSafePhotoPath(`${RECEIPT_PHOTO_DIR}/../../secret.jpg`)).toBe(false);
    expect(isSafePhotoPath('other-dir/a.jpg')).toBe(false);
    expect(isSafePhotoPath(`${RECEIPT_PHOTO_DIR}/a.png`)).toBe(false);
    expect(isSafePhotoPath('')).toBe(false);
    expect(isSafePhotoPath(undefined)).toBe(false);
  });
});
