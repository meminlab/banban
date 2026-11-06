import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../app/auth';
import { signInWithGoogle } from '../data/auth';
import { StatusScreen } from '../components/StatusScreen';
import { getEntryUrl } from '../app/entryUrl';
import { copyText } from '../app/clipboard';
import { isKakaoInAppBrowser, kakaoOpenExternalUrl } from '../domain/inAppBrowser';

/** 외부 열기 후 이만큼 지나도 화면이 그대로면 "안 열리면 복사" 안내를 띄운다 */
export const OPEN_EXTERNAL_FALLBACK_MS = 1500;

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

  if (auth.status === 'signedIn') return <Navigate to="/" replace />;
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
          <p className="login__logo" aria-hidden="true">반반</p>
          <h1 className="login__title">둘이 함께 쓰는 가계부</h1>
          <p className="login__desc">함께 쓴 돈과 모은 돈을 한 곳에서 봐요.</p>
        </div>
        {isKakaoInAppBrowser(navigator.userAgent) ? (
          <KakaoInAppNotice />
        ) : (
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
        )}
      </main>
    </div>
  );
}

/**
 * 카카오톡 인앱 브라우저: 구글이 로그인을 막으므로(403 disallowed_useragent) 구글 버튼 대신
 * 기본 브라우저로 같은 주소를 열도록 안내한다.
 */
function KakaoInAppNotice() {
  const [openTried, setOpenTried] = useState(false);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const url = getEntryUrl();

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function openExternal() {
    window.location.href = kakaoOpenExternalUrl(url);
    if (timer.current) clearTimeout(timer.current);
    // 다른 브라우저가 열리면 이 화면은 가려진다. 계속 보이면 스킴이 안 먹은 것으로 본다
    timer.current = setTimeout(() => {
      if (document.visibilityState === 'visible') setOpenTried(true);
    }, OPEN_EXTERNAL_FALLBACK_MS);
  }

  async function handleCopy() {
    setCopy((await copyText(url)) ? 'copied' : 'failed');
  }

  return (
    <div className="login__actions login__actions--kakao">
      <p className="login__notice" role="note">
        카카오톡 안에서는 구글 로그인이 안 돼요. 다른 브라우저로 열어 주세요.
      </p>
      {openTried && (
        <p className="hint login__fallback" role="status">
          안 열리면 링크를 복사해 크롬에 붙여 넣어 주세요
        </p>
      )}
      <button type="button" className="button button--primary button--block" onClick={openExternal}>
        다른 브라우저로 열기
      </button>
      <button type="button" className="button button--secondary button--block" onClick={handleCopy}>
        링크 복사
      </button>
      <p className="login__copy-status" role="status" aria-live="polite">
        {copy === 'copied' && '복사했어요. 크롬이나 사파리 주소창에 붙여 넣어 주세요.'}
      </p>
      {copy === 'failed' && (
        <div className="login__copy-failed" role="alert">
          <p className="form-error">복사하지 못했어요. 아래 주소를 길게 눌러 복사해 주세요.</p>
          <p className="login__url">{url}</p>
        </div>
      )}
    </div>
  );
}
