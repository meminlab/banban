import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { BOARD_SIZE, cellIndex, cellLabel, ZOOM_LINES, type Board, type Stone } from '../domain/omok';

/** 판 안쪽 여백 (줄 간격 단위). 360px 판 344 = 여백 12 + 14칸 × 22.9 (design.md 5.29) */
const PAD = 0.525;
const STONE_R = 0.435; // 돌 지름 ≈ 줄 간격 0.87
const LAST_R = 0.57; // 마지막 수 고리 지름 26
const FORBID_R = 0.2; // 33 금지 X 반 너비 (줄 간격 기준, 360px 에서 약 9px)
const STAR_POINTS: [number, number][] = [
  [3, 3],
  [3, 11],
  [11, 3],
  [11, 11],
  [7, 7],
];
const STONE_NAME: Record<Stone, string> = { black: '흑돌', white: '백돌' };

/**
 * 오목 판 15×15 (design.md 5.29). 판을 누르면 가장 가까운 교차점이 "고른 칸"(반투명 돌 + 고리 + 가로·세로 안내선)이 되고,
 * 두기는 아래 "여기에 둘게요"(onConfirm)로 확정한다. 확대(zoomOrigin)하면 9줄 창만 보이고 끌어서 옮긴다.
 * 접근성: role="grid" 15×15, 방향키로 고른 칸 이동, Enter = 여기에 둘게요.
 */
export function OmokBoard({
  board,
  selected,
  onSelect,
  onConfirm,
  interactive,
  pendingStone,
  lastMove,
  lastSeq,
  winLine,
  zoomOrigin,
  onPan,
  forbidden,
  onForbidden,
}: {
  board: Board;
  selected: [number, number] | null;
  onSelect: (x: number, y: number) => void;
  onConfirm: () => void;
  /** 내 차례라 칸을 고를 수 있나 */
  interactive: boolean;
  /** 고른 칸에 흐리게 보일 내 돌 색 */
  pendingStone: Stone;
  lastMove: [number, number] | null;
  /** 마지막 수 순번 (새 돌 등장 움직임용) */
  lastSeq: number;
  /** 이긴 줄 (처음 → 끝). 있으면 나머지 돌은 흐리게 */
  winLine: [number, number][] | null;
  /** 확대 창 왼쪽 위. null = 전체 */
  zoomOrigin: [number, number] | null;
  onPan: (dx: number, dy: number) => void;
  /** 33 금지 자리 (cellIndex). 내 차례에만 넘긴다 — X 표시, 누르면 onForbidden (돌은 고르지 않음) */
  forbidden?: ReadonlySet<number>;
  onForbidden?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null);
  const suppressClick = useRef(false);
  const [focusCell, setFocusCell] = useState<[number, number] | null>(null);

  const [x0, y0] = zoomOrigin ?? [0, 0];
  const n = zoomOrigin ? ZOOM_LINES : BOARD_SIZE;
  const span = n - 1 + 2 * PAD;
  const isWin = (x: number, y: number) => winLine?.some(([wx, wy]) => wx === x && wy === y) ?? false;
  const focusAt = focusCell ?? selected ?? lastMove ?? [7, 7];

  function focusTo(x: number, y: number) {
    setFocusCell([x, y]);
    // 확대 중이면 창 밖으로 나간 칸을 따라 창을 옮긴다
    if (zoomOrigin) {
      const dx = x < x0 ? x - x0 : x > x0 + n - 1 ? x - (x0 + n - 1) : 0;
      const dy = y < y0 ? y - y0 : y > y0 + n - 1 ? y - (y0 + n - 1) : 0;
      if (dx || dy) onPan(dx, dy);
    }
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-cell="${x}-${y}"]`)?.focus());
  }

  const isForbidden = (x: number, y: number) => forbidden?.has(cellIndex(x, y)) ?? false;

  function pick(x: number, y: number) {
    if (!interactive || board[cellIndex(x, y)] !== null) return;
    if (isForbidden(x, y)) onForbidden?.();
    else onSelect(x, y);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>, x: number, y: number) {
    const d: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = d[e.key];
    if (step) {
      e.preventDefault();
      const nx = Math.min(BOARD_SIZE - 1, Math.max(0, x + step[0]));
      const ny = Math.min(BOARD_SIZE - 1, Math.max(0, y + step[1]));
      focusTo(nx, ny);
      pick(nx, ny);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selected?.[0] === x && selected?.[1] === y) onConfirm();
      else pick(x, y);
    } else if (e.key === ' ') {
      e.preventDefault();
      pick(x, y);
    }
  }

  // 확대 중 끌어서 옮기기 (8px 넘게 움직이면 끌기, 아니면 누르기)
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!zoomOrigin) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || !zoomOrigin || !ref.current) return;
    const cellPx = ref.current.clientWidth / span;
    const dx = Math.trunc((d.x - e.clientX) / cellPx);
    const dy = Math.trunc((d.y - e.clientY) / cellPx);
    if (!d.moved && Math.hypot(d.x - e.clientX, d.y - e.clientY) > 8) d.moved = true;
    if (d.moved && (dx || dy)) {
      onPan(dx, dy);
      drag.current = { ...d, x: d.x - dx * cellPx, y: d.y - dy * cellPx };
    }
  }
  function onPointerUp() {
    if (drag.current?.moved) suppressClick.current = true;
    drag.current = null;
  }

  const rows = [];
  for (let y = y0; y < y0 + n; y += 1) {
    const cells = [];
    for (let x = x0; x < x0 + n; x += 1) {
      const stone = board[cellIndex(x, y)];
      const isSelected = selected?.[0] === x && selected?.[1] === y;
      const isLast = lastMove?.[0] === x && lastMove?.[1] === y;
      cells.push(
        <div
          key={x}
          role="gridcell"
          data-cell={`${x}-${y}`}
          className="omok-cell"
          aria-label={`${cellLabel(x, y)}, ${stone ? STONE_NAME[stone] : isForbidden(x, y) ? '33이라 둘 수 없는 자리' : '빈칸'}${isLast ? ', 마지막 수' : ''}`}
          aria-selected={isSelected}
          aria-disabled={!interactive || stone !== null}
          tabIndex={focusAt[0] === x && focusAt[1] === y ? 0 : -1}
          onFocus={() => setFocusCell([x, y])}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            pick(x, y);
          }}
          onKeyDown={(e) => onKeyDown(e, x, y)}
        />,
      );
    }
    rows.push(
      <div key={y} role="row" className="omok-row">
        {cells}
      </div>,
    );
  }

  const lines = [];
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    lines.push(<line key={`h${i}`} x1={0} y1={i} x2={BOARD_SIZE - 1} y2={i} />);
    lines.push(<line key={`v${i}`} x1={i} y1={0} x2={i} y2={BOARD_SIZE - 1} />);
  }

  const stones = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const stone = board[cellIndex(x, y)];
      if (!stone) continue;
      const isLast = lastMove?.[0] === x && lastMove?.[1] === y;
      const dim = winLine && !isWin(x, y);
      stones.push(
        <g
          key={isLast ? `s${x}-${y}-${lastSeq}` : `s${x}-${y}`}
          className={`omok-stone omok-stone--${stone}${isLast ? ' is-new' : ''}${dim ? ' is-dim' : ''}`}
          transform={`translate(${x} ${y})`}
        >
          <circle r={STONE_R} />
          {stone === 'black' && <circle className="omok-stone__shine" cx={-0.15} cy={-0.16} r={0.1} />}
        </g>,
      );
    }
  }

  return (
    <div
      className={`omok-board${zoomOrigin ? ' is-zoomed' : ''}`}
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg className="omok-board__svg" viewBox={`${x0 - PAD} ${y0 - PAD} ${span} ${span}`} aria-hidden="true">
        <g className="omok-board__lines">{lines}</g>
        {STAR_POINTS.map(([x, y]) => (
          <circle key={`star${x}-${y}`} className="omok-board__star" cx={x} cy={y} r={zoomOrigin ? 0.07 : 0.11} />
        ))}
        {selected && (
          <g className="omok-guide">
            <line x1={-1} y1={selected[1]} x2={BOARD_SIZE} y2={selected[1]} />
            <line x1={selected[0]} y1={-1} x2={selected[0]} y2={BOARD_SIZE} />
          </g>
        )}
        {forbidden && forbidden.size > 0 && (
          <g className="omok-forbidden">
            {[...forbidden].map((i) => {
              const fx = i % BOARD_SIZE;
              const fy = Math.floor(i / BOARD_SIZE);
              return (
                <path key={`f${i}`} d={`M${fx - FORBID_R} ${fy - FORBID_R}L${fx + FORBID_R} ${fy + FORBID_R}M${fx + FORBID_R} ${fy - FORBID_R}L${fx - FORBID_R} ${fy + FORBID_R}`} />
              );
            })}
          </g>
        )}
        {stones}
        {lastMove && !winLine && <circle className="omok-last" cx={lastMove[0]} cy={lastMove[1]} r={LAST_R} />}
        {winLine && (
          <g className="omok-win">
            <line x1={winLine[0][0]} y1={winLine[0][1]} x2={winLine[winLine.length - 1][0]} y2={winLine[winLine.length - 1][1]} />
            {winLine.map(([x, y]) => (
              <circle key={`w${x}-${y}`} cx={x} cy={y} r={STONE_R + 0.06} />
            ))}
          </g>
        )}
        {selected && (
          <g className="omok-pick" transform={`translate(${selected[0]} ${selected[1]})`}>
            <circle className={`omok-pick__stone omok-pick__stone--${pendingStone}`} r={STONE_R} />
            <circle className="omok-pick__ring" r={STONE_R + 0.08} />
          </g>
        )}
      </svg>
      <div
        className="omok-board__cells"
        role="grid"
        aria-label={`오목 판 15×15${zoomOrigin ? ', 확대해서 보는 중' : ''}`}
        style={{
          inset: `${((PAD - 0.5) / span) * 100}%`,
          gridTemplateColumns: `repeat(${n}, 1fr)`,
          gridTemplateRows: `repeat(${n}, 1fr)`,
        }}
      >
        {rows}
      </div>
    </div>
  );
}
