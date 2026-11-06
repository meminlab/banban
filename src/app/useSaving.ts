import { useCallback, useEffect, useRef, useState } from 'react';
import { CatalogError } from '../data/catalog';

/** 저장 실패 안내 문구 */
export function saveErrorMessage(e: unknown): string {
  if (e instanceof CatalogError) {
    if (e.code === 'INVALID_NAME') return '이름은 1~20자로 입력해 주세요.';
    if (e.code === 'NOT_FOUND') return '이미 없어진 항목이에요. 화면을 새로고침해 주세요.';
  }
  return '저장하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.';
}

/**
 * 저장 버튼 상태: 저장 중 / 실패 안내 / 저장 완료 알림(잠깐 보였다 사라짐).
 * run(fn) 이 true 를 돌려주면 성공.
 */
export function useSaving() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const run = useCallback(async (fn: () => Promise<unknown>, doneMessage = '저장했어요'): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setDone(doneMessage);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(null), 2000);
      return true;
    } catch (e) {
      setError(saveErrorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
  return { busy, error, done, run, clearError };
}
