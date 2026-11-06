import { useRef, useState, type KeyboardEvent } from 'react';
import { formatWon, formatWonKorean } from '../domain/money';
import { trendRatio, trendScale, trendSegments, type TrendPoint } from '../domain/netWorth';

/**
 * 자산 탭 "월별 추이" — 최근 6개월 월말 순자산 선 그래프 (design.md 5.19)
 * 그래프 라이브러리 없이 SVG(선) + HTML(점·월 라벨)로 그린다. 선은 가로로 늘어나도 굵기가 그대로(non-scaling-stroke),
 * 점·라벨은 HTML이라 폭이 바뀌어도 동그랗고 겹치지 않는다(월 라벨 칸 = 폭 1/6).
 */

const monthNo = (ym: string) => Number(ym.slice(5));
const signedWon = (n: number) => (n < 0 ? `−${formatWon(-n)}` : formatWon(n));

export function NetWorthTrend({ points }: { points: readonly TrendPoint[] }) {
  const last = points.length - 1;
  const present = points.flatMap((p, i) => (p.net === null ? [] : [i]));
  const [sel, setSel] = useState(() => present[present.length - 1] ?? last);
  const labelsRef = useRef<HTMLDivElement>(null);
  const scale = trendScale(points.map((p) => p.net));
  if (!scale || present.length === 0) return null;

  const n = points.length;
  const x = (i: number) => ((i + 0.5) / n) * 100; // %
  const y = (v: number) => trendRatio(v, scale) * 100; // % (플롯 영역 안)
  const selected = points[sel];
  const selNet = selected.net ?? 0;
  const first = points[present[0]];
  const lastPt = points[present[present.length - 1]];
  const summary =
    present.length === 1
      ? `최근 6개월 순자산, ${monthNo(first.ym)}월 ${formatWonKorean(first.net!)}`
      : `최근 6개월 순자산, ${monthNo(first.ym)}월 ${formatWonKorean(first.net!)}부터 ${monthNo(lastPt.ym)}월 ${formatWonKorean(lastPt.net!)}까지`;

  function move(e: KeyboardEvent<HTMLButtonElement>) {
    const at = present.indexOf(sel);
    let next: number | undefined;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = present[at - 1];
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = present[at + 1];
    else if (e.key === 'Home') next = present[0];
    else if (e.key === 'End') next = present[present.length - 1];
    else return;
    e.preventDefault();
    if (next === undefined) return;
    setSel(next);
    labelsRef.current?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)?.focus();
  }

  return (
    <section className="asset-card trend" aria-labelledby="trend-title">
      <div className="card-head">
        <h2 id="trend-title" className="card-head__title">
          월별 추이
        </h2>
        <span className="card-head__sub">월말 순자산</span>
      </div>
      <p className="trend__cap" aria-live="polite">
        <span className="trend__cap-label">
          {monthNo(selected.ym)}월{sel === last ? ' (지금)' : ' 말'}
        </span>
        <span className={`trend__cap-value money${selNet < 0 ? ' is-negative' : ''}`}>{signedWon(selNet)}원</span>
      </p>

      <div className="trend__plot" role="img" aria-label={summary}>
        <div className="trend__area">
          {scale.crossesZero && (
            <div className="trend__zero" style={{ top: `${y(0)}%` }}>
              <span>0</span>
            </div>
          )}
          <div className="trend__guide" style={{ left: `${x(sel)}%`, top: `${y(selNet)}%` }} />
          <svg className="trend__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {trendSegments(points).map((seg) => (
              <polyline
                key={seg[0]}
                points={seg.map((i) => `${x(i)},${y(points[i].net!)}`).join(' ')}
                fill="none"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {present.map((i) => (
            <span
              key={i}
              className={`trend__dot${i === sel ? ' is-selected' : ''}`}
              style={{ left: `${x(i)}%`, top: `${y(points[i].net!)}%` }}
            />
          ))}
        </div>
      </div>

      <div ref={labelsRef} className="trend__months" role="radiogroup" aria-label="달 선택">
        {points.map((p, i) =>
          p.net === null ? (
            <span key={p.ym} className="trend__month" aria-hidden="true" />
          ) : (
            <button
              key={p.ym}
              type="button"
              role="radio"
              aria-checked={i === sel}
              tabIndex={i === sel ? 0 : -1}
              data-index={i}
              className={`trend__month${i === sel ? ' is-selected' : ''}`}
              onClick={() => setSel(i)}
              onKeyDown={move}
            >
              {monthNo(p.ym)}월
            </button>
          ),
        )}
      </div>

      {present.length === 1 && <p className="trend__note">다음 달부터 추이가 보여요</p>}

      <table className="sr-only">
        <caption>월별 순자산</caption>
        <tbody>
          {present.map((i) => (
            <tr key={points[i].ym}>
              <th scope="row">
                {monthNo(points[i].ym)}월{i === last ? ' (지금)' : ' 말'}
              </th>
              <td>{formatWonKorean(points[i].net!)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * 홈 순자산 카드의 작은 추이 (design.md 5.19 "작은 추이"): 72×36, 선 2px, 점은 마지막(선택한) 달 하나만 7px.
 * 라벨·축 없음. 장식이라 aria-hidden — 값은 카드의 aria-label이 전한다.
 */
const MINI_W = 72;
const MINI_H = 36;
const MINI_PAD = 4;

export function MiniNetWorthTrend({ points }: { points: readonly TrendPoint[] }) {
  const scale = trendScale(points.map((p) => p.net));
  if (!scale) return null;
  const n = points.length;
  const x = (i: number) => MINI_PAD + (n === 1 ? (MINI_W - 2 * MINI_PAD) / 2 : (i * (MINI_W - 2 * MINI_PAD)) / (n - 1));
  const y = (v: number) => MINI_PAD + trendRatio(v, scale) * (MINI_H - 2 * MINI_PAD);
  const lastIdx = points.length - 1;
  const lastNet = points[lastIdx].net;
  return (
    <svg
      className="mini-trend"
      width={MINI_W}
      height={MINI_H}
      viewBox={`0 0 ${MINI_W} ${MINI_H}`}
      aria-hidden="true"
      focusable="false"
    >
      {trendSegments(points).map((seg) => (
        <polyline key={seg[0]} points={seg.map((i) => `${x(i)},${y(points[i].net!)}`).join(' ')} fill="none" />
      ))}
      {lastNet !== null && <circle cx={x(lastIdx)} cy={y(lastNet)} r={3.5} />}
    </svg>
  );
}
