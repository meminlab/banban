import { Fragment, type ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { StatusScreen } from '../components/StatusScreen';
import { LOGIN_PATH, START_PATH } from './routes';
import { useAuth } from './auth';
import { LedgersProvider, useLedgers } from './ledgers';

/** 로그인 안 했으면 로그인 화면으로. 로그인했으면 가계부 목록을 불러온다 */
export function RequireAuth() {
  const auth = useAuth();
  if (auth.status === 'loading') return <StatusScreen kind="loading" message="로그인 상태를 확인하고 있어요" />;
  if (auth.status === 'error') return <StatusScreen kind="error" message="앱 설정에 문제가 있어요. 잠시 후 다시 시도해 주세요." />;
  if (auth.status === 'signedOut') return <Navigate to={LOGIN_PATH} replace />;
  return (
    <LedgersProvider>
      <Outlet />
    </LedgersProvider>
  );
}

/** 가계부 화면 안에서 지금 보고 있는 가계부 id */
export function useLedgerId(): string {
  const { state } = useLedgers();
  const id = state.status === 'ready' ? state.currentId : null;
  if (!id) throw new Error('RequireLedger 밖에서 useLedgerId 사용');
  return id;
}

function LedgerStatus({ children }: { children: (currentId: string | null) => ReactNode }) {
  const { state, reload } = useLedgers();
  if (state.status === 'loading') return <StatusScreen kind="loading" message="가계부를 불러오고 있어요" />;
  if (state.status === 'error')
    return (
      <StatusScreen kind="error" message="가계부를 불러오지 못했어요. 네트워크를 확인해 주세요." onRetry={() => void reload()} />
    );
  return <>{children(state.currentId)}</>;
}

/**
 * 참여한 가계부가 있어야 들어갈 수 있는 화면. 없으면 시작 화면으로.
 * 가계부를 바꾸면 화면을 새로 그려서, 이전 가계부의 입력·목록 상태가 남지 않게 한다.
 */
export function RequireLedger() {
  return (
    <LedgerStatus>
      {(currentId) =>
        currentId ? (
          <Fragment key={currentId}>
            <Outlet />
          </Fragment>
        ) : (
          <Navigate to={START_PATH} replace />
        )
      }
    </LedgerStatus>
  );
}

/** 시작 화면: 이미 가계부가 있으면 홈으로 */
export function RequireNoLedger() {
  return <LedgerStatus>{(currentId) => (currentId ? <Navigate to="/" replace /> : <Outlet />)}</LedgerStatus>;
}
