/**
 * 내가 참여 중인 가계부 목록과 "지금 볼 가계부" 고르기 (화면·저장소와 무관한 순수 함수).
 */

/** 전환 목록에 보일 가계부 한 개 */
export interface MyLedger {
  id: string;
  name: string;
  /** 현재 멤버 수 (나간 사람 제외) */
  memberCount: number;
  /** 내가 (마지막으로) 참여한 시각 */
  joinedAt: string;
}

/** 저장소에서 받은 행: 가계부 + 그 가계부의 멤버(나간 사람 포함) */
export interface LedgerWithMembers {
  id: string;
  name: string;
  member: { user_id: string; joined_at: string; left_at: string | null }[];
}

/**
 * 내가 현재 멤버인 가계부만 골라 목록으로 만든다. 순서: 먼저 참여한 가계부부터 (목록 위치가 바뀌지 않게)
 */
export function toMyLedgers(rows: LedgerWithMembers[], userId: string): MyLedger[] {
  const list: MyLedger[] = [];
  for (const row of rows) {
    const active = row.member.filter((m) => m.left_at === null);
    const me = active.find((m) => m.user_id === userId);
    if (!me) continue;
    list.push({ id: row.id, name: row.name, memberCount: active.length, joinedAt: me.joined_at });
  }
  return list.sort((a, b) => compareTime(a.joinedAt, b.joinedAt) || a.id.localeCompare(b.id));
}

/**
 * 지금 볼 가계부: 마지막으로 본 가계부에 아직 멤버면 그것, 아니면 가장 최근에 참여한 가계부, 없으면 null(시작 화면)
 */
export function pickCurrentLedgerId(ledgers: MyLedger[], lastLedgerId: string | null): string | null {
  if (lastLedgerId && ledgers.some((l) => l.id === lastLedgerId)) return lastLedgerId;
  let latest: MyLedger | null = null;
  for (const l of ledgers) {
    if (!latest || compareTime(l.joinedAt, latest.joinedAt) > 0) latest = l;
  }
  return latest?.id ?? null;
}

function compareTime(a: string, b: string): number {
  return new Date(a).getTime() - new Date(b).getTime();
}
