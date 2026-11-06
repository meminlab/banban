/**
 * 순자산·월말 순자산·전월 대비·자산 구성 — 화면과 무관한 순수 함수 (BANB-2 "자산관리 1단계 명세" 계산 규칙)
 *
 * - 금액은 모두 0 이상으로 저장, 부채(LIABILITY_KINDS)는 계산할 때 뺀다
 * - 현재 순자산 = 보관 안 된 자산 잔액 합 − 보관 안 된 부채 잔액 합
 * - 월말 순자산(M월) = M월 말(다음 달 1일 00:00 KST 직전)에 이력이 있고 보관 전이던 항목의, 그 시점 이전 마지막 이력 잔액
 *   · 종류·소유자는 현재 값으로 계산한다(명세 보강 Q11). 이력에는 잔액만 있다
 *   · 되살린 자산은 archived_at 이 지워지므로 보관해 있던 달에도 다시 들어간다(Q10)
 * - 합계는 JS number(정수). 9,999,999,999원 × 90만 개까지 정확(2^53)하므로 넘침 없음
 */
import type { Asset, AssetBalanceHistory, AssetKind } from '../data/types';
import { addMonths, currentYearMonth, type YearMonth } from './month';

export const LIABILITY_KINDS: readonly AssetKind[] = ['loan', 'card_payable', 'other_liability'];

export function isLiability(kind: AssetKind): boolean {
  return LIABILITY_KINDS.includes(kind);
}

export interface NetWorth {
  /** 총자산 (부채 제외) */
  assets: number;
  /** 총부채 (양수) */
  liabilities: number;
  /** 순자산 = assets − liabilities */
  net: number;
}

function sum(items: readonly { kind: AssetKind; balance: number }[]): NetWorth {
  let assets = 0;
  let liabilities = 0;
  for (const it of items) {
    if (isLiability(it.kind)) liabilities += it.balance;
    else assets += it.balance;
  }
  return { assets, liabilities, net: assets - liabilities };
}

// ── 보기: 합친 / 사람별

/** 합친 = 'all', 사람별 = 소유자 member id, 공동 = null */
export type OwnerView = 'all' | string | null;

export function filterByOwner<T extends Pick<Asset, 'owner_id'>>(assets: readonly T[], view: OwnerView): T[] {
  return view === 'all' ? [...assets] : assets.filter((a) => a.owner_id === view);
}

export function isActive(a: Pick<Asset, 'archived_at'>): boolean {
  return a.archived_at === null;
}

// ── 현재

export function currentNetWorth(assets: readonly Asset[]): NetWorth {
  return sum(assets.filter(isActive));
}

// ── 특정 시각 / 월말

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 'YYYY-MM' 의 월말 경계 = 다음 달 1일 00:00:00 KST (이 시각 "이전"까지가 그 달) */
export function monthEndBoundary(ym: YearMonth): number {
  const next = addMonths(ym, 1);
  const [y, m] = next.split('-').map(Number);
  return Date.UTC(y, m - 1, 1) - KST_OFFSET_MS;
}

/** 이 달의 시작 = 1일 00:00:00 KST */
export function monthStartBoundary(ym: YearMonth): number {
  return monthEndBoundary(addMonths(ym, -1));
}

/**
 * 시각 at(ms) 직전 시점의 순자산. 그 시점에 들어가는 항목이 하나도 없으면 null (= 이력 없음, 화면 "–")
 * history 는 순서 상관없음. 같은 시각이면 id 큰 쪽이 나중
 */
export function netWorthBefore(assets: readonly Asset[], history: readonly AssetBalanceHistory[], at: number): NetWorth | null {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const last = new Map<string, { t: number; id: number; balance: number }>();
  for (const h of history) {
    if (!byId.has(h.asset_id)) continue;
    const t = Date.parse(h.changed_at);
    if (!(t < at)) continue;
    const prev = last.get(h.asset_id);
    if (!prev || t > prev.t || (t === prev.t && h.id > prev.id)) last.set(h.asset_id, { t, id: h.id, balance: h.balance });
  }
  const items: { kind: AssetKind; balance: number }[] = [];
  for (const [assetId, v] of last) {
    const a = byId.get(assetId)!;
    if (a.archived_at !== null && Date.parse(a.archived_at) < at) continue; // 그 시점에 이미 보관됨
    items.push({ kind: a.kind, balance: v.balance });
  }
  return items.length === 0 ? null : sum(items);
}

export function monthEndNetWorth(
  assets: readonly Asset[],
  history: readonly AssetBalanceHistory[],
  ym: YearMonth,
): NetWorth | null {
  return netWorthBefore(assets, history, monthEndBoundary(ym));
}

/**
 * 선택한 달의 순자산: 이번 달·미래 달 = 현재 값, 지난 달 = 그 달 월말 값 (명세 보강 Q13)
 * 현재 값은 항목이 없어도 0으로 본다(빈 화면 처리는 화면이 한다). 지난 달은 이력이 없으면 null
 */
export function netWorthForMonth(
  assets: readonly Asset[],
  history: readonly AssetBalanceHistory[],
  ym: YearMonth,
  now: Date = new Date(),
): NetWorth | null {
  return ym >= currentYearMonth(now) ? currentNetWorth(assets) : monthEndNetWorth(assets, history, ym);
}

/** 전월 대비 = 선택한 달 순자산 − 직전 달 월말 순자산. 어느 한쪽이 없으면 null ("–") */
export function netWorthChange(
  assets: readonly Asset[],
  history: readonly AssetBalanceHistory[],
  ym: YearMonth,
  now: Date = new Date(),
): number | null {
  const cur = netWorthForMonth(assets, history, ym, now);
  const prev = monthEndNetWorth(assets, history, addMonths(ym, -1));
  return cur && prev ? cur.net - prev.net : null;
}

// ── 자산 구성 (현재, 보관 제외)

export interface CompositionRow {
  kind: AssetKind;
  amount: number;
  count: number;
  /** 총자산 대비 비율(0~100, 소수 1자리). 총자산 0이면 null. 부채 행은 항상 null */
  percent: number | null;
}

export interface Composition {
  totalAssets: number;
  totalLiabilities: number;
  /** 자산 종류별, 금액 큰 순 */
  assets: CompositionRow[];
  /** 부채 종류별 합계, 금액 큰 순 */
  liabilities: CompositionRow[];
}

export function composition(assets: readonly Asset[]): Composition {
  const groups = new Map<AssetKind, { amount: number; count: number }>();
  for (const a of assets.filter(isActive)) {
    const g = groups.get(a.kind) ?? { amount: 0, count: 0 };
    g.amount += a.balance;
    g.count += 1;
    groups.set(a.kind, g);
  }
  const total = currentNetWorth(assets);
  const rows = (liability: boolean): CompositionRow[] =>
    [...groups.entries()]
      .filter(([kind]) => isLiability(kind) === liability)
      .map(([kind, g]) => ({
        kind,
        amount: g.amount,
        count: g.count,
        percent: liability || total.assets === 0 ? null : Math.round((g.amount / total.assets) * 1000) / 10,
      }))
      .sort((x, y) => y.amount - x.amount);
  return { totalAssets: total.assets, totalLiabilities: total.liabilities, assets: rows(false), liabilities: rows(true) };
}

// ── 월초 안내 (명세 보강 Q12: 가계부 전체에서 이번 달 잔액 기록이 0건일 때)

/**
 * 이번 달(KST)에 사람이 남긴 잔액 기록(생성·수정)이 없으면 true.
 * 마이그레이션이 채운 이력(changed_by = null)은 사람이 고친 것이 아니라 세지 않는다.
 */
export function needsMonthlyCheck(history: readonly AssetBalanceHistory[], now: Date = new Date()): boolean {
  const start = monthStartBoundary(currentYearMonth(now));
  return !history.some((h) => h.changed_by !== null && Date.parse(h.changed_at) >= start);
}
