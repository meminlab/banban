import { useCallback, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { SETTINGS_PATH, TABS, TRANSACTION_NEW_PATH, type TransactionFormState } from '../app/routes';
import { Icon } from './Icon';
import { LedgerSwitcher } from './LedgerSwitcher';
import { TxFlashToast } from './TxFlashToast';

type Tab = (typeof TABS)[number];

/**
 * 탭 화면 공통 틀: 위 제목줄(왼쪽 가계부 전환 알약, 오른쪽 설정) + 본문 + 하단 탭.
 * 하단 탭은 홈 · 가계부 · [＋] · 자산 (design.md 5.7). ＋는 탭이 아니라 내역 입력 버튼이고, 모든 탭에서 같은 자리.
 * 탭 이름은 하단 탭에 보이므로 제목은 화면 낭독용.
 */
export function AppLayout() {
  const { pathname, search } = useLocation();
  const current = TABS.find((t) => t.path === pathname) ?? TABS[0];
  // 입력 화면을 닫으면 지금 보던 탭(가계부 탭은 보던 달·보기·필터까지)으로 돌아온다
  const addState: TransactionFormState = { returnTo: `${pathname}${search}` };
  // 저장 되돌리기 후 지금 탭을 새로 불러온다 (본문을 다시 그림)
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const tabLink = (tab: Tab) => (
    <NavLink
      key={tab.path}
      to={tab.path}
      end
      className={({ isActive }) => `tabbar__item${isActive ? ' is-active' : ''}`}
    >
      <span className="tabbar__icon">
        <Icon name={tab.icon} />
      </span>
      <span>{tab.label}</span>
    </NavLink>
  );

  return (
    <div className="shell shell--tabs">
      <header className="topbar">
        <h1 className="sr-only">{current.label}</h1>
        <LedgerSwitcher />
        <Link to={SETTINGS_PATH} className="icon-button" aria-label="설정">
          <Icon name="settings" />
        </Link>
      </header>

      <main className="content">
        <Outlet key={reloadKey} />
      </main>
      <TxFlashToast onUndone={reload} />

      <nav className="tabbar" aria-label="주요 메뉴">
        {TABS.slice(0, 2).map(tabLink)}
        <Link to={TRANSACTION_NEW_PATH} state={addState} className="tabbar__add" aria-label="내역 추가">
          <Icon name="add" size={26} />
        </Link>
        {TABS.slice(2).map(tabLink)}
      </nav>
    </div>
  );
}

