import { ledgerReturnPath } from './routes';

describe('ledgerReturnPath (입력 화면을 닫을 때 돌아갈 곳)', () => {
  it('탭바 ＋를 누른 탭으로 돌아간다: 홈·자산·가계부(보던 달·필터 포함)', () => {
    expect(ledgerReturnPath({ returnTo: '/' })).toBe('/');
    expect(ledgerReturnPath({ returnTo: '/assets' })).toBe('/assets');
    expect(ledgerReturnPath({ returnTo: '/ledger' })).toBe('/ledger');
    expect(ledgerReturnPath({ returnTo: '/ledger?m=2026-10&view=calendar' })).toBe('/ledger?m=2026-10&view=calendar');
  });

  it('그 밖의 주소·값이 없으면 가계부 탭', () => {
    expect(ledgerReturnPath(null)).toBe('/ledger');
    expect(ledgerReturnPath({})).toBe('/ledger');
    expect(ledgerReturnPath({ returnTo: 'https://evil.example' })).toBe('/ledger');
    expect(ledgerReturnPath({ returnTo: '/assets/new' })).toBe('/ledger');
    expect(ledgerReturnPath({ returnTo: '/settings' })).toBe('/ledger');
  });
});
