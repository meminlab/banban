import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../app/auth';
import { signInWithGoogle } from '../data/auth';
import { StatusScreen } from '../components/StatusScreen';
import { BrandLogo } from '../components/BrandLogo';
import { readPendingInvite } from '../data/pendingInvite';
import { JOIN_PATH_PREFIX } from '../lib/ledgerRules';

/** 구글에서 돌아올 때 붙어 오는 오류 (?error=… 또는 #error=…) */
function readOAuthError(search: string, hash: string): boolean {
  const q = new URLSearchParams(search);
  const h = new URLSearchParams(hash.replace(/^#/, ''));
  return q.has('error') || h.has('error');
}

export function LoginPage() {
  const auth = useAuth();
  const { search, hash } = useLocation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(() => readOAuthError(search, hash));

  if (auth.status === 'signedIn') {
    // 초대 링크로 들어왔다가 로그인한 경우 참여 화면으로 이어 간다
    const pending = readPendingInvite();
    return <Navigate to={pending ? `${JOIN_PATH_PREFIX}${pending}` : '/'} replace />;
  }
  if (auth.status === 'loading') return <StatusScreen kind="loading" message="로그인 상태를 확인하고 있어요" />;

  async function handleGoogle() {
    setBusy(true);
    setFailed(false);
    try {
      await signInWithGoogle(); // 성공하면 구글 화면으로 이동한다
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <main className="login">
        <div className="login__brand">
          <BrandLogo className="login__logo" />
          <h1 className="login__title">둘이 함께 쓰는 가계부</h1>
          <p className="login__desc">함께 쓴 돈과 모은 돈을 한 곳에서 봐요.</p>
        </div>
        <div className="login__actions">
          {(failed || auth.status === 'error') && (
            <p className="form-error" role="alert">
              로그인하지 못했어요. 잠시 후 다시 시도해 주세요.
            </p>
          )}
          <button
            type="button"
            className="button button--primary button--block"
            onClick={handleGoogle}
            disabled={busy || auth.status === 'error'}
          >
            {busy ? '구글로 이동하는 중…' : '구글 계정으로 로그인'}
          </button>
        </div>
      </main>
    </div>
  );
}
