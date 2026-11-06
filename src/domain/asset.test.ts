import type { Asset, Member } from '../data/types';
import { formatUpdatedAt, ownerLabel, sortAssets, summarizeAssets, validateAssetForm, type AssetFormValues } from './asset';

const member = (id: string, name: string, joined: string, left: string | null = null): Member => ({
  id,
  ledger_id: 'L',
  user_id: `u-${id}`,
  role: 'member',
  display_name: name,
  joined_at: joined,
  left_at: left,
});
const asset = (id: string, owner: string | null, balance: number, name = id): Asset => ({
  id,
  ledger_id: 'L',
  name,
  kind: 'checking',
  owner_id: owner,
  balance,
  memo: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
});

const A = member('ma', '민지', '2026-11-01T00:00:00Z');
const B = member('mb', '준호', '2026-11-02T00:00:00Z');
const GONE = member('mc', '하늘', '2026-10-01T00:00:00Z', '2026-11-03T00:00:00Z');

describe('ownerLabel', () => {
  it('null 은 공동, 나간 멤버는 (나감)', () => {
    expect(ownerLabel(null, [A])).toBe('공동');
    expect(ownerLabel('ma', [A])).toBe('민지');
    expect(ownerLabel('mc', [GONE])).toBe('하늘 (나감)');
  });
});

describe('summarizeAssets', () => {
  it('자산이 없으면 전체 0원, 현재 멤버와 공동이 0원으로 보인다', () => {
    const s = summarizeAssets([], [B, A]);
    expect(s.total).toBe(0);
    expect(s.byOwner.map((o) => [o.label, o.total])).toEqual([
      ['민지', 0],
      ['준호', 0],
      ['공동', 0],
    ]);
  });

  it('전체·소유자별(공동 포함) 합계', () => {
    const s = summarizeAssets(
      [asset('1', 'ma', 1_000_000), asset('2', 'ma', 500), asset('3', null, 300_000), asset('4', 'mb', 2_000)],
      [A, B],
    );
    expect(s.total).toBe(1_302_500);
    expect(s.byOwner.map((o) => [o.label, o.total, o.count])).toEqual([
      ['민지', 1_000_500, 2],
      ['준호', 2_000, 1],
      ['공동', 300_000, 1],
    ]);
    expect(s.byOwner.reduce((sum, o) => sum + o.total, 0)).toBe(s.total);
  });

  it('나간 멤버는 자산이 있을 때만 (나감) 표시로 뒤에 붙는다', () => {
    expect(summarizeAssets([], [A, GONE]).byOwner.map((o) => o.label)).toEqual(['민지', '공동']);
    const s = summarizeAssets([asset('1', 'mc', 700)], [A, GONE]);
    expect(s.byOwner.map((o) => [o.label, o.total])).toEqual([
      ['민지', 0],
      ['공동', 0],
      ['하늘 (나감)', 700],
    ]);
    expect(s.total).toBe(700);
  });

  it('상한 금액을 여러 개 더해도 정확하다', () => {
    const s = summarizeAssets([asset('1', null, 9_999_999_999), asset('2', null, 9_999_999_999)], [A]);
    expect(s.total).toBe(19_999_999_998);
  });
});

describe('sortAssets', () => {
  it('잔액 큰 순, 같으면 이름 순', () => {
    const out = sortAssets([asset('1', null, 10, '나'), asset('2', null, 50, '다'), asset('3', null, 10, '가')]);
    expect(out.map((a) => a.name)).toEqual(['다', '가', '나']);
  });
});

describe('validateAssetForm', () => {
  const base: AssetFormValues = { name: '생활비 통장', kind: 'checking', ownerId: null, balance: '1,000', memo: '' };

  it('정상 값은 정리해서 돌려준다 (앞뒤 공백 제거, 빈 메모는 null)', () => {
    expect(validateAssetForm({ ...base, name: '  생활비 통장 ', memo: '  ' })).toEqual({
      ok: true,
      value: { name: '생활비 통장', kind: 'checking', owner_id: null, balance: 1000, memo: null },
    });
  });

  it('잔액 0원은 저장된다', () => {
    expect(validateAssetForm({ ...base, balance: '0' }).ok).toBe(true);
  });

  it.each(['', '-1', '1.5', '10,000,000,000', '일만'])('잔액 "%s" 는 저장되지 않는다', (balance) => {
    const r = validateAssetForm({ ...base, balance });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.balance).toBeTruthy();
  });

  it('이름은 공백 제거 후 1~20자', () => {
    expect(validateAssetForm({ ...base, name: '   ' }).ok).toBe(false);
    expect(validateAssetForm({ ...base, name: '가'.repeat(20) }).ok).toBe(true);
    const r = validateAssetForm({ ...base, name: '가'.repeat(21) });
    expect(r.ok).toBe(false);
  });

  it('메모는 100자까지', () => {
    expect(validateAssetForm({ ...base, memo: 'a'.repeat(100) }).ok).toBe(true);
    expect(validateAssetForm({ ...base, memo: 'a'.repeat(101) }).ok).toBe(false);
  });
});

describe('formatUpdatedAt', () => {
  const now = new Date('2026-11-06T03:00:00Z');
  it('올해는 월·일·시각 (KST)', () => {
    expect(formatUpdatedAt('2026-11-05T15:30:00Z', now)).toBe('11월 6일 00:30');
  });
  it('지난해는 연·월·일', () => {
    expect(formatUpdatedAt('2025-03-01T00:00:00Z', now)).toBe('2025년 3월 1일');
  });
});
