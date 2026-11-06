import { Link, useNavigate } from 'react-router-dom';
import { useLedgerId } from '../app/guards';
import { CATEGORY_SETTINGS_PATH, LEDGER_NAME_PATH, MEMBERS_PATH, POCKET_SETTINGS_PATH } from '../app/routes';
import { useLoad } from '../app/useLoad';
import { useMyProfile } from '../app/useProfile';
import { getLedger } from '../data/ledger';
import { useSignOut } from '../app/useSignOut';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';

/** 앱 안에서 들어왔으면 이전 화면, 주소로 바로 들어왔으면 홈으로 */
function goBack(navigate: ReturnType<typeof useNavigate>) {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx > 0) navigate(-1);
  else navigate('/', { replace: true });
}

export function SettingsPage() {
  const navigate = useNavigate();
  const profile = useMyProfile();
  const logout = useSignOut();
  const ledgerId = useLedgerId();
  const ledger = useLoad(() => getLedger(ledgerId), [ledgerId]);
  const ledgerName = ledger.state.status === 'ready' ? ledger.state.data.name : null;

  return (
    <div className="shell">
      <header className="topbar">
        <button type="button" className="icon-button" aria-label="뒤로" onClick={() => goBack(navigate)}>
          <Icon name="back" />
        </button>
        <h1 className="topbar__title">설정</h1>
        <span className="icon-button" aria-hidden="true" />
      </header>
      <main className="content content--no-tabbar settings">
        <section className="profile-card" aria-label="내 계정">
          <Avatar name={profile.name} src={profile.avatarUrl} />
          <div>
            <p className="profile-card__name">{profile.name}</p>
            {profile.email && <p className="profile-card__sub">{profile.email}</p>}
          </div>
        </section>

        <nav aria-label="가계부 설정">
          <h2 className="section-title">가계부 설정</h2>
          <ul className="menu-list">
            <li>
              <Link to={LEDGER_NAME_PATH} className="menu-list__item">
                <span>가계부 이름</span>
                <span className="menu-list__value">
                  {ledgerName ?? (ledger.state.status === 'error' ? '불러오지 못했어요' : '불러오는 중…')}
                </span>
              </Link>
            </li>
            <li>
              <Link to={MEMBERS_PATH} className="menu-list__item">
                <span>멤버·초대</span>
              </Link>
            </li>
            <li>
              <Link to={CATEGORY_SETTINGS_PATH} className="menu-list__item">
                <span>카테고리 관리</span>
              </Link>
            </li>
            <li>
              <Link to={POCKET_SETTINGS_PATH} className="menu-list__item">
                <span>주머니 관리</span>
              </Link>
            </li>
          </ul>
        </nav>

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
