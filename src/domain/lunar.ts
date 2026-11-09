/**
 * 음력 ↔ 양력 (한국천문연구원 기준). 무료 오픈소스 라이브러리 korean-lunar-calendar(MIT)를 감싼다.
 * - 윤달은 평달로 본다(명세): 음력 날짜는 항상 평달로 저장하고, 평달 날짜로 바꾼다
 * - 지원 범위 밖(라이브러리 기준 음력 1000년 ~ 2050년 11월쯤)이면 null
 */
import KoreanLunarCalendar from 'korean-lunar-calendar';

export interface LunarDate {
  year: number;
  month: number; // 1~12
  day: number; // 1~30
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 음력(평달) → 양력 'YYYY-MM-DD'. 그 달에 없는 날(30일인데 작은달)이거나 범위 밖이면 null */
export function lunarToSolar({ year, month, day }: LunarDate): string | null {
  const cal = new KoreanLunarCalendar();
  if (!cal.setLunarDate(year, month, day, false)) return null;
  const s = cal.getSolarCalendar();
  return `${s.year}-${pad2(s.month)}-${pad2(s.day)}`;
}

/**
 * 해마다 펼칠 때 쓰는 변환: 그해 그 달이 작은달(29일)이라 30일이 없으면 29일(말일)로.
 * 범위 밖이면 null
 */
export function lunarToSolarClamped(date: LunarDate): string | null {
  return lunarToSolar(date) ?? (date.day === 30 ? lunarToSolar({ ...date, day: 29 }) : null);
}

/** 양력 'YYYY-MM-DD' → 음력. 윤달이면 leap = true (화면에서는 평달로 다룬다). 범위 밖이면 null */
export function solarToLunar(date: string): (LunarDate & { leap: boolean }) | null {
  const [y, m, d] = date.split('-').map(Number);
  const cal = new KoreanLunarCalendar();
  if (!cal.setSolarDate(y, m, d)) return null;
  const l = cal.getLunarCalendar();
  return { year: l.year, month: l.month, day: l.day, leap: !!l.intercalation };
}

/** 음력 그 해 그 달(평달)의 날 수: 29 또는 30. 범위 밖이면 30 (고를 수는 있고 저장 전에 변환에서 걸러진다) */
export function lunarMonthDays(year: number, month: number): 29 | 30 {
  if (lunarToSolar({ year, month, day: 30 })) return 30;
  return lunarToSolar({ year, month, day: 29 }) ? 29 : 30;
}
