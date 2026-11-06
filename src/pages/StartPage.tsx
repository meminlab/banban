import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMyProfile } from '../app/useProfile';
import { useSignOut } from '../app/useSignOut';
import { Avatar } from '../components/Avatar';
import { createLedger, joinLedger } from '../data/ledger';
import {
  INVITE_CODE_LENGTH,
  LEDGER_NAME_MAX,
  createErrorMessage,
  isInviteCodeFormat,
  joinErrorMessage,
  memberDisplayName,
  normalizeInviteCode,
  parseLedgerError,
  validateLedgerName,
} from '../lib/ledgerRules';

type Mode = 'menu' | 'create' | 'join';

/** 참여한 가계부가 없을 때: 가계부 만들기 / 초대코드 입력 */
export function StartPage() {
  const profile = useMyProfile();
  const logout = useSignOut();
  const [mode, setMode] = useState<Mode>('menu');

  return (
    <div className="shell">
      <header className="topbar">
        <h1 className="topbar__title">가계부 시작하기</h1>
      </header>
      <main className="content content--no-tabbar start">
        <section className="profile-card" aria-label="내 계정">
          <Avatar name={profile.name} src={profile.avatarUrl} />
          <div>
            <p className="profile-card__name">{profile.name}님, 반가워요</p>
            <p className="profile-card__sub">아직 참여한 가계부가 없어요.</p>
          </div>
        </section>

        {mode === 'menu' && (
          <div className="start__options">
            <button type="button" className="option-card" onClick={() => setMode('create')}>
              <span className="option-card__title">가계부 만들기</span>
              <span className="option-card__desc">새 가계부를 만들고 함께 쓸 사람을 초대해요</span>
            </button>
            <button type="button" className="option-card" onClick={() => setMode('join')}>
              <span className="option-card__title">초대코드 입력</span>
              <span className="option-card__desc">받은 8자리 코드로 가계부에 참여해요</span>
            </button>
          </div>
        )}
        {mode === 'create' && <CreateForm displayName={memberDisplayName(profile.name)} onCancel={() => setMode('menu')} />}
        {mode === 'join' && <JoinCodeForm displayName={memberDisplayName(profile.name)} onCancel={() => setMode('menu')} />}

        {logout.error && (
          <p className="form-error" role="alert">
            로그아웃하지 못했어요. 다시 시도해 주세요.
          </p>
        )}
        <button type="button" className="button button--secondary button--block" onClick={logout.run} disabled={logout.busy}>
          {logout.busy ? '로그아웃하는 중…' : '로그아웃'}
        </button>
      </main>
    </div>
  );
}

function CreateForm({ displayName, onCancel }: { displayName: string; onCancel: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = validateLedgerName(name);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createLedger(name, displayName);
      navigate('/', { replace: true });
    } catch (err) {
      setError(createErrorMessage(parseLedgerError(err).code));
      setBusy(false);
    }
  }

  return (
    <form className="form-card" onSubmit={submit} noValidate>
      <h2 className="form-card__title">가계부 만들기</h2>
      <div className="field">
        <label htmlFor="create-name" className="field__label">
          가계부 이름
        </label>
        <input
          id="create-name"
          className="field__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 우리집 가계부"
          autoFocus
          aria-invalid={error ? true : undefined}
          aria-describedby="create-help"
        />
        <span id="create-help" className="hint">
          {LEDGER_NAME_MAX}자까지. 나중에 설정에서 바꿀 수 있어요.
        </span>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-card__actions">
        <button type="button" className="button button--secondary" onClick={onCancel} disabled={busy}>
          취소
        </button>
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? '만드는 중…' : '만들기'}
        </button>
      </div>
    </form>
  );
}

function JoinCodeForm({ displayName, onCancel }: { displayName: string; onCancel: () => void }) {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeInviteCode(code);
    if (!isInviteCodeFormat(normalized)) {
      setError(`초대 코드 ${INVITE_CODE_LENGTH}자리를 입력해 주세요.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await joinLedger(normalized, displayName);
      navigate('/', { replace: true });
    } catch (err) {
      const { code: errCode, limit } = parseLedgerError(err);
      setError(joinErrorMessage(errCode, limit));
      setBusy(false);
    }
  }

  return (
    <form className="form-card" onSubmit={submit} noValidate>
      <h2 className="form-card__title">초대코드 입력</h2>
      <div className="field">
        <label htmlFor="join-code" className="field__label">
          초대 코드 8자리
        </label>
        <input
          id="join-code"
          className="field__input field__input--code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={12}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="ABCD2345"
          autoFocus
          aria-invalid={error ? true : undefined}
        />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-card__actions">
        <button type="button" className="button button--secondary" onClick={onCancel} disabled={busy}>
          취소
        </button>
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? '참여하는 중…' : '참여하기'}
        </button>
      </div>
    </form>
  );
}
