import { useEffect, useState } from 'react';
import { todayKST } from '../domain/transactionForm';

/**
 * 오늘 날짜(KST 'YYYY-MM-DD'). 앱을 켜 둔 채 자정이 지나도 새로고침 없이 맞추려고,
 * 앱이 다시 보일 때(visibilitychange → visible)·창에 다시 들어올 때(focus) 오늘을 다시 계산한다 (BANB-47).
 * 같은 날이면 값이 그대로라 다시 그리지 않는다. `now`는 테스트용 시각 주입.
 */
export function useTodayKST(now: () => Date = () => new Date()): string {
  const [today, setToday] = useState(() => todayKST(now()));

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setToday(todayKST(now()));
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
    // now 는 테스트 주입용이라 바뀌어도 리스너를 다시 달 필요 없다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return today;
}
