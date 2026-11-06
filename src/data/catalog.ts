/**
 * 카테고리·주머니 저장소 접근.
 * - 삭제 함수는 두지 않는다 (지난 내역 보존을 위해 숨김으로 처리)
 * - 카테고리의 대분류/소분류(parent_id)는 바꾸지 않는다 (BANB-6 N1: 소분류 → 대분류 변경은 제공하지 않음)
 */
import { getSupabase } from './supabase';
import type { Category, Pocket, PocketScope, TransactionType } from './types';

const CATEGORY_COLUMNS = 'id, ledger_id, type, parent_id, name, sort_order, is_hidden, icon, created_at';
const POCKET_COLUMNS = 'id, ledger_id, name, scope, sort_order, is_hidden, created_at';

/** 저장 실패 원인. 화면은 이것으로 안내 문구를 고른다 */
export type CatalogErrorCode = 'INVALID_NAME' | 'NOT_FOUND' | 'FAILED';

export class CatalogError extends Error {
  constructor(public readonly code: CatalogErrorCode, cause?: unknown) {
    super(code, { cause });
  }
}

function toCatalogError(error: { code?: string; message?: string }): CatalogError {
  // 23514 = check 제약 위반 (이름 길이 등)
  if (error.code === '23514') return new CatalogError('INVALID_NAME', error);
  return new CatalogError('FAILED', error);
}

/** 수정 결과가 0행이면 (다른 멤버가 지웠거나 권한이 없음) NOT_FOUND */
function expectOne<T>(data: T[] | null): T {
  if (!data || data.length === 0) throw new CatalogError('NOT_FOUND');
  return data[0];
}

// ── 카테고리

export async function listCategories(ledgerId: string): Promise<Category[]> {
  const { data, error } = await getSupabase().from('category').select(CATEGORY_COLUMNS).eq('ledger_id', ledgerId);
  if (error) throw toCatalogError(error);
  return (data ?? []) as Category[];
}

export interface NewCategory {
  ledgerId: string;
  type: TransactionType;
  name: string;
  sortOrder: number;
  /** 안 고르면 null (화면은 첫 글자로 그림) */
  icon?: string | null;
}

/**
 * 대분류 추가. 명세 규칙("소분류가 없는 대분류는 같은 이름의 소분류 1개")에 따라
 * 같은 이름의 소분류도 함께 만든다. 소분류를 못 만들면 방금 만든 대분류를 지워 되돌린다.
 */
export async function addParentCategory(input: NewCategory): Promise<{ parent: Category; child: Category }> {
  const db = getSupabase();
  const { data, error } = await db
    .from('category')
    .insert({ ledger_id: input.ledgerId, type: input.type, parent_id: null, name: input.name, sort_order: input.sortOrder, icon: input.icon ?? null })
    .select(CATEGORY_COLUMNS);
  if (error) throw toCatalogError(error);
  const parent = expectOne(data) as Category;

  const child = await db
    .from('category')
    .insert({ ledger_id: input.ledgerId, type: input.type, parent_id: parent.id, name: input.name, sort_order: 1, icon: input.icon ?? null })
    .select(CATEGORY_COLUMNS);
  if (child.error) {
    await db.from('category').delete().eq('id', parent.id); // 아직 아무 데도 안 쓰인 대분류
    throw toCatalogError(child.error);
  }
  return { parent, child: expectOne(child.data) as Category };
}

export async function addChildCategory(input: NewCategory & { parentId: string }): Promise<Category> {
  const { data, error } = await getSupabase()
    .from('category')
    .insert({
      ledger_id: input.ledgerId,
      type: input.type,
      parent_id: input.parentId,
      name: input.name,
      sort_order: input.sortOrder,
      icon: input.icon ?? null,
    })
    .select(CATEGORY_COLUMNS);
  if (error) throw toCatalogError(error);
  return expectOne(data) as Category;
}

/** 바꿀 수 있는 항목: 이름·숨김·아이콘 (parent_id·type 은 바꾸지 않는다) */
export type CategoryPatch = Partial<Pick<Category, 'name' | 'is_hidden' | 'icon'>>;

export async function updateCategory(id: string, patch: CategoryPatch): Promise<void> {
  const { data, error } = await getSupabase().from('category').update(patch).eq('id', id).select('id');
  if (error) throw toCatalogError(error);
  expectOne(data);
}

// ── 주머니

export async function listPockets(ledgerId: string): Promise<Pocket[]> {
  const { data, error } = await getSupabase().from('pocket').select(POCKET_COLUMNS).eq('ledger_id', ledgerId);
  if (error) throw toCatalogError(error);
  return (data ?? []) as Pocket[];
}

export async function addPocket(input: { ledgerId: string; name: string; scope: PocketScope; sortOrder: number }): Promise<Pocket> {
  const { data, error } = await getSupabase()
    .from('pocket')
    .insert({ ledger_id: input.ledgerId, name: input.name, scope: input.scope, sort_order: input.sortOrder })
    .select(POCKET_COLUMNS);
  if (error) throw toCatalogError(error);
  return expectOne(data) as Pocket;
}

export type PocketPatch = Partial<Pick<Pocket, 'name' | 'scope' | 'is_hidden'>>;

export async function updatePocket(id: string, patch: PocketPatch): Promise<void> {
  const { data, error } = await getSupabase().from('pocket').update(patch).eq('id', id).select('id');
  if (error) throw toCatalogError(error);
  expectOne(data);
}

// ── 순서 (카테고리·주머니 공통)

/** 순서값 저장. 바뀐 항목만 받는다 (domain/catalog moveItem 결과) */
export async function saveOrder(table: 'category' | 'pocket', updates: { id: string; sort_order: number }[]): Promise<void> {
  const db = getSupabase();
  const results = await Promise.all(
    updates.map((u) => db.from(table).update({ sort_order: u.sort_order }).eq('id', u.id).select('id')),
  );
  for (const r of results) {
    if (r.error) throw toCatalogError(r.error);
    expectOne(r.data);
  }
}
