import { useCallback, useEffect, useState } from 'react';

export type LoadState<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

/** 화면 진입 시 한 번 불러오기 + 다시 시도/새로 불러오기. deps 가 바뀌면 다시 불러온다 */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    load().then(
      (data) => alive && setState({ status: 'ready', data }),
      () => alive && setState({ status: 'error' }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  /** 저장 후 화면 값만 바꿀 때 */
  const setData = useCallback((data: T) => setState({ status: 'ready', data }), []);
  return { state, reload, setData };
}
