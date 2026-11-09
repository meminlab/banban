/** DB 행 타입 — supabase/migrations 의 스키마와 1:1. 컬럼을 바꾸면 여기도 같이 바꾼다. */

export type TransactionType = 'expense' | 'income' | 'saving';
export type PocketScope = 'shared' | 'personal';
export type MemberRole = 'owner' | 'member';
export type TransactionSource = 'manual' | 'excel' | 'sync';
/** 자산 9종 + 부채 3종(loan / card_payable / other_liability). 금액은 모두 양수, 부채는 계산할 때 뺀다 */
export type AssetKind =
  | 'checking'
  | 'installment_saving'
  | 'deposit'
  | 'investment'
  | 'pension'
  | 'cash'
  | 'real_estate'
  | 'vehicle'
  | 'other'
  | 'loan'
  | 'card_payable'
  | 'other_liability';

/** 사용자 프로필 — 구글 계정에서 가져와 DB 트리거가 저장. 화면은 읽기만 */
export interface Profile {
  id: string; // auth user id
  display_name: string;
  avatar_url: string | null; // https 만
  updated_at: string;
}

export interface Ledger {
  id: string;
  name: string;
  member_limit: number;
  created_by: string; // auth user id
  created_at: string;
  /** 함께한 날 'YYYY-MM-DD' (설정 › 함께한 날). null = 정하지 않음 */
  together_since: string | null;
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
  /** Lucide kebab-case 아이콘 이름. null·모르는 이름이면 대분류 아이콘 → 첫 글자 (domain/categoryIcon) */
  icon: string | null;
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
  amount: number; // 원, 정수 1 ~ 9,999,999,999
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
  balance: number; // 원, 정수 0 ~ 9,999,999,999
  memo: string | null;
  /** 보관 시각(서버가 정함). null = 사용 중. 삭제 대신 보관 */
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/** 잔액 이력 — 자산을 만들거나 잔액이 바뀔 때 DB 트리거가 1행 기록. 화면은 읽기만 */
export interface AssetBalanceHistory {
  id: number; // 같은 시각이면 큰 쪽이 나중
  asset_id: string;
  ledger_id: string;
  balance: number;
  changed_by: string | null; // member id. null = 마이그레이션이 채운 행
  changed_at: string;
}

/** 일정 종류: 기념일 · 약속 · 정기 지출일 · 기타 */
export type EventKind = 'anniversary' | 'appointment' | 'bill_day' | 'other';
/** 반복: 안 함 · 매년 · 매년(음력) · 매월 · 매주 */
export type EventRepeat = 'none' | 'yearly' | 'yearly_lunar' | 'monthly' | 'weekly';

/** 일정 — 반복 일정도 1행. 화면에서 펼친다 (domain/event) */
export interface CalendarEvent {
  id: string;
  ledger_id: string;
  title: string; // 1~20자
  kind: EventKind;
  event_date: string; // 첫 회차 'YYYY-MM-DD' (양력, KST)
  all_day: boolean;
  start_time: string | null; // 'HH:MM:SS' (KST). 종일이면 null
  repeat: EventRepeat;
  lunar_month: number | null; // 음력 매년일 때만
  lunar_day: number | null;
  target_member_id: string | null; // member id, null = 함께
  place: string | null; // 30자
  memo: string | null; // 100자
  pinned_at: string | null; // 홈 D-day 고정 시각(서버가 정함). 기념일만, 가계부당 2개
  created_by: string; // member id (서버 기록)
  updated_by: string; // member id (서버 기록)
  created_at: string;
  updated_at: string;
}

/** 마지막으로 본 가계부 (본인만 읽음, 쓰기는 set_last_ledger RPC) */
export interface UserPreference {
  user_id: string;
  last_ledger_id: string | null;
  updated_at: string;
}

/**
 * create_ledger / join_ledger / leave_ledger / set_last_ledger RPC가 던지는 오류 코드
 * MEMBER_LIMIT_REACHED(가계부 인원 상한)·LEDGER_LIMIT_REACHED(1인 가계부 상한)는 details 에 상한 값
 */
export type LedgerRpcError =
  | 'NOT_AUTHENTICATED'
  | 'LEDGER_LIMIT_REACHED'
  | 'INVITE_NOT_FOUND'
  | 'INVITE_EXPIRED'
  | 'MEMBER_LIMIT_REACHED'
  | 'NOT_IN_LEDGER';
