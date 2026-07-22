import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// 네비 탭 리플 · 수익 막대 rise-in 같은 Animated 연출은 React 상태로 모션 설정을
// 구독해야 한다(모듈 전역 플래그는 리렌더를 일으키지 않아 진행 중 토글을 놓친다).
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => {
        if (mounted) setReduce(Boolean(value));
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (value) => setReduce(Boolean(value)),
    );
    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);
  return reduce;
}

export const NAV_RIPPLE = {
  durationMs: 520,
  size: 44,
  fromOpacity: 0.22,
  fromScale: 0.35,
  toScale: 1.7,
} as const;

export const PROFIT_BARS = {
  durationMs: 700,
  // 막대마다 시작 시점을 조금씩 늦춰 좌→우 물결처럼 차오르게 한다.
  staggerStep: 0.07,
  maxStagger: 0.55,
  riseWindow: 0.45,
} as const;

export function barRiseStart(index: number): number {
  return Math.min(PROFIT_BARS.maxStagger, index * PROFIT_BARS.staggerStep);
}
