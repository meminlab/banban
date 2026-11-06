import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { getMyLedgerId } from '../data/ledger';
import { StatusScreen } from '../components/StatusScreen';
import { LOGIN_PATH, START_PATH } from './routes';
import { useAuth, useCurrentUser } from './auth';

/** 로그인 안 했으면 로그인 화면으로 */
export function RequireAuth() {
  const auth = useAuth();
  if (auth.status === 'loading') return <StatusScreen kind="loading" message="로그인 상태를 확인하고 있어요" />;
  if (auth.status === 'error') return <StatusScreen kind="error" message="앱 설정에 문제가 있어요. 잠시 후 다시 시도해 주세요." />;
  if (auth.status === 'signedOut') return <Navigate to={LOGIN_PATH} replace />;
  return <Outlet />;
}

type LedgerState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; ledgerId: string | null };

function useMyLedger() {
  const user = useCurrentUser();
  const [state, setState] = useState<LedgerState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    getMyLedgerId(user.id).then(
      (ledgerId) => alive && setState({ status: 'ready', ledgerId }),
      () => alive && setState({ status: 'error' }),
    );
    return () => {
      alive = false;
    };
  }, [user.id, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}

const LedgerIdContext = createContext<string | null>(null);

/** 가계부 화면 안에서 현재 가계부 id */
export function useLedgerId(): string {
  const id = useContext(LedgerIdContext);
  if (!id) throw new Error('RequireLedger 밖에서 useLedgerId 사용');
  return id;
}

/** 참여한 가계부가 있어야 들어갈 수 있는 화면. 없으면 시작 화면으로 */
export function RequireLedger() {
  const { state, retry } = useMyLedger();
  if (state.status === 'loading') return <StatusScreen kind="loading" message="가계부를 불러오고 있어요" />;
  if (state.status === 'error')
    return <StatusScreen kind="error" message="가계부를 불러오지 못했어요. 네트워크를 확인해 주세요." onRetry={retry} />;
  if (!state.ledgerId) return <Navigate to={START_PATH} replace />;
  return (
    <LedgerIdContext.Provider value={state.ledgerId}>
      <Outlet />
    </LedgerIdContext.Provider>
  );
}

/** 시작 화면: 이미 가계부가 있으면 홈으로 */
export function RequireNoLedger() {
  const { state, retry } = useMyLedger();
  if (state.status === 'loading') return <StatusScreen kind="loading" message="가계부를 불러오고 있어요" />;
  if (state.status === 'error')
    return <StatusScreen kind="error" message="가계부를 불러오지 못했어요. 네트워크를 확인해 주세요." onRetry={retry} />;
  if (state.ledgerId) return <Navigate to="/" replace />;
  return <Outlet />;
}
