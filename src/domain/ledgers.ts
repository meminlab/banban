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
  /** 만든 사람 (auth user id) — 가계부 관리 "내가 만듦 / 참여함" */
  createdBy: string;
  /** 만든 시각 — 가계부 관리 상세 "만든 날" */
  createdAt: string;
}

/** 저장소에서 받은 행: 가계부 + 그 가계부의 멤버(나간 사람 포함) */
export interface LedgerWithMembers {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
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
    list.push({
      id: row.id,
      name: row.name,
      memberCount: active.length,
      joinedAt: me.joined_at,
      createdBy: row.created_by,
      createdAt: row.created_at,
    });
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

/** 가계부 관리 목록 보조 줄 (design.md 5.18): "멤버 2명 · 내가 만듦" / "멤버 3명 · 참여함" */
export function ledgerSubLine(ledger: Pick<MyLedger, 'memberCount' | 'createdBy'>, userId: string): string {
  return `멤버 ${ledger.memberCount}명 · ${ledger.createdBy === userId ? '내가 만듦' : '참여함'}`;
}

/** 만든 날: 한국 날짜로 "2026년 11월 9일" */
export function formatLedgerCreatedDate(createdAt: string): string {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(createdAt));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}년 ${get('month')}월 ${get('day')}일`;
}

/** 가계부 이름 첫 글자 (목록의 원 안). 이모지도 한 글자로 */
export function ledgerInitial(name: string): string {
  return [...name.trim()][0] ?? '';
}
