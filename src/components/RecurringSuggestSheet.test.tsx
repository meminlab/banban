import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { RecurringTransaction } from '../data/types';
import { PAUSED_TEXT, RecurringSuggestSheet } from './RecurringSuggestSheet';

const rec = vi.hoisted(() => ({ fail: null as 'paused' | 'network' | null }));
vi.mock('../data/recurring', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/recurring')>();
  return {
    ...actual,
    recordRecurring: async () => {
      if (rec.fail === 'paused') throw new actual.RecurringPausedError();
      throw new Error('network');
    },
  };
});

const recurring: RecurringTransaction = {
  id: 'r1', ledger_id: 'ledger-1', type: 'expense', amount: 250000, category_id: 'food.out', pocket_id: 'p1', spender_id: 'mA',
  memo: '관리비', cycle: 'monthly', day_of_month: 6, month: null, weekday: null, start_on: '2026-01-01', end_on: null,
  is_paused: false, created_by: 'mA', updated_by: 'mA', created_at: '', updated_at: '',
};

function renderSheet() {
  const onDone = vi.fn();
  render(
    <RecurringSuggestSheet
      ledgerId="ledger-1"
      dues={[{ recurring, date: '2026-11-06' }]}
      options={{ categories: [], pockets: [], members: [] }}
      today="2026-11-06"
      onClose={() => {}}
      onDone={onDone}
    />,
  );
  return onDone;
}

describe('정기 내역 제안 시트: 기록 실패', () => {
  it('BANB-60 그사이 다른 멤버가 일시정지했으면 시트를 닫고(다시 불러오기) "일시정지된 정기 내역" 토스트, 되돌리기 없음', async () => {
    rec.fail = 'paused';
    const onDone = renderSheet();
    await userEvent.setup().click(screen.getByRole('button', { name: '1건 기록하기' }));
    expect(onDone).toHaveBeenCalledWith({ kind: 'recorded', text: PAUSED_TEXT });
    expect(PAUSED_TEXT).toBe('일시정지된 정기 내역이 있어 기록하지 않았어요');
  });

  it('그 밖의 실패는 시트에 오류 안내를 띄우고 다시 시도할 수 있다 (기존 동작)', async () => {
    rec.fail = 'network';
    const onDone = renderSheet();
    await userEvent.setup().click(screen.getByRole('button', { name: '1건 기록하기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('기록하지 못했어요');
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '1건 기록하기' })).toBeEnabled();
  });
});
