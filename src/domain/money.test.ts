import { formatWon, formatWonInput, parseWonInput, MAX_WON } from './money';

describe('formatWon', () => {
  it('천 단위 쉼표', () => {
    expect(formatWon(0)).toBe('0');
    expect(formatWon(1240000)).toBe('1,240,000');
    expect(formatWon(MAX_WON)).toBe('9,999,999,999');
  });
});

describe('formatWonInput', () => {
  it.each([
    ['', ''],
    ['1234', '1,234'],
    ['1,2345', '12,345'],
    ['0001500', '1,500'],
    ['0', '0'],
  ])('%s → %s', (raw, out) => expect(formatWonInput(raw)).toBe(out));

  it('숫자·쉼표 외 문자가 있으면 손대지 않는다 (저장 시 오류로 안내)', () => {
    expect(formatWonInput('-100')).toBe('-100');
    expect(formatWonInput('1.5')).toBe('1.5');
  });
});

describe('parseWonInput', () => {
  it.each([
    ['0', 0],
    ['1,234', 1234],
    ['1234', 1234],
    [' 9,999,999,999 ', MAX_WON],
  ])('%s → %d', (raw, value) => expect(parseWonInput(raw)).toEqual({ ok: true, value }));

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['-1', 'not_integer'],
    ['1.5', 'not_integer'],
    ['1,5', 'not_integer'],
    ['abc', 'not_integer'],
    ['1e3', 'not_integer'],
    ['10,000,000,000', 'too_large'],
    ['99999999999999999999', 'too_large'],
  ])('%s 는 실패 (%s)', (raw, reason) => expect(parseWonInput(raw)).toEqual({ ok: false, reason }));
});
