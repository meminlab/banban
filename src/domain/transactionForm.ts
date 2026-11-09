/**
 * 내역 입력 화면의 계산·검사 로직 (UI·저장소와 분리된 순수 함수).
 * 화면은 이 함수로 값을 만들고 검사한 뒤 data/transaction.ts 로 저장한다.
 */
import type { Category, Member, Pocket, TransactionType } from '../data/types';
import { formatWonKorean } from './money';

export const AMOUNT_MIN = 1;
export const AMOUNT_MAX = 9_999_999_999;
export const MEMO_MAX = 100;

export const TYPE_LABEL: Record<TransactionType, string> = {
  expense: '지출',
  income: '수입',
  saving: '저축',
};
export const TYPE_ORDER: TransactionType[] = ['expense', 'income', 'saving'];

// ── 금액

/** 화면에 보이는 금액 문자열. 숫자·쉼표만 있으면 천 단위 쉼표로 다시 맞추고, 그 외(음수·소수 등)는 입력 그대로 둔다(검사에서 안내). */
export function formatAmountInput(raw: string): string {
  const trimmed = raw.trim();
  if (!/^[\d,]+$/.test(trimmed)) return raw;
  const digits = trimmed.replace(/,/g, '').replace(/^0+(?=\d)/, '');
  return digits === '' ? '' : formatNumber(Number(digits.slice(0, 13)));
}

export type AmountResult =
  | { ok: true; value: number }
  | { ok: false; error: 'empty' | 'notInteger' | 'tooSmall' | 'tooLarge' };

/** 입력 문자열 → 금액(원). 빈 값·음수·소수·0·상한 초과는 오류 */
export function parseAmount(input: string): AmountResult {
  const s = input.trim().replace(/,/g, '');
  if (s === '') return { ok: false, error: 'empty' };
  if (!/^\d+$/.test(s)) return { ok: false, error: 'notInteger' }; // 음수·소수·문자
  const digits = s.replace(/^0+(?=\d)/, '');
  if (digits.length > 10) return { ok: false, error: 'tooLarge' };
  const value = Number(digits);
  if (value < AMOUNT_MIN) return { ok: false, error: 'tooSmall' };
  if (value > AMOUNT_MAX) return { ok: false, error: 'tooLarge' };
  return { ok: true, value };
}

export function formatNumber(n: number): string {
  return n.toLocaleString('ko-KR');
}

// ── 날짜·시각 (한국 시간)

/** 오늘 날짜 YYYY-MM-DD (한국 시간 기준) */
export function todayKST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** 수정 시각 표시: "2026. 11. 6. 14:03" (한국 시간) */
export function formatDateTimeKST(iso: string): string {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}. ${get('month')}. ${get('day')}. ${get('hour')}:${get('minute')}`;
}

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// ── 선택지

export interface CategoryGroup {
  parent: Category;
  children: Category[];
}

/**
 * 유형별 카테고리 선택지: 대분류 > 소분류 (순서대로). 숨김은 빼되, 지금 고른 소분류(keepId)는 숨김이어도 남긴다.
 * 소분류가 하나도 안 남은 대분류는 뺀다.
 */
export function categoryGroups(categories: Category[], type: TransactionType, keepId?: string | null): CategoryGroup[] {
  const byOrder = (a: Category, b: Category) => a.sort_order - b.sort_order || a.name.localeCompare(b.name);
  const ofType = categories.filter((c) => c.type === type);
  const parents = ofType.filter((c) => c.parent_id === null).sort(byOrder);
  return parents
    .map((parent) => ({
      parent,
      children: ofType
        .filter((c) => c.parent_id === parent.id && ((!c.is_hidden && !parent.is_hidden) || c.id === keepId))
        .sort(byOrder),
    }))
    .filter((g) => g.children.length > 0);
}

/** 주머니 선택지: 숨김 제외(지금 고른 것은 유지), 순서대로 */
export function pocketOptions(pockets: Pocket[], keepId?: string | null): Pocket[] {
  return pockets
    .filter((p) => !p.is_hidden || p.id === keepId)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

/** 사용한 사람 선택지: 현재 멤버(참여 순). 나간 멤버는 지금 고른 사람일 때만 */
export function spenderOptions(members: Member[], keepId?: string | null): Member[] {
  return members
    .filter((m) => m.left_at === null || m.id === keepId)
    .sort((a, b) => a.joined_at.localeCompare(b.joined_at));
}

/** 멤버 이름 표시. 나간 사람은 "(나감)" */
export function memberLabel(member: Member | undefined): string {
  if (!member) return '알 수 없음';
  return member.left_at ? `${member.display_name} (나감)` : member.display_name;
}

// ── 입력값 검사

export interface TransactionDraft {
  type: TransactionType;
  amount: string; // 화면 입력 그대로
  occurredOn: string; // YYYY-MM-DD
  categoryId: string; // 소분류 id, 미선택 ''
  pocketId: string; // 미선택 ''
  spenderId: string; // member id
  isFixed: boolean;
  memo: string;
}

export type DraftField = 'amount' | 'occurredOn' | 'categoryId' | 'pocketId' | 'spenderId' | 'memo';
export type DraftErrors = Partial<Record<DraftField, string>>;

/** 저장할 값 (DB 컬럼 그대로). ledger_id·작성자·수정자·source 는 저장 모듈/서버가 채운다 */
export interface TransactionValues {
  type: TransactionType;
  amount: number;
  occurred_on: string;
  category_id: string;
  pocket_id: string | null;
  spender_id: string;
  is_fixed: boolean;
  memo: string | null;
}

const AMOUNT_MESSAGE: Record<Exclude<AmountResult, { ok: true }>['error'], string> = {
  empty: '금액을 입력해 주세요.',
  notInteger: '금액은 1원 이상의 정수(원 단위)로 입력해 주세요.',
  tooSmall: '금액은 1원 이상이어야 해요.',
  tooLarge: `금액은 ${formatNumber(AMOUNT_MAX)}원까지 입력할 수 있어요.`,
};

/** 화면 표시 순서 = 오류 안내·포커스 순서 */
export const FIELD_ORDER: DraftField[] = ['amount', 'occurredOn', 'categoryId', 'pocketId', 'spenderId', 'memo'];

/**
 * 입력값 검사. 통과하면 저장할 값, 아니면 칸별 안내 문구.
 * validCategoryIds 등: 지금 선택지에 있는 id (다른 유형 카테고리·없는 값 방지)
 */
export function validateDraft(
  draft: TransactionDraft,
  valid: { categoryIds: Set<string>; pocketIds: Set<string>; spenderIds: Set<string> },
): { ok: true; values: TransactionValues } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const amount = parseAmount(draft.amount);
  if (!amount.ok) errors.amount = AMOUNT_MESSAGE[amount.error];
  if (!draft.occurredOn) errors.occurredOn = '날짜를 골라 주세요.';
  else if (!isValidDate(draft.occurredOn)) errors.occurredOn = '날짜를 다시 골라 주세요.';
  if (!draft.categoryId || !valid.categoryIds.has(draft.categoryId)) errors.categoryId = '카테고리를 골라 주세요.';
  const isExpense = draft.type === 'expense';
  if (isExpense && (!draft.pocketId || !valid.pocketIds.has(draft.pocketId))) errors.pocketId = '주머니를 골라 주세요.';
  if (!draft.spenderId || !valid.spenderIds.has(draft.spenderId)) errors.spenderId = '사용한 사람을 골라 주세요.';
  const memo = draft.memo.trim();
  if ([...memo].length > MEMO_MAX) errors.memo = `메모는 ${MEMO_MAX}자까지 쓸 수 있어요.`;

  if (Object.keys(errors).length > 0 || !amount.ok) return { ok: false, errors };
  return {
    ok: true,
    values: {
      type: draft.type,
      amount: amount.value,
      occurred_on: draft.occurredOn,
      category_id: draft.categoryId,
      pocket_id: isExpense ? draft.pocketId : null,
      spender_id: draft.spenderId,
      is_fixed: isExpense ? draft.isFixed : false,
      memo: memo === '' ? null : memo,
    },
  };
}

// ── 키패드 입력 (design.md 5.15 v1.4)

/** 금액 최대 자릿수 = AMOUNT_MAX(9,999,999,999)의 자릿수 */
export const KEYPAD_MAX_DIGITS = 10;
/** 한글 읽기 줄을 보이는 최소 금액 (이 금액 이상이면 보임) */
export const KOREAN_READING_MIN = 1_000_000;

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | 'back' | 'clear';

/**
 * 키 하나를 누른 뒤의 금액 숫자열. 앞자리 0은 넣지 않는다(0원에서 0·00은 그대로 0원).
 * 최대 자릿수를 넘으면 입력을 무시하고 overflow=true (화면은 "최대 금액이에요"로 알린다)
 */
export function pressKey(digits: string, key: KeypadKey): { digits: string; overflow: boolean } {
  if (key === 'clear') return { digits: '', overflow: false };
  if (key === 'back') return { digits: digits.slice(0, -1), overflow: false };
  const next = `${digits}${key}`.replace(/^0+/, '');
  if (next.length > KEYPAD_MAX_DIGITS) return { digits, overflow: true };
  return { digits: next, overflow: false };
}

/** 실제 자판 키 → 키패드 키 (숫자·Backspace만). 그 밖은 null */
export function keyFromKeyboard(key: string): KeypadKey | null {
  if (/^[0-9]$/.test(key)) return key as KeypadKey;
  if (key === 'Backspace') return 'back';
  return null;
}

/** 키패드 숫자열 → 금액(원). 빈 값은 0 */
export function amountFromDigits(digits: string): number {
  return digits === '' ? 0 : Number(digits);
}

/** 화면에 보일 한글 읽기 (예: "289만 원"). 1,000,000원 미만이면 null = 줄을 그리지 않는다 */
export function koreanReading(amount: number): string | null {
  return amount >= KOREAN_READING_MIN ? formatWonKorean(amount) : null;
}

/** 금액 aria-label: 금액과 상관없이 정확한 금액 + 한글 읽기를 넣는다 (만 원 아래를 버리는 읽기만으로는 금액이 달라지므로) */
export function amountAriaLabel(amount: number): string {
  const exact = `${formatNumber(amount)}원`;
  const reading = formatWonKorean(amount);
  return reading === exact ? `금액 ${exact}` : `금액 ${exact}, ${reading}`;
}

/** 저장 버튼을 막는 빠진 항목 (화면 순서). 주머니는 지출일 때만 */
export type MissingField = 'amount' | 'categoryId' | 'pocketId';

export function missingForSave(draft: Pick<TransactionDraft, 'type' | 'amount' | 'categoryId' | 'pocketId'>): MissingField[] {
  const missing: MissingField[] = [];
  if (amountFromDigits(draft.amount.replace(/,/g, '')) === 0) missing.push('amount');
  if (!draft.categoryId) missing.push('categoryId');
  if (draft.type === 'expense' && !draft.pocketId) missing.push('pocketId');
  return missing;
}

const PICK_NAME: Record<Exclude<MissingField, 'amount'>, string> = { categoryId: '카테고리', pocketId: '주머니' };

/** 저장 버튼 위 한 줄 안내. 빠진 게 없으면 null */
export function missingMessage(missing: MissingField[]): string | null {
  if (missing.length === 0) return null;
  const picks = missing.filter((f): f is Exclude<MissingField, 'amount'> => f !== 'amount').map((f) => PICK_NAME[f]);
  const needAmount = missing.includes('amount');
  if (picks.length === 0) return '금액을 입력해 주세요';
  const pickText = `${picks.join('·')}를 골라 주세요`; // 카테고리·주머니 모두 받침 없음
  return needAmount ? `금액을 입력하고 ${pickText}` : pickText;
}

// ── 기본값 (이 사람이 마지막에 쓴 값)

/** 내가 최근에 입력한 내역 (입력 시각 최근 순) */
export interface RecentEntry {
  type: TransactionType;
  category_id: string;
  pocket_id: string | null;
}

/**
 * 새 내역 기본값: 유형별로 내가 마지막에 쓴 카테고리, 마지막 주머니.
 * 지금 고를 수 없는 값(숨김·삭제)이면 비운다 → 빈 알약
 */
export function lastUsedDefaults(
  recent: RecentEntry[],
  available: { categoryIds: (type: TransactionType) => Set<string>; pocketIds: Set<string> },
): { categoryByType: Partial<Record<TransactionType, string>>; pocketId: string } {
  const categoryByType: Partial<Record<TransactionType, string>> = {};
  for (const t of TYPE_ORDER) {
    const last = recent.find((r) => r.type === t);
    if (last && available.categoryIds(t).has(last.category_id)) categoryByType[t] = last.category_id;
  }
  const lastPocket = recent.find((r) => r.type === 'expense' && r.pocket_id)?.pocket_id;
  return { categoryByType, pocketId: lastPocket && available.pocketIds.has(lastPocket) ? lastPocket : '' };
}

// ── 알약 문구

/** 날짜 알약: 오늘이면 "오늘", 올해면 "11월 6일 (목)", 다른 해면 "2025년 11월 6일 (목)" */
export function datePillLabel(date: string, today: string): string {
  if (date === today) return '오늘';
  const [y, m, d] = date.split('-').map(Number);
  const weekday = '일월화수목금토'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const md = `${m}월 ${d}일 (${weekday})`;
  return y === Number(today.slice(0, 4)) ? md : `${y}년 ${md}`;
}
