import { formatPercent, formatWon } from './format';

describe('format', () => {
  it('천 단위 구분 + 원', () => {
    expect(formatWon(0)).toBe('0원');
    expect(formatWon(1240000)).toBe('1,240,000원');
    expect(formatWon(9999999999)).toBe('9,999,999,999원');
    expect(formatWon(-35000)).toBe('\u221235,000원'); // − (U+2212), 하이픈 아님
  });

  it('비율은 정수 %', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.825)).toBe('83%');
    expect(formatPercent(1)).toBe('100%');
  });
});
