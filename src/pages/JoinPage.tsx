import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../app/auth';
import { useMyProfile } from '../app/useProfile';
import { LOGIN_PATH } from '../app/routes';
import { StatusScreen } from '../components/StatusScreen';
import { joinLedger } from '../data/ledger';
import { clearPendingInvite, savePendingInvite } from '../data/pendingInvite';
import {
  isInviteCodeFormat,
  joinErrorMessage,
  memberDisplayName,
  normalizeInviteCode,
  parseLedgerError,
  type LedgerErrorCode,
} from '../lib/ledgerRules';

/** 초대 링크(/join/<코드>)로 들어온 화면. 로그인 전이면 코드를 기억해 두고 로그인 화면으로 보낸다 */
export function JoinPage() {
  const auth = useAuth();
  const { code: rawCode = '' } = useParams();
  const code = normalizeInviteCode(rawCode);

  if (auth.status === 'loading') return <StatusScreen kind="loading" message="로그인 상태를 확인하고 있어요" />;
  if (auth.status === 'error')
    return <StatusScreen kind="error" message="앱 설정에 문제가 있어요. 잠시 후 다시 시도해 주세요." />;
  if (auth.status === 'signedOut') {
    if (isInviteCodeFormat(code)) savePendingInvite(code);
    return <Navigate to={LOGIN_PATH} replace />;
  }
  return <JoinConfirm code={code} />;
}

function JoinConfirm({ code }: { code: string }) {
  const navigate = useNavigate();
  const profile = useMyProfile();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: LedgerErrorCode; message: string } | null>(() =>
    isInviteCodeFormat(code) ? null : { code: 'INVITE_NOT_FOUND', message: joinErrorMessage('INVITE_NOT_FOUND', null) },
  );

  // 로그인을 다녀와 여기까지 왔으면 기억해 둔 코드는 더 쓰지 않는다
  useEffect(() => clearPendingInvite(), []);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await joinLedger(code, memberDisplayName(profile.name));
      navigate('/', { replace: true });
    } catch (err) {
      const parsed = parseLedgerError(err);
      setError({ code: parsed.code, message: joinErrorMessage(parsed.code, parsed.limit) });
      setBusy(false);
    }
  }

  const canRetry = error === null || error.code === 'UNKNOWN';

  return (
    <div className="shell">
      <header className="topbar">
        <h1 className="topbar__title">가계부 참여</h1>
      </header>
      <main className="content content--no-tabbar join">
        <section className="form-card" aria-labelledby="join-title">
          <h2 id="join-title" className="form-card__title">
            초대받은 가계부에 참여할까요?
          </h2>
          <p className="hint">참여하면 함께 쓰는 사람과 같은 가계부를 보고 기록할 수 있어요.</p>
          {isInviteCodeFormat(code) && (
            <p className="invite-code" aria-label={`초대 코드 ${code.split('').join(' ')}`}>
              {code}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error.message}
            </p>
          )}
          {canRetry ? (
            <button type="button" className="button button--primary button--block" onClick={join} disabled={busy}>
              {busy ? '참여하는 중…' : error ? '다시 시도' : '참여하기'}
            </button>
          ) : (
            <button
              type="button"
              className="button button--secondary button--block"
              onClick={() => navigate('/', { replace: true })}
            >
              {error?.code === 'ALREADY_IN_LEDGER' ? '내 가계부로 가기' : '처음 화면으로'}
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
