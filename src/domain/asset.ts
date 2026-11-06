/** 자산: 입력 검증·합계 — 화면과 무관한 순수 함수 */
import type { Asset, AssetKind, Member } from '../data/types';
import { parseWonInput } from './money';

/** 종류 — 표시 순서 = 선택지 순서. group: 자산 / 부채 (BANB-2 자산관리 1단계, design.md 5.20) */
export const ASSET_KINDS: readonly { value: AssetKind; label: string; group: 'asset' | 'liability' }[] = [
  { value: 'checking', label: '입출금', group: 'asset' },
  { value: 'installment_saving', label: '적금', group: 'asset' },
  { value: 'deposit', label: '예금', group: 'asset' },
  { value: 'investment', label: '투자', group: 'asset' },
  { value: 'pension', label: '연금', group: 'asset' },
  { value: 'cash', label: '현금', group: 'asset' },
  { value: 'real_estate', label: '부동산', group: 'asset' },
  { value: 'vehicle', label: '자동차', group: 'asset' },
  { value: 'other', label: '기타', group: 'asset' },
  { value: 'loan', label: '대출', group: 'liability' },
  { value: 'card_payable', label: '카드값', group: 'liability' },
  { value: 'other_liability', label: '기타 부채', group: 'liability' },
];

export function assetKindLabel(kind: AssetKind): string {
  return ASSET_KINDS.find((k) => k.value === kind)?.label ?? '기타';
}

export const ASSET_NAME_MAX = 20;
export const ASSET_MEMO_MAX = 100;
export const SHARED_OWNER_LABEL = '공동';

/** 소유자 표시 이름. null = 공동, 나간 멤버는 '(나감)' */
export function ownerLabel(ownerId: string | null, members: readonly Member[]): string {
  if (ownerId === null) return SHARED_OWNER_LABEL;
  const m = members.find((x) => x.id === ownerId);
  if (!m) return '알 수 없음';
  return m.left_at ? `${m.display_name} (나감)` : m.display_name;
}

// ── 입력 검증

export interface AssetFormValues {
  name: string;
  kind: AssetKind;
  ownerId: string | null;
  balance: string; // 입력 문자열 (쉼표 포함 가능)
  memo: string;
}

export interface AssetInput {
  name: string;
  kind: AssetKind;
  owner_id: string | null;
  balance: number;
  memo: string | null;
}

export type AssetFormErrors = Partial<Record<'name' | 'balance' | 'memo', string>>;

export type ValidateResult = { ok: true; value: AssetInput } | { ok: false; errors: AssetFormErrors };

export function validateAssetForm(v: AssetFormValues): ValidateResult {
  const errors: AssetFormErrors = {};

  const name = v.name.trim();
  if (name.length === 0) errors.name = '이름을 입력해 주세요';
  else if (name.length > ASSET_NAME_MAX) errors.name = `이름은 ${ASSET_NAME_MAX}자까지 쓸 수 있어요`;

  const balance = parseWonInput(v.balance);
  if (!balance.ok) {
    errors.balance =
      balance.reason === 'empty'
        ? '잔액을 입력해 주세요'
        : balance.reason === 'too_large'
          ? '잔액은 9,999,999,999원까지 입력할 수 있어요'
          : '잔액은 0 이상의 정수(원)로 입력해 주세요';
  }

  const memo = v.memo.trim();
  if (memo.length > ASSET_MEMO_MAX) errors.memo = `메모는 ${ASSET_MEMO_MAX}자까지 쓸 수 있어요`;

  if (Object.keys(errors).length > 0 || !balance.ok) return { ok: false, errors };
  return {
    ok: true,
    value: { name, kind: v.kind, owner_id: v.ownerId, balance: balance.value, memo: memo === '' ? null : memo },
  };
}

// ── 사람별 보기 칩

export interface OwnerOption {
  ownerId: string | null; // null = 공동
  label: string; // 이름 (나간 멤버는 이름만, left 로 구분)
  left: boolean;
}

/**
 * 사람별 보기 칩 순서: 현재 멤버(참여 순) → 공동 → 나간 멤버 중 자산(보관 포함)을 가진 사람 (design.md 5.22)
 */
export function ownerOptions(assets: readonly Pick<Asset, 'owner_id'>[], members: readonly Member[]): OwnerOption[] {
  const owners = new Set(assets.map((a) => a.owner_id));
  const byJoin = [...members].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  return [
    ...byJoin.filter((m) => !m.left_at).map((m) => ({ ownerId: m.id, label: m.display_name, left: false })),
    { ownerId: null, label: SHARED_OWNER_LABEL, left: false },
    ...byJoin.filter((m) => m.left_at && owners.has(m.id)).map((m) => ({ ownerId: m.id, label: m.display_name, left: true })),
  ];
}

/** 목록 순서: 잔액 큰 순, 같으면 이름 순 */
export function sortAssets(assets: readonly Asset[]): Asset[] {
  return [...assets].sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, 'ko'));
}

// ── 날짜 표시 (KST)

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 달력 날짜 기준으로 며칠 지났나 (오늘 = 0) */
export function daysSinceKST(iso: string, now: Date = new Date()): number {
  const day = (t: number) => Math.floor((t + KST_OFFSET_MS) / 86_400_000);
  return Math.max(0, day(now.getTime()) - day(Date.parse(iso)));
}

/** "n일 전 수정"을 강조하는 기준: 30일 넘게 안 고침 (명세 "30일 넘게") */
export const STALE_DAYS = 30;

export function updatedAgo(iso: string, now: Date = new Date()): { text: string; stale: boolean } {
  const days = daysSinceKST(iso, now);
  return { text: days === 0 ? '오늘 수정' : `${days}일 전 수정`, stale: days > STALE_DAYS };
}

/** "11월 6일" (올해) / "2025년 11월 6일" */
export function formatDateKST(iso: string, now: Date = new Date()): string {
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ...opts }).format(d);
  const d = new Date(iso);
  const sameYear = fmt(d, { year: 'numeric' }) === fmt(now, { year: 'numeric' });
  return fmt(d, sameYear ? { month: 'long', day: 'numeric' } : { year: 'numeric', month: 'long', day: 'numeric' });
}

/** 이름 + 목적격 조사: '우리 차'를 / '통장'을. 한글이 아니면 '을(를)' */
export function quoteWithObject(name: string): string {
  const last = name.charCodeAt(name.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) return `'${name}'${(last - 0xac00) % 28 === 0 ? '를' : '을'}`;
  return `'${name}'을(를)`;
}
