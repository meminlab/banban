import { useMyProfile } from '../app/useProfile';
import { useSignOut } from '../app/useSignOut';
import { Avatar } from '../components/Avatar';

/** 참여한 가계부가 없을 때. 가계부 만들기·초대코드 입력은 다음 이슈(BANB-5)에서 연결 */
export function StartPage() {
  const profile = useMyProfile();
  const logout = useSignOut();

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

        <div className="start__options">
          <button type="button" className="option-card" disabled aria-describedby="start-soon">
            <span className="option-card__title">가계부 만들기</span>
            <span className="option-card__desc">새 가계부를 만들고 함께 쓸 사람을 초대해요</span>
          </button>
          <button type="button" className="option-card" disabled aria-describedby="start-soon">
            <span className="option-card__title">초대코드 입력</span>
            <span className="option-card__desc">받은 8자리 코드로 가계부에 참여해요</span>
          </button>
          <p id="start-soon" className="hint">준비 중이에요. 곧 열려요.</p>
        </div>

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
