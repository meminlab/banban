import { useEffect, useState, type FormEvent } from 'react';
import { useLedgerId } from '../app/guards';
import { SETTINGS_PATH } from '../app/routes';
import { useLoad } from '../app/useLoad';
import { StatusScreen } from '../components/StatusScreen';
import { SubPageTopbar } from '../components/SubPageTopbar';
import { getLedger, renameLedger } from '../data/ledger';
import { LEDGER_NAME_MAX, validateLedgerName } from '../lib/ledgerRules';

/** 설정 > 가계부 이름 변경 */
export function LedgerNamePage() {
  const ledgerId = useLedgerId();
  const ledger = useLoad(() => getLedger(ledgerId), [ledgerId]);

  if (ledger.state.status === 'loading') return <StatusScreen kind="loading" message="가계부를 불러오고 있어요" />;
  if (ledger.state.status === 'error')
    return (
      <StatusScreen kind="error" message="가계부를 불러오지 못했어요. 네트워크를 확인해 주세요." onRetry={ledger.reload} />
    );

  return (
    <div className="shell">
      <SubPageTopbar title="가계부 이름" fallback={SETTINGS_PATH} />
      <main className="content content--no-tabbar">
        <NameForm ledgerId={ledgerId} initial={ledger.state.data.name} />
      </main>
    </div>
  );
}

function NameForm({ ledgerId, initial }: { ledgerId: string; initial: string }) {
  const [name, setName] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 2500);
    return () => clearTimeout(t);
  }, [done]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = validateLedgerName(name);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await renameLedger(ledgerId, name.trim());
      setSaved(name.trim());
      setName(name.trim());
      setDone(true);
    } catch {
      setError('저장하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  const unchanged = name.trim() === saved;

  return (
    <form className="form-card" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="ledger-name" className="field__label">
          가계부 이름
        </label>
        <input
          id="ledger-name"
          className="field__input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDone(false);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby="name-help"
        />
        <span id="name-help" className="hint">
          {LEDGER_NAME_MAX}자까지. 함께 쓰는 사람 모두에게 바뀐 이름이 보여요.
        </span>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="form-success" role="status">
          저장했어요.
        </p>
      )}
      <button type="submit" className="button button--primary button--block" disabled={busy || unchanged}>
        {busy ? '저장하는 중…' : '저장'}
      </button>
    </form>
  );
}
