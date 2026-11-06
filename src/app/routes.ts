/** 하단 탭 정의. 순서 = 화면 표시 순서 */
export const TABS = [
  { path: '/', label: '홈', icon: 'home' },
  { path: '/ledger', label: '가계부', icon: 'ledger' },
  { path: '/assets', label: '자산', icon: 'assets' },
] as const;

export type TabIcon = (typeof TABS)[number]['icon'];

export const SETTINGS_PATH = '/settings';
export const CATEGORY_SETTINGS_PATH = '/settings/categories';
export const POCKET_SETTINGS_PATH = '/settings/pockets';
/** 로그인 화면. 구글 로그인 후 돌아오는 주소이기도 하다 (data/auth.ts AUTH_CALLBACK_PATH) */
export const LOGIN_PATH = '/login';
/** 참여한 가계부가 없을 때: 가계부 만들기 / 초대코드 입력 */
export const START_PATH = '/start';

/** 가계부 탭 */
export const LEDGER_PATH = '/ledger';
/** 내역 입력 */
export const TRANSACTION_NEW_PATH = '/ledger/new';
/** 내역 상세·수정 */
export const transactionPath = (id: string) => `/ledger/${id}`;
/** 입력 화면을 닫고 가계부 탭으로 돌아갈 때 알려 줄 결과 (location.state.flash) */
export type LedgerFlash = 'saved' | 'deleted';
/** 설정 > 가계부 이름 */
export const LEDGER_NAME_PATH = '/settings/name';
/** 설정 > 멤버·초대 */
export const MEMBERS_PATH = '/settings/members';
/** 초대 링크: /join/<코드> (lib/ledgerRules JOIN_PATH_PREFIX 와 같음) */
export const JOIN_PATH = '/join/:code';
