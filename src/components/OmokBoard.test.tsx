import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildBoard, cellIndex } from '../domain/omok';
import { OmokBoard } from './OmokBoard';

const board = buildBoard([{ seq: 1, x: 7, y: 7 }]);
const base = {
  board,
  selected: null,
  onSelect: () => undefined,
  onConfirm: () => undefined,
  interactive: true,
  pendingStone: 'white' as const,
  lastMove: [7, 7] as [number, number],
  lastSeq: 1,
  winLine: null,
  zoomOrigin: null,
  onPan: () => undefined,
};

describe('OmokBoard', () => {
  it('grid 15×15, 칸 이름 "8행 8열, 흑돌"', () => {
    render(<OmokBoard {...base} />);
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(15);
    expect(screen.getAllByRole('gridcell')).toHaveLength(225);
    expect(screen.getByRole('gridcell', { name: '8행 8열, 흑돌, 마지막 수' })).toBeInTheDocument();
  });

  it('내 차례면 빈칸만 고른다', () => {
    const onSelect = vi.fn();
    render(<OmokBoard {...base} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('gridcell', { name: '8행 8열, 흑돌, 마지막 수' }));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('gridcell', { name: '1행 2열, 빈칸' }));
    expect(onSelect).toHaveBeenCalledWith(1, 0);
  });

  it('33 금지 자리: X 표시 + 누르면 안내만 (돌은 고르지 않음)', () => {
    const onSelect = vi.fn();
    const onForbidden = vi.fn();
    const { container } = render(
      <OmokBoard {...base} onSelect={onSelect} onForbidden={onForbidden} forbidden={new Set([cellIndex(2, 0)])} />,
    );
    expect(container.querySelectorAll('.omok-forbidden path')).toHaveLength(1);
    fireEvent.click(screen.getByRole('gridcell', { name: '1행 3열, 33이라 둘 수 없는 자리' }));
    expect(onForbidden).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('상대 차례면 눌러도 고르지 않는다', () => {
    const onSelect = vi.fn();
    render(<OmokBoard {...base} onSelect={onSelect} interactive={false} />);
    fireEvent.click(screen.getByRole('gridcell', { name: '1행 1열, 빈칸' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('포커스는 1칸, 방향키로 고른 칸 이동, 고른 칸에서 Enter = 여기에 둘게요', () => {
    const onSelect = vi.fn();
    const onConfirm = vi.fn();
    render(<OmokBoard {...base} selected={[3, 3]} onSelect={onSelect} onConfirm={onConfirm} />);
    const focusable = screen.getAllByRole('gridcell').filter((c) => c.tabIndex === 0);
    expect(focusable).toHaveLength(1);
    expect(focusable[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(focusable[0], { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(focusable[0], { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith(4, 3);
  });

  it('확대하면 9×9 칸만', () => {
    render(<OmokBoard {...base} zoomOrigin={[3, 3]} />);
    expect(screen.getAllByRole('gridcell')).toHaveLength(81);
    expect(screen.getByRole('gridcell', { name: '4행 4열, 빈칸' })).toBeInTheDocument();
  });
});
