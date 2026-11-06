/** 하단 탭 정의. 순서 = 화면 표시 순서 */
export const TABS = [
  { path: '/', label: '홈', icon: 'home' },
  { path: '/ledger', label: '가계부', icon: 'ledger' },
  { path: '/assets', label: '자산', icon: 'assets' },
] as const;

export type TabIcon = (typeof TABS)[number]['icon'];

export const SETTINGS_PATH = '/settings';
/** 로그인 화면. 구글 로그인 후 돌아오는 주소이기도 하다 (data/auth.ts AUTH_CALLBACK_PATH) */
export const LOGIN_PATH = '/login';
/** 참여한 가계부가 없을 때: 가계부 만들기 / 초대코드 입력 */
export const START_PATH = '/start';
