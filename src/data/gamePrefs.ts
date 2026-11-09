/**
 * 미니게임 기기 설정 (design.md 5.32): 진동 켜기 — 기본 꺼짐, 이 기기에만 저장.
 * 진동은 반반 쌓기에서만 쓴다(오목은 1차 규칙대로 진동 없음).
 */
const VIBRATE_KEY = 'banban.game.vibrate';

export function readGameVibrate(): boolean {
  try {
    return localStorage.getItem(VIBRATE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveGameVibrate(on: boolean): void {
  try {
    if (on) localStorage.setItem(VIBRATE_KEY, '1');
    else localStorage.removeItem(VIBRATE_KEY);
  } catch {
    // 저장 못 하면 이번 화면에서만 적용된다
  }
}

/** 기기가 진동을 지원하나 (iOS Safari 는 지원하지 않는다) */
export const canVibrate = (): boolean => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

/** 진동 켬일 때만 울린다. 지원하지 않는 기기는 조용히 넘어간다 */
export function vibrate(pattern: number | number[]): void {
  if (!readGameVibrate() || !canVibrate()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // 무시
  }
}
