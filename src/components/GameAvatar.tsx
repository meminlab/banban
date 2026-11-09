import type { Member } from '../data/types';
import { eventColor } from '../domain/event';
import { initialOf, type Stone } from '../domain/omok';

/**
 * 같이 놀기 아바타 (design.md 1.7): 일정 색(참여 순 event-1~4) 바탕 + 이니셜, 오른쪽 아래 돌 표시(선택).
 * 테마와 상관없는 색이라 서로 다른 테마를 써도 두 폰에서 같은 사람이 같은 색이다.
 */
export function GameAvatar({
  memberId,
  members,
  size = 32,
  stone,
  dim,
}: {
  memberId: string;
  members: readonly Member[];
  size?: 24 | 32 | 56;
  stone?: Stone;
  dim?: boolean;
}) {
  const name = members.find((m) => m.id === memberId)?.display_name ?? '?';
  const color = eventColor(memberId, members);
  return (
    <span className={`game-avatar game-avatar--${size} event-color--${color}${dim ? ' is-dim' : ''}`} aria-hidden="true">
      {initialOf(name)}
      {stone && <span className={`game-avatar__stone game-avatar__stone--${stone}`} />}
    </span>
  );
}
