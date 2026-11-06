import { captureEntryUrl, getEntryUrl, resetEntryUrl } from './entryUrl';

beforeEach(() => resetEntryUrl());

it('처음 기억한 주소를 유지한다 (이후 /login 으로 바뀌어도)', () => {
  captureEntryUrl('https://banban.example/join/AB12CD?x=1');
  captureEntryUrl('https://banban.example/login');
  expect(getEntryUrl()).toBe('https://banban.example/join/AB12CD?x=1');
});

it('기억한 게 없으면 지금 주소', () => {
  expect(getEntryUrl()).toBe(window.location.href);
});
