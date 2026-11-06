/** 자산: 입력 검증·합계 — 화면과 무관한 순수 함수 */
import type { Asset, AssetKind, Member } from '../data/types';
import { parseWonInput } from './money';

/** 종류 — 표시 순서 = 선택지 순서 */
export const ASSET_KINDS: readonly { value: AssetKind; label: string }[] = [
  { value: 'checking', label: '입출금' },
  { value: 'installment_saving', label: '적금' },
  { value: 'deposit', label: '예금' },
  { value: 'investment', label: '투자' },
  { value: 'cash', label: '현금' },
  { value: 'other', label: '기타' },
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

// ── 합계

export interface OwnerTotal {
  ownerId: string | null; // null = 공동
  label: string;
  total: number;
  count: number;
}

export interface AssetSummary {
  total: number;
  byOwner: OwnerTotal[];
}

/**
 * 전체 / 소유자별(공동 포함) 합계.
 * 순서: 현재 멤버(참여 순) → 공동 → 나간 멤버 중 자산이 있는 사람.
 * 현재 멤버와 공동은 자산이 없어도 0원으로 보인다.
 */
export function summarizeAssets(assets: readonly Asset[], members: readonly Member[]): AssetSummary {
  const totals = new Map<string | null, { total: number; count: number }>();
  let total = 0;
  for (const a of assets) {
    total += a.balance;
    const t = totals.get(a.owner_id) ?? { total: 0, count: 0 };
    t.total += a.balance;
    t.count += 1;
    totals.set(a.owner_id, t);
  }

  const byJoin = [...members].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  const row = (ownerId: string | null): OwnerTotal => ({
    ownerId,
    label: ownerLabel(ownerId, members),
    total: totals.get(ownerId)?.total ?? 0,
    count: totals.get(ownerId)?.count ?? 0,
  });

  const byOwner: OwnerTotal[] = [
    ...byJoin.filter((m) => !m.left_at).map((m) => row(m.id)),
    row(null),
    ...byJoin.filter((m) => m.left_at && totals.has(m.id)).map((m) => row(m.id)),
  ];
  // 멤버 목록에 없는 소유자(이론상 없음)도 합계에서 빠지지 않게
  for (const id of totals.keys()) {
    if (!byOwner.some((o) => o.ownerId === id)) byOwner.push(row(id));
  }
  return { total, byOwner };
}

/** 목록 순서: 잔액 큰 순, 같으면 이름 순 */
export function sortAssets(assets: readonly Asset[]): Asset[] {
  return [...assets].sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, 'ko'));
}

/** 수정 시각 표시 (KST). 올해면 "11월 6일 14:03", 아니면 "2025년 11월 6일" */
export function formatUpdatedAt(iso: string, now: Date = new Date()): string {
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ...opts }).format(d);
  const d = new Date(iso);
  const sameYear = fmt(d, { year: 'numeric' }) === fmt(now, { year: 'numeric' });
  if (!sameYear) return fmt(d, { year: 'numeric', month: 'long', day: 'numeric' });
  const date = fmt(d, { month: 'long', day: 'numeric' });
  const time = fmt(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${date} ${time}`;
}
