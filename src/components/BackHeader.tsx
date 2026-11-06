import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';

/** 뒤로 버튼이 있는 제목줄. 앱 안에서 들어왔으면 이전 화면, 주소로 바로 들어왔으면 fallback 으로 */
export function BackHeader({ title, fallback }: { title: string; fallback: string }) {
  const navigate = useNavigate();
  function goBack() {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }
  return (
    <header className="topbar">
      <button type="button" className="icon-button" aria-label="뒤로" onClick={goBack}>
        <Icon name="back" />
      </button>
      <h1 className="topbar__title">{title}</h1>
      <span className="icon-button" aria-hidden="true" />
    </header>
  );
}
