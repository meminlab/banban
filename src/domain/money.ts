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

/**
 * 화면낭독·요약용 큰 금액 읽기 (design.md 5.19 예: "1억 9,824만 원"). 만 원 아래는 버린다.
 * 1만 원 미만은 그대로 "9,500원". 음수는 "마이너스 " 를 붙인다
 */
export function formatWonKorean(n: number): string {
  const sign = n < 0 ? '마이너스 ' : '';
  const abs = Math.trunc(Math.abs(n));
  const eok = Math.floor(abs / 100_000_000);
  const man = Math.floor((abs % 100_000_000) / 10_000);
  if (eok === 0 && man === 0) return `${sign}${abs.toLocaleString('ko-KR')}원`;
  const parts = [eok > 0 ? `${eok.toLocaleString('ko-KR')}억` : '', man > 0 ? `${man.toLocaleString('ko-KR')}만` : ''];
  return `${sign}${parts.filter(Boolean).join(' ')} 원`;
}

/** 1234567 → ['1', '234', '567'] (부호 없이). 큰 금액을 쉼표 뒤에서만 줄바꿈할 때 덩어리 단위 */
export function wonGroups(n: number): string[] {
  return formatWon(Math.abs(n)).split(',');
}

/** 1조원 — 이 이상이면 자산 합계 금액을 한 단계 더 줄인다 (BANB-15) */
export const TRILLION_WON = 1_000_000_000_000;

/**
 * 큰 금액(hero) 글자 크기 단계 (design.md 2.3·5.4). 문자열 길이 대신 자릿수로 판단해 기호 글자가 바뀌어도 깨지지 않는다.
 * - 'long': "−" 포함 "…원"이 14자 이상(1,000,000,000원 · −1,000,000,000원부터) → 36 → 28px
 * - 'longer': 1조원 이상(양수·음수) → 22px (자산 탭 순자산, 360px 카드 안쪽 여백 안)
 */
export function heroAmountSize(n: number): 'base' | 'long' | 'longer' {
  const abs = Math.trunc(Math.abs(n));
  if (abs >= TRILLION_WON) return 'longer';
  const digits = String(abs).length;
  const chars = (n < 0 ? 1 : 0) + digits + Math.floor((digits - 1) / 3) + 1; // 기호 + 숫자 + 쉼표 + '원'
  return chars >= 14 ? 'long' : 'base';
}
