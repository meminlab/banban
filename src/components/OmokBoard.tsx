import { useRef, type KeyboardEvent } from 'react';
import { BOARD_SIZE, cellIndex, cellLabel, type Board, type Stone } from '../domain/omok';

const STAR_POINTS = [3, 7, 11];
const STONE_NAME: Record<Stone, string> = { black: '흑돌', white: '백돌' };

/**
 * 오목 판 15×15. 칸을 누르면 고른 칸(흐린 돌 + 가로·세로 안내선)이 되고, 두기는 판 아래 버튼으로 확정한다
 * (360px 에서 칸이 약 22px 라 바로 두면 잘못 누르기 쉽다 — 고른 칸을 다시 눌러 옮길 수 있다).
 * 키보드: 판 안에서 화살표로 칸 이동, Enter/Space 로 고르기 (포커스는 칸 1개만 받는다).
 */
export function OmokBoard({
  board,
  selected,
  onSelect,
  interactive,
  pendingStone,
  lastMove,
  winLine,
}: {
  board: Board;
  selected: [number, number] | null;
  onSelect: (x: number, y: number) => void;
  /** 내 차례라 칸을 고를 수 있나 */
  interactive: boolean;
  /** 고른 칸에 흐리게 보일 내 돌 색 */
  pendingStone: Stone;
  lastMove: [number, number] | null;
  winLine: [number, number][] | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const focusAt = selected ?? lastMove ?? [7, 7];
  const isWin = (x: number, y: number) => winLine?.some(([wx, wy]) => wx === x && wy === y) ?? false;

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, x: number, y: number) {
    const d: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = d[e.key];
    if (!step) return;
    e.preventDefault();
    const nx = Math.min(BOARD_SIZE - 1, Math.max(0, x + step[0]));
    const ny = Math.min(BOARD_SIZE - 1, Math.max(0, y + step[1]));
    ref.current?.querySelector<HTMLButtonElement>(`[data-cell="${nx}-${ny}"]`)?.focus();
  }

  const cells = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const stone = board[cellIndex(x, y)];
      const isSelected = selected?.[0] === x && selected?.[1] === y;
      const isLast = lastMove?.[0] === x && lastMove?.[1] === y;
      const guide = selected && !isSelected && (selected[0] === x || selected[1] === y);
      const label = `${cellLabel(x, y)}, ${stone ? STONE_NAME[stone] : '빈칸'}${isLast ? ', 마지막 수' : ''}${isSelected ? ', 고른 칸' : ''}`;
      cells.push(
        <button
          key={`${x}-${y}`}
          type="button"
          data-cell={`${x}-${y}`}
          className={`omok-cell${isSelected ? ' is-selected' : ''}${guide ? ' is-guide' : ''}`}
          aria-label={label}
          aria-pressed={isSelected}
          aria-disabled={!interactive || stone !== null}
          tabIndex={focusAt[0] === x && focusAt[1] === y ? 0 : -1}
          onClick={() => interactive && stone === null && onSelect(x, y)}
          onKeyDown={(e) => onKeyDown(e, x, y)}
        >
          {stone && (
            <span className={`omok-stone omok-stone--${stone}${isWin(x, y) ? ' is-win' : ''}`}>
              {isLast && <span className="omok-stone__last" />}
            </span>
          )}
          {!stone && isSelected && <span className={`omok-stone omok-stone--${pendingStone} is-pending`} />}
        </button>,
      );
    }
  }

  const lines = [];
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    lines.push(<line key={`h${i}`} x1={0.5} y1={i + 0.5} x2={BOARD_SIZE - 0.5} y2={i + 0.5} />);
    lines.push(<line key={`v${i}`} x1={i + 0.5} y1={0.5} x2={i + 0.5} y2={BOARD_SIZE - 0.5} />);
  }

  return (
    <div className="omok-board" ref={ref} role="group" aria-label="오목 판 15×15">
      <svg className="omok-board__lines" viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`} aria-hidden="true">
        {lines}
        {STAR_POINTS.flatMap((x) => STAR_POINTS.map((y) => <circle key={`s${x}-${y}`} cx={x + 0.5} cy={y + 0.5} r={0.09} />))}
      </svg>
      {cells}
    </div>
  );
}
