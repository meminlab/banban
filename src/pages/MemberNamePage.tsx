import { useCurrentUser } from '../app/auth';
import { useLedgerId } from '../app/guards';
import { SETTINGS_PATH } from '../app/routes';
import { useLoad } from '../app/useLoad';
import { RenameForm } from '../components/RenameForm';
import { StatusScreen } from '../components/StatusScreen';
import { SubPageTopbar } from '../components/SubPageTopbar';
import { getMyMemberName, renameMyMember } from '../data/member';
import { MEMBER_NAME_MAX, validateMemberName } from '../lib/ledgerRules';

/** 설정 > 내 이름 (BANB-45): 지금 보는 가계부에서만 쓰는 내 이름. 다른 가계부의 내 이름은 그대로 */
export function MemberNamePage() {
  const ledgerId = useLedgerId();
  const user = useCurrentUser();
  const mine = useLoad(() => getMyMemberName(ledgerId, user.id), [ledgerId, user.id]);

  if (mine.state.status === 'loading') return <StatusScreen kind="loading" message="내 이름을 불러오고 있어요" />;
  if (mine.state.status === 'error' || mine.state.data === null)
    return <StatusScreen kind="error" message="내 이름을 불러오지 못했어요. 네트워크를 확인해 주세요." onRetry={mine.reload} />;

  return (
    <div className="shell">
      <SubPageTopbar title="내 이름" fallback={SETTINGS_PATH} />
      <main className="content content--no-tabbar">
        <RenameForm
          label="내 이름"
          initial={mine.state.data}
          hint={`${MEMBER_NAME_MAX}자까지. 이 가계부에서만 바뀌고, 함께 쓰는 사람에게 이 이름으로 보여요.`}
          validate={validateMemberName}
          save={(name) => renameMyMember(ledgerId, user.id, name)}
        />
      </main>
    </div>
  );
}
