/** 음수 기호: 하이픈이 아니라 마이너스 기호 U+2212 (design.md 2.3) */
export const MINUS = '\u2212';

/** 금액 표시: 천 단위 구분 + '원'. 음수는 앞에 '−'(U+2212). 화면낭독 "마이너스"는 금액 컴포넌트가 맡는다 */
export function formatWon(amount: number): string {
  const sign = amount < 0 ? MINUS : '';
  return `${sign}${Math.abs(amount).toLocaleString('ko-KR')}원`;
}

/** 비율 표시: 정수 % */
export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
