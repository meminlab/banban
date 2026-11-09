import { CircleCheck } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SETTINGS_PATH } from '../../app/routes';
import { useTheme } from '../../app/theme';
import { BackHeader } from '../../components/BackHeader';
import { DEFAULT_THEME, THEME_DESCRIPTION, THEME_LABEL, THEMES, type ThemeName } from '../../domain/theme';

const SAVED = '테마를 바꿨어요';
const FAILED = '테마를 저장하지 못했어요. 다시 시도해 주세요';

/** 설정 > 화면 테마 (design.md 5.16). 누르면 바로 적용·저장, 저장 버튼 없음 */
export function ThemeSettingsPage() {
  const { theme, select } = useTheme();
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cards = useRef<Partial<Record<ThemeName, HTMLButtonElement | null>>>({});

  useEffect(() => () => clearTimeout(timer.current), []);

  async function choose(t: ThemeName) {
    const result = await select(t);
    if (result !== 'saved' && result !== 'failed') return;
    setToast(result === 'saved' ? SAVED : FAILED);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), result === 'saved' ? 2000 : 4000);
  }

  // 라디오 그룹 키보드: 화살표로 옮기면 그 테마를 고른다
  function onKeyDown(e: KeyboardEvent, t: ThemeName) {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = THEMES[(THEMES.indexOf(t) + step + THEMES.length) % THEMES.length];
    cards.current[next]?.focus();
    void choose(next);
  }

  return (
    <div className="shell">
      <BackHeader title="화면 테마" fallback={SETTINGS_PATH} />
      <main className="content content--no-tabbar theme-settings">
        <div role="radiogroup" aria-label="화면 테마" className="theme-list">
          {THEMES.map((t) => {
            const checked = t === theme;
            return (
              <button
                key={t}
                ref={(el) => {
                  cards.current[t] = el;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                className={`theme-card${checked ? ' theme-card--on' : ''}`}
                onClick={() => void choose(t)}
                onKeyDown={(e) => onKeyDown(e, t)}
              >
                {/* 미리보기: 그 테마의 bg·hero-bg·primary (토큰을 data-theme 으로 끌어온다) */}
                <span className="theme-card__preview" data-theme={t} aria-hidden="true">
                  <i className="theme-card__hero" />
                  <i className="theme-card__bar" />
                  <i className="theme-card__bar theme-card__bar--weak" />
                </span>
                <span className="theme-card__text">
                  <span className="theme-card__name">
                    {THEME_LABEL[t]}
                    {t === DEFAULT_THEME && <span className="badge badge--primary">기본</span>}
                  </span>
                  <span className="theme-card__desc">{THEME_DESCRIPTION[t]}</span>
                </span>
                {checked && <CircleCheck className="theme-card__check" size={24} strokeWidth={2} aria-hidden="true" focusable="false" />}
              </button>
            );
          })}
        </div>
        <p className="hint">
          누르면 바로 바뀌어요. 테마는 나에게만 적용되고, 함께 쓰는 사람의 화면은 그대로예요. 밝기(다크 모드)는 기기 설정을 따라요.
        </p>
        <p className="toast toast--no-tabbar" role="status" aria-live="polite">
          {toast}
        </p>
      </main>
    </div>
  );
}
