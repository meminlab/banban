import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { SETTINGS_PATH, TABS } from '../app/routes';
import { Icon } from './Icon';

/** 탭 화면 공통 틀: 위 제목줄(오른쪽 설정) + 본문 + 하단 탭 */
export function AppLayout() {
  const { pathname } = useLocation();
  const current = TABS.find((t) => t.path === pathname) ?? TABS[0];

  return (
    <div className="shell">
      <header className="topbar">
        <h1 className="topbar__title">{current.label}</h1>
        <Link to={SETTINGS_PATH} className="icon-button" aria-label="설정">
          <Icon name="settings" />
        </Link>
      </header>

      <main className="content">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="주요 메뉴">
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end
            className={({ isActive }) => `tabbar__item${isActive ? ' is-active' : ''}`}
          >
            <Icon name={tab.icon} />
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
