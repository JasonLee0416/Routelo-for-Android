// 숫자 문맥에서 흔한 혼동 문자를 숫자로 교정한다 (O→0, I/l→1, S→5, B→8 등).
// 반드시 "숫자 필드"(전화·날짜·시간·수량 등)에만 적용한다. 일반 텍스트/상품코드에
// 적용하면 오히려 손상되므로, 필드 스코프 안에서만 호출하고 뒤에 패턴 검증을 둔다.

const DIGIT_CONFUSABLES: Record<string, string> = {
  O: '0',
  o: '0',
  D: '0',
  Q: '0',
  I: '1',
  l: '1',
  L: '1',
  i: '1',
  Z: '2',
  z: '2',
  E: '3',
  A: '4',
  S: '5',
  s: '5',
  G: '6',
  b: '6',
  T: '7',
  B: '8',
  g: '9',
  q: '9',
};

const CONFUSABLES = Object.keys(DIGIT_CONFUSABLES).join('');
// 숫자+혼동문자+구분자(. : / , -)로 이뤄진 런. -는 클래스 끝에 둔다.
const RUN_PATTERN = new RegExp(`[0-9${CONFUSABLES}.:/,-]{2,}`, 'g');
const MAP_PATTERN = new RegExp(`[${CONFUSABLES}]`, 'g');

// 실제 숫자가 2개 이상인 런에서만 혼동 문자를 숫자로 치환.
export function fixConfusableDigits(text: string): string {
  return text.replace(RUN_PATTERN, (run) => {
    const digitCount = (run.match(/[0-9]/g) || []).length;
    if (digitCount < 2) return run;
    return run.replace(MAP_PATTERN, (char) => DIGIT_CONFUSABLES[char] ?? char);
  });
}
