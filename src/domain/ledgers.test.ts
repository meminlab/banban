import { pickCurrentLedgerId, toMyLedgers, type LedgerWithMembers, type MyLedger } from './ledgers';

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
