import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';

/** 하위 화면 제목줄: 뒤로(앱 안에서 왔으면 이전 화면, 주소로 바로 왔으면 fallback) + 제목 */
export function SubPageTopbar({ title, fallback }: { title: string; fallback: string }) {
  const navigate = useNavigate();
  function back() {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }
  return (
    <header className="topbar">
      <button type="button" className="icon-button" aria-label="뒤로" onClick={back}>
        <Icon name="back" />
      </button>
      <h1 className="topbar__title">{title}</h1>
      <span className="icon-button" aria-hidden="true" />
    </header>
  );
}
