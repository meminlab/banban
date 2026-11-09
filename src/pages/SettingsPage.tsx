import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLedgerId } from '../app/guards';
import { ChevronRight, Palette, Pencil, Tag, User, Users, Wallet, type LucideIcon } from 'lucide-react';
import {
  CATEGORY_SETTINGS_PATH,
  LEDGER_NAME_PATH,
  MEMBERS_PATH,
  MY_NAME_PATH,
  POCKET_SETTINGS_PATH,
  THEME_SETTINGS_PATH,
} from '../app/routes';
import { useTheme } from '../app/theme';
import { THEME_LABEL } from '../domain/theme';
import { useLoad, type LoadState } from '../app/useLoad';
import { useMyProfile } from '../app/useProfile';
import { getLedger } from '../data/ledger';
import { getMyMemberName } from '../data/member';
import { useCurrentUser } from '../app/auth';
import { useSignOut } from '../app/useSignOut';
import { Icon } from '../components/Icon';

/** 앱 안에서 들어왔으면 이전 화면, 주소로 바로 들어왔으면 홈으로 */
function goBack(navigate: ReturnType<typeof useNavigate>) {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx > 0) navigate(-1);
  else navigate('/', { replace: true });
}

/** 메뉴 행 (design.md 5.3 v1.4): 아이콘 20 + 이름 16 / 값(이름·테마처럼 값 자체가 설정일 때만) 15 + ChevronRight */
function MenuRow({ to, icon: Svg, label, value }: { to: string; icon: LucideIcon; label: string; value?: ReactNode }) {
  return (
    <li>
      <Link to={to} className="menu-list__item">
        <span className="menu-list__label">
          <Svg size={20} strokeWidth={2} aria-hidden="true" focusable="false" />
          {label}
        </span>
        {value != null && <span className="menu-list__value">{value}</span>}
        <ChevronRight className="menu-list__chevron" size={20} strokeWidth={2} aria-hidden="true" focusable="false" />
      </Link>
    </li>
  );
}

/** 메뉴 행 값: 불러온 값 / 불러오는 중 / 실패 */
function menuValue(status: LoadState<unknown>['status'], value: string | null): string {
  if (value != null) return value;
  return status === 'loading' ? '불러오는 중…' : '불러오지 못했어요';
}

/**
 * 설정 (design.md 5.23 v1.4): 묶음 제목 없이 여백으로만 3묶음을 나눈다.
 * ① 지금 보는 가계부 ② 내 설정 ③ 계정(메일 + 글자 버튼 "로그아웃")
 */
export function SettingsPage() {
  const navigate = useNavigate();
  const profile = useMyProfile();
  const logout = useSignOut();
  const ledgerId = useLedgerId();
  const ledger = useLoad(() => getLedger(ledgerId), [ledgerId]);
  const { theme } = useTheme();
  const ledgerName = ledger.state.status === 'ready' ? ledger.state.data.name : null;
  const user = useCurrentUser();
  const myName = useLoad(() => getMyMemberName(ledgerId, user.id), [ledgerId, user.id]);
  const myNameValue = myName.state.status === 'ready' ? myName.state.data : null;

  return (
    <div className="shell shell--settings">
      <header className="topbar">
        <button type="button" className="icon-button" aria-label="뒤로" onClick={() => goBack(navigate)}>
          <Icon name="back" />
        </button>
        <h1 className="topbar__title">설정</h1>
        <span className="icon-button" aria-hidden="true" />
      </header>
      <main className="content content--no-tabbar settings">
        <nav aria-label="지금 보는 가계부 설정">
          <ul className="menu-list">
            <MenuRow
              to={LEDGER_NAME_PATH}
              icon={Pencil}
              label="가계부 이름"
              value={menuValue(ledger.state.status, ledgerName)}
            />
            <MenuRow
              to={MY_NAME_PATH}
              icon={User}
              label="내 이름"
              value={menuValue(myName.state.status, myNameValue)}
            />
            <MenuRow to={MEMBERS_PATH} icon={Users} label="멤버·초대" />
            <MenuRow to={CATEGORY_SETTINGS_PATH} icon={Tag} label="카테고리" />
            <MenuRow to={POCKET_SETTINGS_PATH} icon={Wallet} label="주머니" />
          </ul>
        </nav>

        <nav aria-label="내 설정">
          <ul className="menu-list">
            <MenuRow to={THEME_SETTINGS_PATH} icon={Palette} label="화면 테마" value={THEME_LABEL[theme]} />
          </ul>
        </nav>

        <section className="account-row" aria-label="계정">
          <p className="account-row__email">{profile.email}</p>
          <button type="button" className="account-row__logout" onClick={logout.run} disabled={logout.busy}>
            {logout.busy ? '로그아웃하는 중…' : '로그아웃'}
          </button>
        </section>
        {logout.error && (
          <p className="form-error settings__error" role="alert">
            로그아웃하지 못했어요. 다시 시도해 주세요.
          </p>
        )}
      </main>
    </div>
  );
}
