import {
  buildInviteLink,
  createErrorMessage,
  formatInviteExpiry,
  isInviteCodeFormat,
  isInviteUsable,
  joinErrorMessage,
  memberDisplayName,
  nameLength,
  normalizeInviteCode,
  parseLedgerError,
  validateLedgerName,
} from './ledgerRules';

describe('validateLedgerName', () => {
  it('앞뒤 공백을 빼고 1~20자면 통과', () => {
    expect(validateLedgerName('우리집')).toBeNull();
    expect(validateLedgerName('  우리집  ')).toBeNull();
    expect(validateLedgerName('가'.repeat(20))).toBeNull();
  });
  it('비었거나 공백만이면 안내', () => {
    expect(validateLedgerName('')).toMatch('입력해 주세요');
    expect(validateLedgerName('    ')).toMatch('입력해 주세요');
  });
  it('이모지는 1자로 센다 (DB char_length 와 같음)', () => {
    expect(nameLength('😀')).toBe(1);
    expect(nameLength('😀'.repeat(15))).toBe(15);
    expect(validateLedgerName('😀'.repeat(15))).toBeNull();
    expect(validateLedgerName('😀'.repeat(20))).toBeNull();
    expect(validateLedgerName('😀'.repeat(21))).toMatch('20자');
    expect(validateLedgerName(`우리집${'😀'.repeat(17)}`)).toBeNull();
  });
  it('21자 이상이면 안내 (앞뒤 공백은 세지 않음)', () => {
    expect(validateLedgerName('가'.repeat(21))).toMatch('20자');
    expect(validateLedgerName(` ${'가'.repeat(20)} `)).toBeNull();
  });
});

describe('초대 코드', () => {
  it('공백·하이픈을 빼고 대문자로', () => {
    expect(normalizeInviteCode(' abcd-2345 ')).toBe('ABCD2345');
  });
  it('형식: 영문 대문자·숫자 8자리', () => {
    expect(isInviteCodeFormat('ABCD2345')).toBe(true);
    expect(isInviteCodeFormat('ABCD234')).toBe(false);
    expect(isInviteCodeFormat('ABCD23456')).toBe(false);
    expect(isInviteCodeFormat('abcd2345')).toBe(false);
    expect(isInviteCodeFormat('ABCD234!')).toBe(false);
  });
  it('초대 링크', () => {
    expect(buildInviteLink('https://banban.example', 'ABCD2345')).toBe('https://banban.example/join/ABCD2345');
    expect(buildInviteLink('https://banban.example/', 'ABCD2345')).toBe('https://banban.example/join/ABCD2345');
  });
  it('쓸 수 있는 초대: 무효 아님 + 만료 전', () => {
    const now = new Date('2026-11-06T00:00:00Z');
    expect(isInviteUsable({ is_revoked: false, expires_at: '2026-11-13T00:00:00Z' }, now)).toBe(true);
    expect(isInviteUsable({ is_revoked: true, expires_at: '2026-11-13T00:00:00Z' }, now)).toBe(false);
    expect(isInviteUsable({ is_revoked: false, expires_at: '2026-11-06T00:00:00Z' }, now)).toBe(false);
  });
  it('만료 시각은 한국 시간으로 표시', () => {
    // 2026-11-13 05:30 UTC = 한국 14:30 (금)
    const text = formatInviteExpiry('2026-11-13T05:30:00Z');
    expect(text).toMatch(/^11월 13일 \(금\) 오후 2:30까지$/);
  });
});

describe('memberDisplayName', () => {
  it('구글 이름을 20자로 자르고, 없으면 "사용자"', () => {
    expect(memberDisplayName(' 김반반 ')).toBe('김반반');
    expect(memberDisplayName('가'.repeat(30))).toBe('가'.repeat(20));
    expect(memberDisplayName('')).toBe('사용자');
    expect(memberDisplayName(null)).toBe('사용자');
  });
});

describe('오류 안내', () => {
  it('RPC 오류에서 코드와 상한 값을 꺼낸다', () => {
    expect(parseLedgerError({ message: 'MEMBER_LIMIT_REACHED', details: '3' })).toEqual({
      code: 'MEMBER_LIMIT_REACHED',
      limit: 3,
    });
    expect(parseLedgerError({ message: 'INVITE_EXPIRED', details: null })).toEqual({ code: 'INVITE_EXPIRED', limit: null });
    expect(parseLedgerError(new TypeError('Failed to fetch'))).toEqual({ code: 'UNKNOWN', limit: null });
    expect(parseLedgerError(undefined)).toEqual({ code: 'UNKNOWN', limit: null });
  });
  it('인원 상한 문구는 설정값을 따른다 (없으면 2명)', () => {
    expect(joinErrorMessage('MEMBER_LIMIT_REACHED', 2)).toBe('현재 최대 2명까지 참여할 수 있어요.');
    expect(joinErrorMessage('MEMBER_LIMIT_REACHED', 4)).toBe('현재 최대 4명까지 참여할 수 있어요.');
    expect(joinErrorMessage('MEMBER_LIMIT_REACHED', null)).toBe('현재 최대 2명까지 참여할 수 있어요.');
  });
  it('만료 / 무효 / 다른 가계부 참여자 / 네트워크', () => {
    expect(joinErrorMessage('INVITE_EXPIRED', null)).toMatch('만료');
    expect(joinErrorMessage('INVITE_NOT_FOUND', null)).toMatch('쓸 수 없는 초대 코드');
    expect(joinErrorMessage('ALREADY_IN_LEDGER', null)).toMatch('이미 다른 가계부');
    expect(joinErrorMessage('UNKNOWN', null)).toMatch('다시 시도');
  });
  it('가계부 만들기 실패', () => {
    expect(createErrorMessage('ALREADY_IN_LEDGER')).toMatch('이미 다른 가계부');
    expect(createErrorMessage('UNKNOWN')).toMatch('만들지 못했어요');
  });
});
