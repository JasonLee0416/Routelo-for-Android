export type CtcDecodeResult = {
  text: string;
  confidence: number;
};

// 한 스텝의 최대 클래스 확률을 돌려준다.
// 모델 출력이 이미 softmax 확률이면 그대로, 로짓이면 softmax의 최대 확률을 계산한다.
// (신뢰도가 [0,1] 확률이 되도록 보정 — 예전엔 raw 로짓 평균이라 임계/방향선택이 무의미했음.)
function stepMaxProbability(
  logits: Float32Array,
  offset: number,
  classes: number,
): { index: number; probability: number } {
  let bestIndex = 0;
  let bestValue = Number.NEGATIVE_INFINITY;
  let rowSum = 0;
  let rowMin = Number.POSITIVE_INFINITY;
  for (let character = 0; character < classes; character += 1) {
    const value = logits[offset + character];
    rowSum += value;
    if (value < rowMin) rowMin = value;
    if (value > bestValue) {
      bestValue = value;
      bestIndex = character;
    }
  }
  const looksLikeProbability =
    rowMin >= 0 && bestValue <= 1.0001 && Math.abs(rowSum - 1) < 0.05;
  if (looksLikeProbability) {
    return { index: bestIndex, probability: bestValue };
  }
  let denom = 0;
  for (let character = 0; character < classes; character += 1) {
    denom += Math.exp(logits[offset + character] - bestValue);
  }
  return { index: bestIndex, probability: denom > 0 ? 1 / denom : 0 };
}

export function decodeCtc(
  logits: Float32Array,
  steps: number,
  classes: number,
  dictionary: string[],
): CtcDecodeResult {
  const characters: string[] = [];
  let previous = -1;
  let confidenceSum = 0;
  let confidenceCount = 0;

  for (let step = 0; step < steps; step += 1) {
    const { index, probability } = stepMaxProbability(
      logits,
      step * classes,
      classes,
    );
    if (index !== 0 && index !== previous) {
      const decoded = dictionary[index - 1];
      if (decoded) {
        characters.push(decoded);
        confidenceSum += probability;
        confidenceCount += 1;
      }
    }
    previous = index;
  }

  return {
    text: characters.join('').trim(),
    confidence: confidenceCount ? confidenceSum / confidenceCount : 0,
  };
}
