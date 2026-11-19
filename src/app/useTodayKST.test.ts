import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTodayKST } from './useTodayKST';

function setVisibility(state: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
}

describe('useTodayKST (BANB-47 자정 지난 뒤 앱으로 돌아오면 오늘 다시 계산)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('앱이 다시 보이면 새 날짜(KST)로 바뀐다', () => {
    let now = new Date('2026-11-19T14:59:00Z'); // KST 23:59
    const { result } = renderHook(() => useTodayKST(() => now));
    expect(result.current).toBe('2026-11-19');

    now = new Date('2026-11-19T15:01:00Z'); // KST 다음 날 00:01
    // 숨은 채로는 바꾸지 않는다
    setVisibility('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current).toBe('2026-11-19');

    setVisibility('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current).toBe('2026-11-20');
  });

  it('창에 다시 들어올 때(focus)도 다시 계산', () => {
    let now = new Date('2026-11-19T14:59:00Z');
    const { result } = renderHook(() => useTodayKST(() => now));
    now = new Date('2026-11-20T15:00:00Z');
    setVisibility('visible');
    act(() => window.dispatchEvent(new Event('focus')));
    expect(result.current).toBe('2026-11-21');
  });

  it('같은 날이면 다시 그리지 않는다', () => {
    const now = new Date('2026-11-19T03:00:00Z');
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useTodayKST(() => now);
    });
    const before = renders;
    setVisibility('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(renders).toBe(before);
  });

  it('언마운트하면 리스너를 뗀다', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useTodayKST());
    unmount();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
