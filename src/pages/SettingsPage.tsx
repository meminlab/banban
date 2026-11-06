import { useNavigate } from 'react-router-dom';
import { useMyProfile } from '../app/useProfile';
import { useSignOut } from '../app/useSignOut';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Placeholder } from '../components/Placeholder';

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

        <Placeholder
          title="가계부 설정"
          description="가계부 이름, 멤버·초대, 카테고리, 주머니가 여기에 들어옵니다. (준비 중)"
        />

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
