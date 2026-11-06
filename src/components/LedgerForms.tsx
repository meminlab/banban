import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgers } from '../app/ledgers';
import { createLedger, joinLedger } from '../data/ledger';
import {
  INVITE_CODE_LENGTH,
  LEDGER_NAME_MAX,
  createErrorMessage,
  isInviteCodeFormat,
  joinErrorMessage,
  normalizeInviteCode,
  parseLedgerError,
  validateLedgerName,
} from '../lib/ledgerRules';

/** 가계부 만들기 / 초대코드로 참여 입력 카드 (시작 화면, 가계부 추가 화면 공용). 성공하면 그 가계부로 전환하고 홈으로 */
export function CreateLedgerForm({ displayName, onCancel }: { displayName: string; onCancel: () => void }) {
  const navigate = useNavigate();
  const { reload } = useLedgers();
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
      const id = await createLedger(name, displayName);
      // 만든 가계부로 바로 전환 (서버도 마지막으로 본 가계부로 기록)
      await reload(id);
      navigate('/', { replace: true });
    } catch (err) {
      const { code: errCode, limit } = parseLedgerError(err);
      setError(createErrorMessage(errCode, limit));
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

export function JoinCodeForm({ displayName, onCancel }: { displayName: string; onCancel: () => void }) {
  const navigate = useNavigate();
  const { reload } = useLedgers();
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
      const id = await joinLedger(normalized, displayName);
      // 참여한 가계부(이미 멤버였으면 그 가계부)로 전환
      await reload(id);
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
