import {
  DEVELOPER_INQUIRY_EMAIL,
  MAILTO_BODY_MAX,
  buildInquiryMailtoBody,
  buildInquiryMailtoUrl,
  buildInquirySubject,
  isInquiryComplete,
} from '../inquiry';

const draft = (over = {}) => ({
  email: 'user@example.com',
  type: '버그·오류',
  subject: '앱이 멈춰요',
  content: '스캔 후 결과 화면에서 멈춥니다.',
  ...over,
});

describe('inquiry validation', () => {
  it('모든 필수값이 유효하면 완료로 본다', () => {
    expect(isInquiryComplete(draft())).toBe(true);
  });
  it('이메일 형식이 틀리면 미완료', () => {
    expect(isInquiryComplete(draft({ email: 'not-an-email' }))).toBe(false);
  });
  it('유형 미선택이면 미완료', () => {
    expect(isInquiryComplete(draft({ type: '' }))).toBe(false);
  });
  it('제목이 비면 미완료', () => {
    expect(isInquiryComplete(draft({ subject: '   ' }))).toBe(false);
  });
  it('내용이 10자 미만이면 미완료', () => {
    expect(isInquiryComplete(draft({ content: '짧음' }))).toBe(false);
  });
});

describe('inquiry mailto builder', () => {
  it('제목에 유형과 제목을 담는다', () => {
    expect(buildInquirySubject('버그·오류', ' 앱 멈춤 ')).toBe(
      '[ROUTELO 문의] 버그·오류 · 앱 멈춤',
    );
  });

  it('본문에 유형·회신이메일·내용을 담고 첨부 안내를 붙인다', () => {
    const body = buildInquiryMailtoBody({ ...draft(), imageCount: 2 });
    expect(body).toContain('문의 유형: 버그·오류');
    expect(body).toContain('회신 이메일: user@example.com');
    expect(body).toContain('첨부 이미지 2장');
  });

  it('긴 내용은 URL 폭주 방지를 위해 잘라낸다', () => {
    const long = '가'.repeat(5000);
    const body = buildInquiryMailtoBody({ ...draft({ content: long }), imageCount: 0 });
    expect(body.length).toBeLessThanOrEqual(MAILTO_BODY_MAX);
    expect(body.endsWith('…')).toBe(true);
  });

  it('mailto URL은 개발자 주소로 향한다', () => {
    const url = buildInquiryMailtoUrl({ ...draft(), imageCount: 0 });
    expect(url.startsWith(`mailto:${DEVELOPER_INQUIRY_EMAIL}?`)).toBe(true);
    expect(url).toContain('subject=');
    expect(url).toContain('body=');
  });
});
