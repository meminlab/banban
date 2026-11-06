/**
 * 자산 조회·추가·수정·보관·되살리기, 잔액 이력 조회(추이에 필요한 범위만).
 * 권한은 DB 행 단위 규칙이 가계부 멤버로 제한한다. 자산은 지우지 않고 보관한다(delete 권한 없음).
 * 잔액 이력은 DB 트리거가 기록하고 화면은 읽기만 한다. 보관 시각도 서버가 정한다.
 */
import type { AssetInput } from '../domain/asset';
import { getSupabase } from './supabase';
import type { Asset, AssetBalanceHistory } from './types';

const COLUMNS = 'id, ledger_id, name, kind, owner_id, balance, memo, archived_at, created_at, updated_at';
const HISTORY_COLUMNS = 'id, asset_id, ledger_id, balance, changed_by, changed_at';

/** 수정하려는 자산을 찾을 수 없음 (다른 가계부로 바뀌었거나 권한이 없어짐) */
export class AssetNotFoundError extends Error {
  constructor() {
    super('ASSET_NOT_FOUND');
    this.name = 'AssetNotFoundError';
  }
}

/** 보관한 자산까지 모두 (지난 달 값 계산에 필요) */
export async function listAssets(ledgerId: string): Promise<Asset[]> {
  const { data, error } = await getSupabase().from('asset').select(COLUMNS).eq('ledger_id', ledgerId);
  if (error) throw error;
  return (data ?? []) as Asset[];
}

export async function getAsset(id: string): Promise<Asset | null> {
  const { data, error } = await getSupabase().from('asset').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as Asset | null) ?? null;
}

/** 한 번에 받는 행 수. 서버 조회 상한(기본 1000)과 같거나 작아야 한다 */
export const HISTORY_PAGE_SIZE = 1000;

/** 이력을 끝까지 받지 못함 (중간에 잘린 채로 쓰지 않는다) */
export class HistoryIncompleteError extends Error {
  constructor() {
    super('HISTORY_INCOMPLETE');
    this.name = 'HistoryIncompleteError';
  }
}

/**
 * 추이 계산에 필요한 잔액 이력 (BANB-30). 순서: 오래된 순(같은 시각이면 id 순)
 * - since(ms) 이후 이력 전부 + 자산마다 since 직전 마지막 이력 1건 (DB 함수 asset_balance_history_window)
 * - 서버 조회 상한에 걸리지 않게 나눠 받고, 서버가 알려 준 전체 행 수만큼 받지 못하면 오류를 낸다
 * since 는 domain/netWorth 의 trendWindowStart 로 정한다
 */
export async function listBalanceHistory(ledgerId: string, since: number): Promise<AssetBalanceHistory[]> {
  const sinceIso = new Date(since).toISOString();
  const rows: AssetBalanceHistory[] = [];
  let total = 0;
  for (;;) {
    const { data, error, count } = await getSupabase()
      .rpc('asset_balance_history_window', { p_ledger_id: ledgerId, p_since: sinceIso }, { count: 'exact' })
      .select(HISTORY_COLUMNS)
      .order('changed_at')
      .order('id')
      .range(rows.length, rows.length + HISTORY_PAGE_SIZE - 1);
    if (error) throw error;
    if (count === null || count === undefined) throw new HistoryIncompleteError();
    total = count;
    const page = (data ?? []) as AssetBalanceHistory[];
    rows.push(...page);
    if (rows.length >= total) return rows;
    if (page.length === 0) throw new HistoryIncompleteError(); // 더 있다는데 빈 쪽이 옴
  }
}

export async function createAsset(ledgerId: string, input: AssetInput): Promise<Asset> {
  const { data, error } = await getSupabase()
    .from('asset')
    .insert({ ledger_id: ledgerId, ...input })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as Asset;
}

/** 나중에 저장한 쪽으로 덮어쓴다 (명세: 동시 수정). 잔액이 바뀌면 서버가 이력을 남긴다 */
export async function updateAsset(id: string, input: AssetInput): Promise<Asset> {
  const { data, error } = await getSupabase().from('asset').update(input).eq('id', id).select(COLUMNS);
  if (error) throw error;
  if (!data || data.length === 0) throw new AssetNotFoundError();
  return data[0] as Asset;
}

/** 보관. 보관 시각은 서버가 지금으로 정한다(보낸 값은 무시). 이미 보관돼 있으면 원래 시각 유지 */
export async function archiveAsset(id: string): Promise<void> {
  await setArchived(id, new Date().toISOString());
}

/** 되살리기 = 보관 취소 (명세 보강 Q10) */
export async function restoreAsset(id: string): Promise<void> {
  await setArchived(id, null);
}

async function setArchived(id: string, archivedAt: string | null): Promise<void> {
  const { data, error } = await getSupabase().from('asset').update({ archived_at: archivedAt }).eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new AssetNotFoundError();
}
