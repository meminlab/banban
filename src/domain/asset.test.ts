import type { Asset, Member } from '../data/types';
import {
  ASSET_KINDS,
  daysSinceKST,
  formatDateKST,
  ownerLabel,
  ownerOptions,
  sortAssets,
  updatedAgo,
  validateAssetForm,
  type AssetFormValues,
} from './asset';

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
  archived_at: null,
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

describe('ASSET_KINDS', () => {
  it('자산 9종 + 부채 3종, 코드 이름 고정', () => {
    expect(ASSET_KINDS.filter((k) => k.group === 'asset').map((k) => k.value)).toEqual([
      'checking', 'installment_saving', 'deposit', 'investment', 'pension', 'cash', 'real_estate', 'vehicle', 'other',
    ]);
    expect(ASSET_KINDS.filter((k) => k.group === 'liability').map((k) => k.value)).toEqual([
      'loan', 'card_payable', 'other_liability',
    ]);
  });
});

describe('ownerOptions (사람별 칩)', () => {
  it('현재 멤버(참여 순) → 공동 → 자산이 있는 나간 멤버', () => {
    expect(ownerOptions([], [B, A, GONE]).map((o) => o.label)).toEqual(['민지', '준호', '공동']);
    const opts = ownerOptions([asset('1', 'mc', 1)], [B, A, GONE]);
    expect(opts.map((o) => [o.label, o.left])).toEqual([
      ['민지', false],
      ['준호', false],
      ['공동', false],
      ['하늘', true],
    ]);
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

describe('updatedAgo / daysSinceKST', () => {
  const now = new Date('2026-11-06T03:00:00Z'); // KST 11-06 12:00
  it('KST 달력 날짜 기준', () => {
    expect(daysSinceKST('2026-11-05T15:30:00Z', now)).toBe(0); // KST 11-06 00:30
    expect(daysSinceKST('2026-11-05T14:59:59Z', now)).toBe(1); // KST 11-05 23:59
  });
  it('오늘 / n일 전, 30일 넘으면 강조 (AS-19)', () => {
    expect(updatedAgo('2026-11-06T00:00:00Z', now)).toEqual({ text: '오늘 수정', stale: false });
    expect(updatedAgo('2026-10-07T03:00:00Z', now)).toEqual({ text: '30일 전 수정', stale: false });
    expect(updatedAgo('2026-10-06T03:00:00Z', now)).toEqual({ text: '31일 전 수정', stale: true });
  });
});

describe('formatDateKST', () => {
  const now = new Date('2026-11-06T03:00:00Z');
  it('올해는 월·일, 지난해는 연·월·일 (KST)', () => {
    expect(formatDateKST('2026-11-05T15:30:00Z', now)).toBe('11월 6일');
    expect(formatDateKST('2025-03-01T00:00:00Z', now)).toBe('2025년 3월 1일');
  });
});
