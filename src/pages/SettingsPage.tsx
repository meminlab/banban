import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLedgerId } from '../app/guards';
import { ChevronRight, HeartHandshake, Palette, Pencil, Tag, Users, Wallet, type LucideIcon } from 'lucide-react';
import { CATEGORY_SETTINGS_PATH, LEDGER_NAME_PATH, MEMBERS_PATH, POCKET_SETTINGS_PATH, THEME_SETTINGS_PATH } from '../app/routes';
import { useTheme } from '../app/theme';
import { THEME_LABEL } from '../domain/theme';
import { useLoad } from '../app/useLoad';
import { useMyProfile } from '../app/useProfile';
import { getLedger, setTogetherSince } from '../data/ledger';
import { Sheet } from '../components/Sheet';
import { todayKST } from '../domain/transactionForm';
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

/** '2021-06-12' → '2021년 6월 12일' */
function formatFullDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

/** 시트를 여는 메뉴 행 (MenuRow 와 같은 모양) */
function MenuButtonRow({ icon: Svg, label, value, onClick }: { icon: LucideIcon; label: string; value: ReactNode; onClick: () => void }) {
  return (
    <li>
      <button type="button" className="menu-list__item menu-list__item--button" aria-haspopup="dialog" onClick={onClick}>
        <span className="menu-list__label">
          <Svg size={20} strokeWidth={2} aria-hidden="true" focusable="false" />
          {label}
        </span>
        <span className="menu-list__value">{value}</span>
        <ChevronRight className="menu-list__chevron" size={20} strokeWidth={2} aria-hidden="true" focusable="false" />
      </button>
    </li>
  );
}

/** 함께한 날 시트 (design.md 5.27): 날짜 1개, 오늘 이후는 고를 수 없음. 값이 있으면 지우기 */
function TogetherSinceSheet({
  initial,
  onSave,
  onClose,
}: {
  initial: string | null;
  onSave: (date: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const id = useId();
  const today = todayKST();
  const [value, setValue] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && value <= today;

  async function save(date: string | null) {
    setBusy(true);
    setError(false);
    try {
      await onSave(date);
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <Sheet title="함께한 날" onClose={onClose}>
      <div className="tx-sheet">
        <p className="together-sheet__desc">
          처음 만난 날, 결혼한 날… 우리가 함께한 첫날을 골라 주세요. 홈에 "함께한 지 N일째예요"로 보여요.
        </p>
        <label className="visually-hidden" htmlFor={`${id}-date`}>
          함께한 날
        </label>
        <input
          id={`${id}-date`}
          className="manage-input"
          type="date"
          min="1900-01-01"
          max={today}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {value > today && <p className="field__error">오늘 이후 날짜는 고를 수 없어요</p>}
        {error && (
          <p className="form-error" role="alert">
            저장하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.
          </p>
        )}
        <div className="sheet__actions">
          {initial && (
            <button type="button" className="button button--secondary" disabled={busy} onClick={() => save(null)}>
              지우기
            </button>
          )}
          <button type="button" className="button button--primary" disabled={busy || !valid} onClick={() => save(value)}>
            {busy ? '저장하는 중…' : '저장'}
          </button>
        </div>
      </div>
    </Sheet>
  );
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
  const togetherSince = ledger.state.status === 'ready' ? ledger.state.data.together_since : null;
  const [togetherOpen, setTogetherOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const closeTogether = useCallback(() => setTogetherOpen(false), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function saveTogether(date: string | null) {
    await setTogetherSince(ledgerId, date);
    if (ledger.state.status === 'ready') ledger.setData({ ...ledger.state.data, together_since: date });
    setTogetherOpen(false);
    setToast(date ? '함께한 날을 저장했어요' : '함께한 날을 지웠어요');
  }

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
              value={ledgerName ?? (ledger.state.status === 'error' ? '불러오지 못했어요' : '불러오는 중…')}
            />
            <MenuButtonRow
              icon={HeartHandshake}
              label="함께한 날"
              value={
                ledger.state.status !== 'ready' ? (
                  ''
                ) : togetherSince ? (
                  formatFullDate(togetherSince)
                ) : (
                  <span className="menu-list__value--weak">정하지 않음</span>
                )
              }
              onClick={() => ledger.state.status === 'ready' && setTogetherOpen(true)}
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
        {togetherOpen && ledger.state.status === 'ready' && (
          <TogetherSinceSheet initial={togetherSince} onSave={saveTogether} onClose={closeTogether} />
        )}
        <p className="toast" role="status" aria-live="polite">
          {toast}
        </p>
        {logout.error && (
          <p className="form-error settings__error" role="alert">
            로그아웃하지 못했어요. 다시 시도해 주세요.
          </p>
        )}
      </main>
    </div>
  );
}
