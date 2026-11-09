import { formatWonKorean } from '../domain/money';
import { trendRatio, trendScale, trendSegments, type TrendPoint } from '../domain/netWorth';

/**
 * 자산 탭 "6개월 추이" — 최근 6개월 월말 순자산 선 그래프 (design.md 5.19, 단순화 5.23-4)
 * 그래프 라이브러리 없이 SVG(선) + HTML(점·월 라벨)로 그린다. 선은 가로로 늘어나도 굵기가 그대로(non-scaling-stroke),
 * 점은 마지막 달 하나, x축은 처음·끝 달만. 달 고르기·선택한 달 값 줄은 없다(5.23).
 */

const monthNo = (ym: string) => Number(ym.slice(5));

export function NetWorthTrend({ points }: { points: readonly TrendPoint[] }) {
  const present = points.flatMap((p, i) => (p.net === null ? [] : [i]));
  const scale = trendScale(points.map((p) => p.net));
  if (!scale || present.length === 0) return null;

  const n = points.length;
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100); // % — 처음·끝 달이 양 끝
  const y = (v: number) => trendRatio(v, scale) * 100; // % (플롯 영역 안)
  const last = points.length - 1;
  const firstIdx = present[0];
  const lastIdx = present[present.length - 1];
  const first = points[firstIdx];
  const lastPt = points[lastIdx];
  const summary =
    present.length === 1
      ? `최근 6개월 순자산, ${monthNo(first.ym)}월 ${formatWonKorean(first.net!)}`
      : `최근 6개월 순자산, ${monthNo(first.ym)}월 ${formatWonKorean(first.net!)}부터 ${monthNo(lastPt.ym)}월 ${formatWonKorean(lastPt.net!)}까지`;
  const axis = present.length === 1 ? [lastIdx] : [firstIdx, lastIdx];

  return (
    <section className="asset-card trend" aria-labelledby="trend-title">
      <h2 id="trend-title" className="card-head__title">
        6개월 추이
      </h2>

      <div className="trend__plot" role="img" aria-label={summary}>
        <div className="trend__area">
          {scale.crossesZero && (
            <div className="trend__zero" style={{ top: `${y(0)}%` }}>
              <span>0</span>
            </div>
          )}
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
          <span className="trend__dot" style={{ left: `${x(lastIdx)}%`, top: `${y(lastPt.net!)}%` }} />
        </div>
      </div>

      <div className="trend__months" aria-hidden="true">
        {axis.map((i) => (
          // 양 끝 라벨이 카드 밖으로 나가지 않게: 왼쪽 끝은 왼쪽 맞춤, 오른쪽 끝은 오른쪽 맞춤
          <span key={i} className="trend__month" style={{ left: `${x(i)}%`, transform: `translateX(-${x(i)}%)` }}>
            {monthNo(points[i].ym)}월
          </span>
        ))}
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
