import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildBoard } from '../domain/omok';
import { OmokBoard } from './OmokBoard';

const board = buildBoard([{ seq: 1, x: 7, y: 7 }]);

describe('OmokBoard', () => {
  it('내 차례면 빈칸을 고를 수 있고, 돌이 있는 칸은 고를 수 없다', () => {
    const onSelect = vi.fn();
    render(<OmokBoard board={board} selected={null} onSelect={onSelect} interactive pendingStone="white" lastMove={[7, 7]} winLine={null} />);
    fireEvent.click(screen.getByRole('button', { name: '8행 8열, 흑돌, 마지막 수' }));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '1행 2열, 빈칸' }));
    expect(onSelect).toHaveBeenCalledWith(1, 0);
  });

  it('상대 차례면 눌러도 고르지 않는다', () => {
    const onSelect = vi.fn();
    render(<OmokBoard board={board} selected={null} onSelect={onSelect} interactive={false} pendingStone="white" lastMove={null} winLine={null} />);
    fireEvent.click(screen.getByRole('button', { name: '1행 1열, 빈칸' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('칸 225개, 포커스는 1칸만 받고 화살표로 옮긴다', () => {
    render(<OmokBoard board={board} selected={[3, 3]} onSelect={() => undefined} interactive pendingStone="black" lastMove={null} winLine={null} />);
    const focusable = screen.getAllByRole('button').filter((b) => b.tabIndex === 0);
    expect(screen.getAllByRole('button')).toHaveLength(225);
    expect(focusable).toHaveLength(1);
    expect(focusable[0]).toHaveAccessibleName('4행 4열, 빈칸, 고른 칸');
    fireEvent.keyDown(focusable[0], { key: 'ArrowRight' });
    expect(document.activeElement).toHaveAccessibleName('4행 5열, 빈칸');
  });
});
