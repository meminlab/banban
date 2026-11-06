import { useNavigate } from 'react-router-dom';
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
  return (
    <div className="shell">
      <header className="topbar">
        <button type="button" className="icon-button" aria-label="뒤로" onClick={() => goBack(navigate)}>
          <Icon name="back" />
        </button>
        <h1 className="topbar__title">설정</h1>
        <span className="icon-button" aria-hidden="true" />
      </header>
      <main className="content">
        <Placeholder
          title="설정"
          description="가계부 이름, 멤버·초대, 카테고리, 주머니, 로그아웃이 여기에 들어옵니다. (준비 중)"
        />
      </main>
    </div>
  );
}
