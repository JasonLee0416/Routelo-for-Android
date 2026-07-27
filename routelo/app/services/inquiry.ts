// 문의하기(개발자 전송) 순수 로직. UI(index.tsx ContactScreen)와 분리해 테스트한다.

// 관리자(개발자) 수신 주소 — UI에는 노출하지 않는다(유저에게 안 보임).
export const DEVELOPER_INQUIRY_EMAIL = 'sinsgerm@gmail.com';

// Web3Forms 액세스 키(무료, sinsgerm@gmail.com에 연결). 값이 있으면 수신자 숨김·
// 자동 전송·이미지 첨부가 활성화된다. 비어 있으면 기기 메일앱(mailto)으로 폴백.
// 발급: https://web3forms.com (이메일 sinsgerm@gmail.com로 폼 생성 → access key).
export const INQUIRY_ACCESS_KEY = '';

export const INQUIRY_TYPES = ['버그·오류', '인식 오류', '기능 제안', '기타'];

export const INQUIRY_CONTENT_MIN = 10;
export const INQUIRY_SUBJECT_MAX = 200;
export const INQUIRY_CONTENT_MAX = 5000;
export const INQUIRY_IMAGE_MAX = 5;
export const INQUIRY_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5MB/장

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InquiryDraft = {
  email: string;
  type: string;
  subject: string;
  content: string;
};

export function isInquiryComplete(draft: InquiryDraft): boolean {
  return (
    EMAIL_RE.test(draft.email.trim()) &&
    Boolean(draft.type) &&
    draft.subject.trim().length > 0 &&
    draft.content.trim().length >= INQUIRY_CONTENT_MIN
  );
}

export function buildInquirySubject(type: string, subject: string): string {
  return `[ROUTELO 문의] ${type} · ${subject.trim()}`;
}

// mailto 본문. URL 길이 폭주를 막기 위해 본문을 안전 길이로 자른다(인코딩 시
// 한글 1자가 ~9바이트로 늘어 5000자면 URL이 4만자를 넘어 메일앱이 실패할 수 있음).
export const MAILTO_BODY_MAX = 1400;

export function buildInquiryMailtoBody(draft: InquiryDraft & { imageCount: number }): string {
  const head = `문의 유형: ${draft.type}\n회신 이메일: ${draft.email.trim()}\n\n`;
  const tail = draft.imageCount
    ? `\n\n(첨부 이미지 ${draft.imageCount}장은 메일 작성 화면에서 직접 추가해 주세요.)`
    : '';
  const budget = MAILTO_BODY_MAX - head.length - tail.length;
  const content = draft.content.trim();
  const body = content.length > budget ? `${content.slice(0, Math.max(0, budget - 1))}…` : content;
  return head + body + tail;
}

export function buildInquiryMailtoUrl(draft: InquiryDraft & { imageCount: number }): string {
  const subject = encodeURIComponent(buildInquirySubject(draft.type, draft.subject));
  const body = encodeURIComponent(buildInquiryMailtoBody(draft));
  return `mailto:${DEVELOPER_INQUIRY_EMAIL}?subject=${subject}&body=${body}`;
}
