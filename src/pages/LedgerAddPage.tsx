import { useNavigate } from 'react-router-dom';
import { useMyProfile } from '../app/useProfile';
import { SubPageTopbar } from '../components/SubPageTopbar';
import { CreateLedgerForm, JoinCodeForm } from '../components/LedgerForms';
import { memberDisplayName } from '../lib/ledgerRules';

/** 가계부 전환 목록에서 들어오는 "새 가계부 만들기" / "초대코드로 참여" 화면. 성공하면 그 가계부로 전환하고 홈으로 */
export function LedgerAddPage({ mode }: { mode: 'create' | 'join' }) {
  const navigate = useNavigate();
  const profile = useMyProfile();
  const displayName = memberDisplayName(profile.name);
  const cancel = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/', { replace: true });
  };

  return (
    <div className="shell">
      <SubPageTopbar title={mode === 'create' ? '새 가계부 만들기' : '초대코드로 참여'} fallback="/" />
      <main className="content content--no-tabbar start">
        {mode === 'create' ? (
          <CreateLedgerForm displayName={displayName} onCancel={cancel} />
        ) : (
          <JoinCodeForm displayName={displayName} onCancel={cancel} />
        )}
      </main>
    </div>
  );
}
