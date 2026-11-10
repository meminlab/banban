import type { ReactElement } from 'react';
import {
  COLS,
  PIECES,
  ROWS,
  cellsOf,
  shapeOf,
  sizeOf,
  type Active,
  type Board,
  type BoardCell,
  type PieceKind,
} from '../domain/stack';

/**
 * 반반 쌓기 판 그림 (design.md 5.33 "그리는 법"). 조각은 사각 블록이 아니라 물건 모양:
 * 동전 = 원(같은 조각끼리 막대로 이음), 지폐·지갑·저금통 = 한 덩어리 둥근 사각 + 무늬.
 * 색은 재질 4가지(piece-coin/bill/wallet/piggy)뿐, 조각 종류는 모양·무늬로 구분한다.
 */
type Grid = Map<string, BoardCell>;

const at = (g: Grid, x: number, y: number) => g.get(`${x},${y}`);
const same = (a: BoardCell | undefined, b: BoardCell | undefined) => !!a && !!b && a.id === b.id;

function gridOf(board: Board | null, active: Active | null): Grid {
  const g: Grid = new Map();
  board?.forEach((row, y) => row.forEach((c, x) => c && g.set(`${x},${y}`, c)));
  if (active) {
    const deco = PIECES[active.kind].deco;
    cellsOf(active).forEach(([x, y], i) => g.set(`${x},${y}`, { id: active.id, kind: active.kind, deco: deco === i }));
  }
  return g;
}

/**
 * 영수증 줄 (BANB-55, design.md 5.38): 줄마다 종이 영수증 1장. 빈칸 왼쪽·오른쪽 조각을 각각 한 덩어리로,
 * 벽 쪽 끝은 곧게 · 빈칸 쪽 끝은 찢긴 지그재그(이 4개, 깊이 s × 0.12). 칸마다 인쇄 글자 막대 2줄
 */
function drawReceipts(g: Grid, s: number): ReactElement[] {
  const gap = Math.max(1.5, s * 0.06);
  const depth = s * 0.12;
  const rows = new Map<number, { y: number; xs: number[] }>();
  for (const [k, c] of g) {
    if (c.kind !== 'receipt') continue;
    const [x, y] = k.split(',').map(Number);
    const r = rows.get(c.id) ?? { y, xs: [] };
    r.xs.push(x);
    rows.set(c.id, r);
  }
  const out: ReactElement[] = [];
  for (const [id, { y, xs }] of rows) {
    xs.sort((a, b) => a - b);
    // 이어진 칸끼리 한 조각
    const segs: [number, number][] = [];
    for (const x of xs) {
      const last = segs[segs.length - 1];
      if (last && last[1] === x - 1) last[1] = x;
      else segs.push([x, x]);
    }
    const top = y * s + gap;
    const bottom = y * s + s - gap;
    const h = bottom - top;
    segs.forEach(([a, b], i) => {
      const left = a * s + (a === 0 ? 0 : gap);
      const right = (b + 1) * s - (b === COLS - 1 ? 0 : gap);
      const pts: string[] = [`${left},${top}`, `${right},${top}`];
      // 오른쪽 끝: 벽이면 곧게, 아니면 지그재그
      if (b === COLS - 1) pts.push(`${right},${bottom}`);
      else for (let t = 1; t <= 8; t++) pts.push(`${right - (t % 2 ? depth : 0)},${top + (h * t) / 8}`);
      pts.push(`${left},${bottom}`);
      if (a !== 0) for (let t = 7; t >= 1; t--) pts.push(`${left + (t % 2 ? depth : 0)},${top + (h * t) / 8}`);
      out.push(<polygon key={`rc${id}:${i}`} className="stack-receipt" points={pts.join(' ')} strokeWidth={1.5} strokeLinejoin="round" />);
      for (let x = a; x <= b; x++) {
        const w = Math.max(1.5, s * 0.07);
        const pad = s * 0.18;
        // 칸마다 길이를 조금씩 다르게 (자리로 정해지는 값 — 다시 그려도 같다)
        const k1 = ((x * 7 + y * 3) % 5) / 10;
        const k2 = ((x * 3 + y * 5 + 2) % 5) / 10;
        out.push(
          <g key={`ri${id}:${x}`} className="stack-receipt__ink" strokeWidth={w} strokeLinecap="round">
            <line x1={x * s + pad} y1={y * s + s * 0.36} x2={x * s + s - pad - k1 * s * 0.4} y2={y * s + s * 0.36} />
            <line x1={x * s + pad} y1={y * s + s * 0.66} x2={x * s + s - pad - k2 * s * 0.4} y2={y * s + s * 0.66} />
          </g>,
        );
      }
    });
  }
  return out;
}

function drawPieces(g: Grid, s: number): ReactElement[] {
  const gap = Math.max(1.5, s * 0.06);
  const rx = s * 0.2;
  const outline: ReactElement[] = [];
  const tiles: ReactElement[] = [];
  const deco: ReactElement[] = [];
  const bridges: ReactElement[] = [];
  const coins: ReactElement[] = [];

  for (const [k, c] of g) {
    if (c.kind === 'receipt') continue;
    const [x, y] = k.split(',').map(Number);
    const X = x * s;
    const Y = y * s;
    const R = same(c, at(g, x + 1, y));
    const D = same(c, at(g, x, y + 1));
    const L = same(c, at(g, x - 1, y));
    const U = same(c, at(g, x, y - 1));
    const mat = PIECES[c.kind].material;

    if (mat === 'coin') {
      const r = s * 0.42;
      const cx = X + s / 2;
      const cy = Y + s / 2;
      if (R) bridges.push(<rect key={`br${k}`} className="stack-coin" x={cx} y={cy - s * 0.17} width={s} height={s * 0.34} strokeWidth={1.2} />);
      if (D) bridges.push(<rect key={`bd${k}`} className="stack-coin" x={cx - s * 0.17} y={cy} width={s * 0.34} height={s} strokeWidth={1.2} />);
      coins.push(
        <g key={`c${k}`}>
          <circle className="stack-coin" cx={cx} cy={cy} r={r} strokeWidth={1.5} />
          <circle className="stack-coin__ring" cx={cx} cy={cy} r={r * 0.6} strokeWidth={1.2} />
        </g>,
      );
      continue;
    }

    // 2번 그리기: ① 테두리색 3px 외곽 → ② 같은 모양 채움. 이어진 칸 사이 선은 ②가 덮어 덩어리 바깥 테두리만 남는다
    const shape = (cls: string, extra: Record<string, unknown>) => {
      const parts = [<rect key="a" x={X + gap} y={Y + gap} width={s - 2 * gap} height={s - 2 * gap} rx={rx} />];
      if (R) parts.push(<rect key="r" x={X + s / 2} y={Y + gap} width={s} height={s - 2 * gap} />);
      if (D) parts.push(<rect key="d" x={X + gap} y={Y + s / 2} width={s - 2 * gap} height={s} />);
      if (R && D && same(c, at(g, x + 1, y + 1))) parts.push(<rect key="rd" x={X + s / 2} y={Y + s / 2} width={s} height={s} />);
      return (
        <g key={`${cls}${k}`} className={`${cls} stack-${mat}${cls === 'stack-outline' ? '--line' : ''}`} {...extra}>
          {parts}
        </g>
      );
    };
    outline.push(shape('stack-outline', { strokeWidth: 3 }));
    tiles.push(shape('stack-tile', {}));

    if (mat === 'bill' || mat === 'wallet') {
      const i = s * 0.2;
      const props = {
        className: `stack-mark stack-${mat}-mark`,
        strokeWidth: mat === 'wallet' ? 1.5 : 1.2,
        strokeDasharray: mat === 'wallet' ? `${s * 0.1} ${s * 0.08}` : undefined,
      };
      const x0 = X + (L ? 0 : i);
      const x1 = X + s - (R ? 0 : i);
      const y0 = Y + (U ? 0 : i);
      const y1 = Y + s - (D ? 0 : i);
      if (!U) deco.push(<line key={`u${k}`} x1={x0} y1={Y + i} x2={x1} y2={Y + i} {...props} />);
      if (!D) deco.push(<line key={`d${k}`} x1={x0} y1={Y + s - i} x2={x1} y2={Y + s - i} {...props} />);
      if (!L) deco.push(<line key={`l${k}`} x1={X + i} y1={y0} x2={X + i} y2={y1} {...props} />);
      if (!R) deco.push(<line key={`r${k}`} x1={X + s - i} y1={y0} x2={X + s - i} y2={y1} {...props} />);
      if (mat === 'bill' && ((L && R) || (U && D) || (!L && !R && !U && !D)))
        deco.push(<circle key={`o${k}`} className="stack-mark stack-bill-mark" cx={X + s / 2} cy={Y + s / 2} r={s * 0.16} strokeWidth={1.2} />);
    }
    if (c.deco && mat === 'wallet')
      deco.push(<rect key={`w${k}`} className="stack-wallet-snap" x={X + s - s * 0.34} y={Y + s - s * 0.16} width={s * 0.3} height={s * 0.32} rx={s * 0.08} />);
    if (c.deco && mat === 'piggy')
      deco.push(
        <g key={`p${k}`} className="stack-piggy-slot">
          <line x1={X + s * 0.3} y1={Y + s * 0.32} x2={X + s * 0.7} y2={Y + s * 0.32} strokeWidth={Math.max(2, s * 0.08)} strokeLinecap="round" />
          <circle cx={X + s * 0.5} cy={Y + s * 0.64} r={s * 0.06} />
        </g>,
      );
  }
  return [...drawReceipts(g, s), ...outline, ...tiles, ...deco, ...bridges, ...coins];
}

export function StackBoard({
  board,
  active,
  ghost,
  clearing,
  size,
  dim,
  label,
}: {
  board: Board;
  active: Active | null;
  /** 떨어질 자리 (점선) */
  ghost: Active | null;
  /** 지우는 중인 줄 (빛남) */
  clearing: readonly number[] | null;
  size: number;
  dim?: boolean;
  label: string;
}) {
  const s = size;
  const W = COLS * s;
  const H = ROWS * s;
  const gap = Math.max(1.5, s * 0.06);
  const dots: ReactElement[] = [];
  for (let y = 1; y < ROWS; y++) for (let x = 1; x < COLS; x++) dots.push(<circle key={`${x},${y}`} cx={x * s} cy={y * s} r={1.4} />);
  const ghostCells = ghost && active && ghost.y !== active.y ? cellsOf(ghost) : [];
  const clearingSet = new Set(clearing ?? []);
  // 지우는 줄의 칸은 위로 떠오르며 사라진다 (CSS), 나머지는 그대로
  const kept: Board = board.map((row, y) => (clearingSet.has(y) ? row.map(() => null) : row));
  const fading: Board = board.map((row, y) => (clearingSet.has(y) ? row : row.map(() => null)));

  return (
    <svg className={`stack-board${dim ? ' is-dim' : ''}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <g className="stack-dots">{dots}</g>
      {[...clearingSet].map((y) => (
        <rect key={`glow${y}`} className="stack-glow" x={0} y={y * s} width={W} height={s} />
      ))}
      <g className="stack-ghost">
        {ghostCells.map(([x, y]) => (
          <rect key={`${x},${y}`} x={x * s + gap + 1} y={y * s + gap + 1} width={s - 2 * gap - 2} height={s - 2 * gap - 2} rx={s * 0.2} />
        ))}
      </g>
      <g>{drawPieces(gridOf(kept, active), s)}</g>
      {clearingSet.size > 0 && <g className="stack-fading">{drawPieces(gridOf(fading, null), s)}</g>}
    </svg>
  );
}

/** 조각 하나 그림 (다음 조각 상자·시작 화면 설명) */
export function StackPiece({ kind, size = 13 }: { kind: PieceKind; size?: number }) {
  const cells = shapeOf(kind, 0);
  const { w, h } = sizeOf(cells);
  const g = gridOf(null, { kind, rot: 0, x: 0, y: 0, id: 1 });
  return (
    <svg width={w * size} height={h * size} viewBox={`0 0 ${w * size} ${h * size}`} aria-hidden="true">
      {drawPieces(g, size)}
    </svg>
  );
}

/** 시작 화면 그림: 조각 몇 개가 쌓인 작은 판 (칸 26) */
export function StackIllustration({ size = 26 }: { size?: number }) {
  const cols = 8;
  const rows = 4;
  const g: Grid = new Map();
  const put = (kind: PieceKind, rot: number, ox: number, oy: number, id: number) => {
    const deco = PIECES[kind].deco;
    shapeOf(kind, rot).forEach(([x, y], i) => g.set(`${ox + x},${oy + y}`, { id, kind, deco: deco === i }));
  };
  // 맨 아래 줄은 한 칸(x = 4)만 비워 "한 줄을 채우면 사라짐"을 보여 준다
  put('wallet', 0, 0, 2, 1);
  put('coin2', 0, 2, 3, 2);
  put('bent', 0, 5, 2, 3);
  put('coin1', 0, 7, 3, 4);
  put('piggy', 0, 2, 1, 5);
  put('bill', 0, 5, 1, 6);
  return (
    <svg className="stack-illust" width={cols * size} height={rows * size} viewBox={`0 0 ${cols * size} ${rows * size}`} aria-hidden="true">
      {drawPieces(g, size)}
    </svg>
  );
}
