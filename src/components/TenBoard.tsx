import { memo, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { vibrate } from '../data/gamePrefs';
import { COLS, ROWS, cellIndex, rectOf, rectSum, type Rect, type TenBoard as Board } from '../domain/ten';

/**
 * 도토리 열 알 판 (design.md 5.41): 15 × 8 칸, 칸마다 숫자 도토리(몸통 + 깍정이 + 꼭지 + 숫자). 빈칸 = 작은 점.
 * 손가락으로 끌면 칸 단위 네모 + "합 7" 알약, 합이 10이면 강조. 손을 떼면 onDrop(네모) — 터질지는 화면이 정한다.
 */

export interface Popping {
  /** 터진 칸과 그 숫자 (사라지는 연출용) */
  cells: { i: number; v: number }[];
  rect: Rect;
  key: number;
}

/** 숫자 도토리 하나 (칸 왼쪽 위 x·y, 칸 크기 s) */
const Acorn = memo(function Acorn({ x, y, s, v, lift, className }: { x: number; y: number; s: number; v: number; lift?: boolean; className?: string }) {
  const cx = x + s / 2;
  const cy = y + s / 2;
  const by = cy + s * 0.1;
  const edge = lift ? 'var(--color-primary)' : 'var(--color-acorn-edge)';
  const w = lift ? 2.5 : 1.5;
  const cap = `M${cx - s * 0.38} ${cy - s * 0.13} C${cx - s * 0.38} ${cy - s * 0.38} ${cx + s * 0.38} ${cy - s * 0.38} ${cx + s * 0.38} ${cy - s * 0.13} Q${cx} ${cy - s * 0.07} ${cx - s * 0.38} ${cy - s * 0.13} Z`;
  return (
    <g className={className} style={lift ? { transform: 'scale(1.08)', transformOrigin: `${cx}px ${cy}px`, transformBox: 'view-box' } : undefined}>
      <circle cx={cx} cy={by} r={s * 0.37} fill="var(--color-acorn-body)" stroke={edge} strokeWidth={w} />
      <path d={cap} fill="var(--color-acorn-cap)" stroke={edge} strokeWidth={w} strokeLinejoin="round" />
      <line x1={cx} y1={cy - s * 0.31} x2={cx + s * 0.07} y2={cy - s * 0.45} stroke="var(--color-acorn-cap)" strokeWidth={Math.max(2, s * 0.07)} strokeLinecap="round" />
      <text x={cx} y={by + s * 0.16} textAnchor="middle" fontSize={Math.round(s * 0.46)} fontWeight={800} fill="var(--color-acorn-ink)" className="ten-acorn__num">
        {v}
      </text>
    </g>
  );
});

export function TenBoard({
  board,
  size,
  enabled,
  dim,
  label,
  popping,
  onDrop,
}: {
  board: Board;
  size: number;
  enabled: boolean;
  dim?: boolean;
  label: string;
  popping?: Popping | null;
  onDrop: (rect: Rect) => void;
}) {
  const s = size;
  const W = COLS * s;
  const H = ROWS * s;
  const drag = useRef<{ id: number; ax: number; ay: number } | null>(null);
  const [sel, setSel] = useState<Rect | null>(null);
  const wasTen = useRef(false);

  function cellAt(e: ReactPointerEvent<SVGSVGElement>): { x: number; y: number } {
    const box = e.currentTarget.getBoundingClientRect();
    const sx = box.width > 0 ? W / box.width : 1;
    const sy = box.height > 0 ? H / box.height : 1;
    return { x: Math.floor(((e.clientX - box.left) * sx) / s), y: Math.floor(((e.clientY - box.top) * sy) / s) };
  }

  function down(e: ReactPointerEvent<SVGSVGElement>) {
    if (!enabled || drag.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const c = cellAt(e);
    const r = rectOf(c.x, c.y, c.x, c.y);
    drag.current = { id: e.pointerId, ax: r.x1, ay: r.y1 };
    wasTen.current = false;
    setSel(r);
  }
  function move(e: ReactPointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const c = cellAt(e);
    const r = rectOf(d.ax, d.ay, c.x, c.y);
    setSel((cur) => (cur && cur.x1 === r.x1 && cur.y1 === r.y1 && cur.x2 === r.x2 && cur.y2 === r.y2 ? cur : r));
    const ten = rectSum(board, r).sum === 10;
    if (ten && !wasTen.current) vibrate(15);
    wasTen.current = ten;
  }
  function up(e: ReactPointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const r = sel;
    setSel(null);
    if (r && enabled) onDrop(r);
  }
  function cancel() {
    drag.current = null;
    setSel(null);
  }

  const sum = sel ? rectSum(board, sel).sum : 0;
  const ten = sel !== null && sum === 10;
  const inSel = (x: number, y: number) => !!sel && x >= sel.x1 && x <= sel.x2 && y >= sel.y1 && y <= sel.y2;

  // 도토리 층: 판·강조가 바뀔 때만 다시 그린다
  const acorns = useMemo(() => {
    const out = [];
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const v = board[cellIndex(x, y)];
        out.push(
          v > 0 ? (
            <Acorn key={`${x},${y}`} x={x * s} y={y * s} s={s} v={v} lift={ten && inSel(x, y)} />
          ) : (
            <circle key={`${x},${y}`} cx={x * s + s / 2} cy={y * s + s / 2} r={1.6} fill="var(--color-stack-dot)" />
          ),
        );
      }
    return out;
    // inSel 은 sel·ten 으로 정해진다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, s, ten, ten ? sel : null]);

  const pillW = 64;
  const pill = sel
    ? { x: Math.min(W - pillW - 4, Math.max(4, (sel.x2 + 1) * s - pillW + 8)), y: Math.max(4, sel.y1 * s - 32) }
    : null;

  return (
    <div className={`ten-board${dim ? ' is-dim' : ''}`} style={{ width: W, height: H }}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        className="ten-board__svg"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
      >
        {acorns}
        {popping?.cells.map(({ i, v }) => (
          <Acorn key={`p${popping.key}:${i}`} x={(i % COLS) * s} y={Math.floor(i / COLS) * s} s={s} v={v} className="ten-acorn--pop" />
        ))}
        {sel && (
          <rect
            x={sel.x1 * s + 1}
            y={sel.y1 * s + 1}
            width={(sel.x2 - sel.x1 + 1) * s - 2}
            height={(sel.y2 - sel.y1 + 1) * s - 2}
            rx={8}
            className={`ten-sel${ten ? ' is-ten' : ''}`}
          />
        )}
      </svg>
      {sel && pill && (
        <span className={`ten-sum${ten ? ' is-ten' : ''}`} style={{ left: pill.x, top: pill.y }} aria-hidden="true">
          {ten ? '10 ✓' : `합 ${sum}`}
        </span>
      )}
      {popping && popping.cells.length > 0 && (
        <span
          key={`plus${popping.key}`}
          className="ten-plus"
          style={{ left: ((popping.rect.x1 + popping.rect.x2 + 1) / 2) * s, top: ((popping.rect.y1 + popping.rect.y2 + 1) / 2) * s }}
          aria-hidden="true"
        >
          +{popping.cells.length}점
        </span>
      )}
    </div>
  );
}

/** 시작 화면 그림 (design.md 5.42): 5 × 3 작은 판 + 합 10 네모 */
export function TenIllustration() {
  const s = 40;
  const nums = [3, 6, 2, 8, 1, 5, 4, 1, 9, 7, 2, 7, 6, 3, 4];
  // 합 10 네모: (1,0)~(1,1) = 6 + 4
  return (
    <svg width={5 * s} height={3 * s} viewBox={`0 0 ${5 * s} ${3 * s}`} aria-hidden="true">
      {nums.map((v, i) => (
        <Acorn key={i} x={(i % 5) * s} y={Math.floor(i / 5) * s} s={s} v={v} lift={i === 1 || i === 6} />
      ))}
      <rect x={s + 1} y={1} width={s - 2} height={2 * s - 2} rx={8} className="ten-sel is-ten" />
    </svg>
  );
}
