/** 금액(원) 표시·입력 — 화면과 무관한 순수 함수 */

/** 내역 금액·자산 잔액 상한 (명세 보강 Q4) */
export const MAX_WON = 9_999_999_999;

/** 1234567 → "1,234,567" */
export function formatWon(n: number): string {
  return Math.trunc(n).toLocaleString('ko-KR');
}

/**
 * 입력 중인 금액 문자열에 천 단위 쉼표를 넣는다.
 * 숫자·쉼표 외 문자(-, . 등)가 있으면 그대로 둬서 저장 시 오류로 알려 준다.
 */
export function formatWonInput(raw: string): string {
  if (!/^[\d,]*$/.test(raw)) return raw;
  const digits = raw.replace(/,/g, '').replace(/^0+(?=\d)/, '');
  return digits === '' ? '' : Number(digits).toLocaleString('ko-KR');
}

export type ParseWonResult =
  | { ok: true; value: number }
  | { ok: false; reason: 'empty' | 'not_integer' | 'too_large' };

/** "1,234" → 1234. 빈 값·음수·소수·숫자 아님·상한 초과는 실패 */
export function parseWonInput(raw: string): ParseWonResult {
  const s = raw.trim();
  if (s === '') return { ok: false, reason: 'empty' };
  if (!/^\d{1,3}(,\d{3})*$|^\d+$/.test(s)) return { ok: false, reason: 'not_integer' };
  const digits = s.replace(/,/g, '');
  if (digits.replace(/^0+/, '').length > String(MAX_WON).length) return { ok: false, reason: 'too_large' };
  const value = Number(digits);
  if (value > MAX_WON) return { ok: false, reason: 'too_large' };
  return { ok: true, value };
}
