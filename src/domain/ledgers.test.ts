import { headerAvatars, pickCurrentLedgerId, toMyLedgers, type LedgerWithMembers, type MyLedger } from './ledgers';

const ME = 'u-me';
const m = (user_id: string, joined_at: string, left_at: string | null = null) => ({ user_id, joined_at, left_at });

describe('toMyLedgers', () => {
  const rows: LedgerWithMembers[] = [
    { id: 'L-parents', name: '부모님', member: [m(ME, '2026-11-03T00:00:00Z'), m('mom', '2026-11-03T01:00:00Z'), m('dad', '2026-11-03T02:00:00Z', '2026-11-04T00:00:00Z')] },
    { id: 'L-couple', name: '부부 공동', member: [m('spouse', '2026-11-01T00:00:00Z'), m(ME, '2026-11-02T00:00:00Z')] },
    { id: 'L-left', name: '나간 곳', member: [m(ME, '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'), m('x', '2026-10-01T00:00:00Z')] },
  ];

  it('내가 현재 멤버인 가계부만, 먼저 참여한 순서로', () => {
    expect(toMyLedgers(rows, ME).map((l) => l.id)).toEqual(['L-couple', 'L-parents']);
  });

  it('멤버 수는 나간 사람을 빼고 센다, 참여 시각은 내 것', () => {
    const [couple, parents] = toMyLedgers(rows, ME);
    expect(couple).toEqual({ id: 'L-couple', name: '부부 공동', memberCount: 2, joinedAt: '2026-11-02T00:00:00Z' });
    expect(parents.memberCount).toBe(2);
  });

  it('참여한 가계부가 없으면 빈 목록', () => {
    expect(toMyLedgers(rows, 'stranger')).toEqual([]);
    expect(toMyLedgers([], ME)).toEqual([]);
  });
});

describe('pickCurrentLedgerId', () => {
  const ledgers: MyLedger[] = [
    { id: 'A', name: 'A', memberCount: 2, joinedAt: '2026-11-01T00:00:00Z' },
    { id: 'C', name: 'C', memberCount: 1, joinedAt: '2026-11-05T00:00:00Z' },
    { id: 'B', name: 'B', memberCount: 3, joinedAt: '2026-11-03T00:00:00Z' },
  ];

  it('마지막으로 본 가계부에 아직 멤버면 그 가계부', () => {
    expect(pickCurrentLedgerId(ledgers, 'B')).toBe('B');
  });

  it('마지막으로 본 가계부의 멤버가 아니면 가장 최근에 참여한 가계부', () => {
    expect(pickCurrentLedgerId(ledgers, 'gone')).toBe('C');
  });

  it('기록이 없으면 가장 최근에 참여한 가계부', () => {
    expect(pickCurrentLedgerId(ledgers, null)).toBe('C');
  });

  it('참여한 가계부가 없으면 null (시작 화면)', () => {
    expect(pickCurrentLedgerId([], 'A')).toBeNull();
    expect(pickCurrentLedgerId([], null)).toBeNull();
  });
});

describe('headerAvatars (헤더 알약 아바타 묶음)', () => {
  const m = (display_name: string, joined_at: string, left_at: string | null = null) => ({ display_name, joined_at, left_at });

  it('지금 멤버만 참여 순으로, 이름 첫 글자', () => {
    expect(
      headerAvatars([m('준호', '2026-02-01'), m('민지', '2026-01-01'), m('서연', '2026-01-15', '2026-03-01')]),
    ).toEqual({ initials: ['민', '준'], more: 0 });
  });

  it('3명이 넘으면 3명 + 나머지 수', () => {
    expect(
      headerAvatars([m('가', '2026-01-01'), m('나', '2026-01-02'), m('다', '2026-01-03'), m('라', '2026-01-04')]),
    ).toEqual({ initials: ['가', '나', '다'], more: 1 });
  });

  it('빈 이름은 ?, 멤버가 없으면 빈 묶음', () => {
    expect(headerAvatars([m('  ', '2026-01-01')])).toEqual({ initials: ['?'], more: 0 });
    expect(headerAvatars([])).toEqual({ initials: [], more: 0 });
  });
});
