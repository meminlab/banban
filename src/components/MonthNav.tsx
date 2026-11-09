import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatMonthLabel, formatYearMonth, type YearMonth } from '../domain/month';

/**
 * 월 이동 줄 (design.md 5.23): 카드가 아닌 바탕 위 한 줄(높이 48). ‹ 11월 › — 올해는 연도 없이, 다른 해만 "2025년 11월".
 * 홈·가계부 공통. 가계부 탭은 오른쪽에 아이콘 버튼(보기 전환·필터)을 children 으로 넣는다.
 */
export function MonthNav({
  month,
  onMove,
  children,
}: {
  month: YearMonth;
  onMove: (delta: -1 | 1) => void;
  children?: ReactNode;
}) {
  return (
    <div className="month-nav">
      <div className="month-nav__center">
        <button type="button" className="icon-button" aria-label="이전 달" onClick={() => onMove(-1)}>
          <ChevronLeft size={24} strokeWidth={2} aria-hidden="true" />
        </button>
        {/* 보이는 글자는 연도를 줄여도 화면낭독은 연도까지 */}
        <h2 className="month-nav__label" aria-live="polite" aria-label={formatYearMonth(month)}>
          {formatMonthLabel(month)}
        </h2>
        <button type="button" className="icon-button" aria-label="다음 달" onClick={() => onMove(1)}>
          <ChevronRight size={24} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      {children && <div className="month-nav__actions">{children}</div>}
    </div>
  );
}
