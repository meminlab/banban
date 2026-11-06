import type { LedgerRpcError } from '../data/types';

/**
 * 가계부·초대 관련 규칙과 안내 문구 (화면·저장소와 무관한 순수 함수).
 * DB 규칙(supabase/migrations)과 같은 기준을 화면에서 먼저 확인할 때 쓴다.
 */

export const LEDGER_NAME_MAX = 20;
export const INVITE_CODE_LENGTH = 8;
/** 초대 링크 주소: /join/<코드> */
export const JOIN_PATH_PREFIX = '/join/';

/**
 * 가계부 이름 검사: 앞뒤 공백 제거 후 1~20자. 문제없으면 null, 있으면 안내 문구
 * 글자 수는 DB char_length 와 같은 유니코드 문자 단위로 센다 (이모지 1개 = 1자).
 * 입력칸에 maxLength 를 두지 않는다: maxLength 는 UTF-16 단위라 이모지를 2자로 세고, 앞뒤 공백도 센다.
 */
export function validateLedgerName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0) return '가계부 이름을 입력해 주세요.';
  if (nameLength(name) > LEDGER_NAME_MAX) return `가계부 이름은 ${LEDGER_NAME_MAX}자까지 쓸 수 있어요.`;
  return null;
}

/** 글자 수: 유니코드 문자(코드 포인트) 단위 = Postgres char_length */
export function nameLength(text: string): number {
  return [...text].length;
}

/** 입력한 초대 코드 정리: 공백·하이픈 제거, 대문자 */
export function normalizeInviteCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/** 초대 코드 형식(영문 대문자·숫자 8자리)인지 */
export function isInviteCodeFormat(code: string): boolean {
  return /^[A-Z0-9]{8}$/.test(code);
}

/** 초대 링크 */
export function buildInviteLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}${JOIN_PATH_PREFIX}${code}`;
}

/** 가계부 안에서 쓸 내 이름: 구글 이름을 20자로 자른다 (DB 규칙 1~20자) */
export function memberDisplayName(profileName: string | null | undefined): string {
  const name = (profileName ?? '').trim();
  return [...(name || '사용자')].slice(0, 20).join('').trim() || '사용자';
}

/** 아직 쓸 수 있는 초대인가 (무효 아님 + 만료 전) */
export function isInviteUsable(invite: { is_revoked: boolean; expires_at: string }, now: Date = new Date()): boolean {
  return !invite.is_revoked && new Date(invite.expires_at).getTime() > now.getTime();
}

/** 만료 시각 표시: "11월 13일 (금) 오후 2:30까지" (한국 시간) */
export function formatInviteExpiry(expiresAt: string): string {
  const d = new Date(expiresAt);
  const date = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(d);
  const get = (t: string) => date.find((p) => p.type === t)?.value ?? '';
  const time = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
  return `${get('month')} ${get('day')}일 (${get('weekday')}) ${time}까지`;
}

/** 가계부 만들기·참여·나가기 RPC 오류 코드 (+ 알 수 없는 오류: 네트워크 등) */
export type LedgerErrorCode = LedgerRpcError | 'UNKNOWN';

const KNOWN: readonly LedgerRpcError[] = [
  'NOT_AUTHENTICATED',
  'ALREADY_IN_LEDGER',
  'INVITE_NOT_FOUND',
  'INVITE_EXPIRED',
  'MEMBER_LIMIT_REACHED',
  'NOT_IN_LEDGER',
];

/** 저장소 오류(message / details)에서 오류 코드와 상한 값을 꺼낸다 */
export function parseLedgerError(error: unknown): { code: LedgerErrorCode; limit: number | null } {
  const e = (error ?? {}) as { message?: unknown; details?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';
  const code: LedgerErrorCode = KNOWN.find((k) => message.includes(k)) ?? 'UNKNOWN';
  const limit = code === 'MEMBER_LIMIT_REACHED' && typeof e.details === 'string' && /^\d+$/.test(e.details)
    ? Number(e.details)
    : null;
  return { code, limit };
}

/** 참여 실패 안내 문구 */
export function joinErrorMessage(code: LedgerErrorCode, limit: number | null): string {
  switch (code) {
    case 'MEMBER_LIMIT_REACHED':
      return `현재 최대 ${limit ?? 2}명까지 참여할 수 있어요.`;
    case 'INVITE_EXPIRED':
      return '초대 코드가 만료됐어요. 초대한 사람에게 새 코드를 받아 주세요.';
    case 'INVITE_NOT_FOUND':
      return '쓸 수 없는 초대 코드예요. 코드를 다시 확인하거나 새 코드를 받아 주세요.';
    case 'ALREADY_IN_LEDGER':
      return '이미 다른 가계부에 참여하고 있어요. 가계부는 한 개만 쓸 수 있어요.';
    case 'NOT_AUTHENTICATED':
      return '로그인이 풀렸어요. 다시 로그인해 주세요.';
    default:
      return '참여하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.';
  }
}

/** 가계부 만들기 실패 안내 문구 */
export function createErrorMessage(code: LedgerErrorCode): string {
  if (code === 'ALREADY_IN_LEDGER') return joinErrorMessage(code, null);
  if (code === 'NOT_AUTHENTICATED') return joinErrorMessage(code, null);
  return '가계부를 만들지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.';
}
