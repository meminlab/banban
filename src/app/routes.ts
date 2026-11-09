import type { TransactionValues } from '../domain/transactionForm';

/** 하단 탭 정의. 순서 = 화면 표시 순서. ＋ 버튼은 앞 2개 뒤에 들어간다 (design.md 5.7 v1.6: 홈 · 가계부 · [＋] · 일정 · 자산) */
export const TABS = [
  { path: '/', label: '홈', icon: 'home' },
  { path: '/ledger', label: '가계부', icon: 'ledger' },
  { path: '/calendar', label: '일정', icon: 'calendar' },
  { path: '/assets', label: '자산', icon: 'assets' },
] as const;

export type TabIcon = (typeof TABS)[number]['icon'];

export const SETTINGS_PATH = '/settings';
export const CATEGORY_SETTINGS_PATH = '/settings/categories';
export const POCKET_SETTINGS_PATH = '/settings/pockets';
/** 설정 > 화면 테마 (사람별) */
export const THEME_SETTINGS_PATH = '/settings/theme';
/** 로그인 화면. 구글 로그인 후 돌아오는 주소이기도 하다 (data/auth.ts AUTH_CALLBACK_PATH) */
export const LOGIN_PATH = '/login';
/** 참여한 가계부가 없을 때: 가계부 만들기 / 초대코드 입력 */
export const START_PATH = '/start';

/** 가계부 추가: 새 가계부 만들기 / 초대코드로 참여 (이미 가계부가 있을 때, 전환 목록에서) */
export const LEDGER_CREATE_PATH = '/ledgers/new';
export const LEDGER_JOIN_PATH = '/ledgers/join';

/** 가계부 탭 */
export const LEDGER_PATH = '/ledger';
/** 내역 입력 */
export const TRANSACTION_NEW_PATH = '/ledger/new';
/** 내역 상세·수정 */
export const transactionPath = (id: string) => `/ledger/${id}`;
/** 저장 토스트의 "되돌리기": 새 내역은 지우고, 수정은 저장 전 값으로 다시 쓴다 */
export type TxUndo = { op: 'delete'; id: string } | { op: 'restore'; id: string; values: TransactionValues };
/**
 * 입력·수정 화면을 닫고 탭 화면(홈·가계부·자산)으로 돌아갈 때 알려 줄 결과 (location.state.txFlash).
 * 탭 공통 틀(AppLayout)이 토스트로 보여 준다. history state 에 담기므로 함수 대신 값만 넣는다
 */
export type TxFlash = { kind: 'saved'; undo?: TxUndo } | { kind: 'deleted' };
/** 가계부 탭 → 입력·수정 화면으로 갈 때 넘기는 state. 닫으면 보던 달·보기·필터(returnTo)로 돌아간다 */
export interface TransactionFormState {
  returnTo?: string;
}
/**
 * 입력·수정 화면을 닫을 때 돌아갈 주소. 탭바 가운데 ＋는 모든 탭에 있으므로(design.md 5.7)
 * 가계부 탭 주소(/ledger 또는 /ledger?...)와 홈(/)·자산 탭(/assets)만 받는다. 그 밖은 가계부 탭.
 */
export function ledgerReturnPath(state: unknown): string {
  const returnTo = (state as TransactionFormState | null)?.returnTo;
  if (typeof returnTo !== 'string') return LEDGER_PATH;
  return /^\/ledger(\?[^#]*)?$/.test(returnTo) || returnTo === '/' || returnTo === '/assets' ? returnTo : LEDGER_PATH;
}
/** 자산 탭 */
export const ASSETS_PATH = '/assets';
/** 자산 추가 */
export const ASSET_NEW_PATH = '/assets/new';
/** 자산 수정 */
export const assetPath = (id: string) => `/assets/${id}`;
/** 보관한 자산 */
export const ASSETS_ARCHIVED_PATH = '/assets/archived';
/** 자산 추가·수정·보관 화면을 닫고 자산 탭으로 돌아갈 때 알려 줄 결과 (location.state.flash) */
export type AssetFlash = { kind: 'saved' } | { kind: 'archived'; id: string; name: string } | { kind: 'gone' };
/** 일정 탭 (?m=YYYY-MM 보던 달) */
export const CALENDAR_PATH = '/calendar';
/** 일정 추가 (state.date = 채워 둘 날짜, 없으면 오늘) */
export const EVENT_NEW_PATH = '/calendar/new';
/** 일정 수정 */
export const eventPath = (id: string) => `/calendar/${id}`;
/** 일정 추가 화면으로 넘기는 state */
export interface EventFormState {
  date?: string;
}
/** 일정 추가·수정 화면을 닫고 일정 탭으로 돌아갈 때 알려 줄 결과 (location.state.eventFlash) */
export type EventFlash = { kind: 'saved' } | { kind: 'deleted' } | { kind: 'gone' };
/** 일정 탭 주소 (보던 달) */
export const calendarMonthPath = (month: string) => `${CALENDAR_PATH}?m=${month}`;
/** 설정 > 가계부 이름 */
export const LEDGER_NAME_PATH = '/settings/name';
/** 설정 > 내 이름 (지금 가계부에서 쓰는 내 이름) */
export const MY_NAME_PATH = '/settings/my-name';
/** 설정 > 멤버·초대 */
export const MEMBERS_PATH = '/settings/members';
/** 초대 링크: /join/<코드> (lib/ledgerRules JOIN_PATH_PREFIX 와 같음) */
export const JOIN_PATH = '/join/:code';
