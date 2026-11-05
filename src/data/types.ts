/** DB 행 타입 — supabase/migrations 의 스키마와 1:1. 컬럼을 바꾸면 여기도 같이 바꾼다. */

export type TransactionType = 'expense' | 'income' | 'saving';
export type PocketScope = 'shared' | 'personal';
export type MemberRole = 'owner' | 'member';
export type TransactionSource = 'manual' | 'excel' | 'sync';
export type AssetKind = 'checking' | 'installment_saving' | 'deposit' | 'investment' | 'cash' | 'other';

export interface Ledger {
  id: string;
  name: string;
  member_limit: number;
  created_by: string; // auth user id
  created_at: string;
}

export interface Member {
  id: string;
  ledger_id: string;
  user_id: string;
  role: MemberRole;
  display_name: string;
  joined_at: string;
  left_at: string | null;
}

export interface Invite {
  id: string;
  ledger_id: string;
  code: string; // 8자리
  expires_at: string;
  is_revoked: boolean;
  created_by: string | null; // member id
  created_at: string;
}

export interface Category {
  id: string;
  ledger_id: string;
  type: TransactionType;
  parent_id: string | null; // null = 대분류
  name: string;
  sort_order: number;
  is_hidden: boolean;
  created_at: string;
}

export interface Pocket {
  id: string;
  ledger_id: string;
  name: string;
  scope: PocketScope;
  sort_order: number;
  is_hidden: boolean;
  created_at: string;
}

export interface Transaction {
  id: string;
  ledger_id: string;
  type: TransactionType;
  amount: number; // 원, 정수 ≥ 1
  occurred_on: string; // YYYY-MM-DD (KST 날짜)
  category_id: string; // 소분류
  pocket_id: string | null; // 지출일 때 필수
  spender_id: string; // member id
  is_fixed: boolean;
  memo: string | null;
  source: TransactionSource;
  created_by: string; // member id
  updated_by: string; // member id
  created_at: string;
  updated_at: string;
}

export interface Asset {
  id: string;
  ledger_id: string;
  name: string;
  kind: AssetKind;
  owner_id: string | null; // member id, null = 공동
  balance: number; // 원, 정수 ≥ 0
  memo: string | null;
  created_at: string;
  updated_at: string;
}

/** create_ledger / join_ledger RPC가 던지는 오류 코드 */
export type LedgerRpcError =
  | 'NOT_AUTHENTICATED'
  | 'ALREADY_IN_LEDGER'
  | 'INVITE_NOT_FOUND'
  | 'INVITE_EXPIRED'
  | 'MEMBER_LIMIT_REACHED';
