/**
 * 내역 입력 화면의 계산·검사 로직 (UI·저장소와 분리된 순수 함수).
 * 화면은 이 함수로 값을 만들고 검사한 뒤 data/transaction.ts 로 저장한다.
 */
import type { Category, Member, Pocket, TransactionType } from '../data/types';

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
