/** 자산 조회·추가·수정·삭제. 권한은 DB 행 단위 규칙(asset_all)이 가계부 멤버로 제한한다. */
import type { AssetInput } from '../domain/asset';
import { getSupabase } from './supabase';
import type { Asset } from './types';

const COLUMNS = 'id, ledger_id, name, kind, owner_id, balance, memo, created_at, updated_at';

/** 수정하려는 자산이 이미 삭제됨 (다른 멤버가 지운 경우) */
export class AssetNotFoundError extends Error {
  constructor() {
    super('ASSET_NOT_FOUND');
    this.name = 'AssetNotFoundError';
  }
}

export async function listAssets(ledgerId: string): Promise<Asset[]> {
  const { data, error } = await getSupabase().from('asset').select(COLUMNS).eq('ledger_id', ledgerId);
  if (error) throw error;
  return (data ?? []) as Asset[];
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

/** 나중에 저장한 쪽으로 덮어쓴다 (명세: 동시 수정) */
export async function updateAsset(id: string, input: AssetInput): Promise<Asset> {
  const { data, error } = await getSupabase().from('asset').update(input).eq('id', id).select(COLUMNS);
  if (error) throw error;
  if (!data || data.length === 0) throw new AssetNotFoundError();
  return data[0] as Asset;
}

/** 이미 지워진 자산이면 그대로 성공으로 본다 */
export async function deleteAsset(id: string): Promise<void> {
  const { error } = await getSupabase().from('asset').delete().eq('id', id);
  if (error) throw error;
}
