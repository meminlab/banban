/** 금액 표시: 천 단위 구분 + '원'. 음수는 앞에 '-' */
export function formatWon(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}${Math.abs(amount).toLocaleString('ko-KR')}원`;
}

/** 비율 표시: 정수 % */
export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
