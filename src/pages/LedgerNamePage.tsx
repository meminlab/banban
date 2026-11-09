import { useLedgerId } from '../app/guards';
import { SETTINGS_PATH } from '../app/routes';
import { useLoad } from '../app/useLoad';
import { RenameForm } from '../components/RenameForm';
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
        <RenameForm
          label="가계부 이름"
          initial={ledger.state.data.name}
          hint={`${LEDGER_NAME_MAX}자까지. 함께 쓰는 사람 모두에게 바뀐 이름이 보여요.`}
          validate={validateLedgerName}
          save={(name) => renameLedger(ledgerId, name)}
        />
      </main>
    </div>
  );
}
