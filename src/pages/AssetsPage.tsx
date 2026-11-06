import { Archive, CalendarCheck, ChevronRight, Clock, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLedgerId } from '../app/guards';
import { ASSET_NEW_PATH, ASSETS_ARCHIVED_PATH, assetPath, type AssetFlash } from '../app/routes';
import { AssetKindIcon } from '../components/AssetKindIcon';
import { Delta, signedWon } from '../components/NetWorthDelta';
import { NetWorthTrend } from '../components/NetWorthTrend';
import { listAssets, listBalanceHistory, restoreAsset } from '../data/asset';
import { listMembers } from '../data/member';
import type { Asset, AssetBalanceHistory, Member } from '../data/types';
import {
  assetKindLabel,
  ownerLabel,
  ownerOptions,
  quoteWithObject,
  sortAssets,
  updatedAgo,
  type OwnerOption,
} from '../domain/asset';
import { formatWon } from '../domain/money';
import { currentYearMonth } from '../domain/month';
import {
  composition,
  currentNetWorth,
  filterByOwner,
  isActive,
  isLiability,
  needsMonthlyCheck,
  netWorthChange,
  netWorthTrend,
  type OwnerView,
} from '../domain/netWorth';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; assets: Asset[]; history: AssetBalanceHistory[]; members: Member[] };

type Notice = { text: string; undo?: () => void } | null;

const FLASH_TEXT: Record<Exclude<AssetFlash['kind'], 'archived'>, string> = {
  saved: '저장했어요',
  gone: '찾을 수 없는 자산이에요',
};

/** 월초 안내 닫기: 기기별, 가계부·달마다 (명세 보강 Q12) */
const promptKey = (ledgerId: string, ym: string) => `banban:asset-month-check:${ledgerId}:${ym}`;
function readDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** 자산 탭: 보기 전환 · 월초 안내 · 순자산 · 월별 추이 · 자산 구성 · 자산/부채 목록 · 보관한 자산 (design.md 5.22) */
export function AssetsPage() {
  const ledgerId = useLedgerId();
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<'all' | 'person'>('all');
  const [owner, setOwner] = useState<string | null | undefined>(undefined); // 사람별에서 고른 칩 (undefined = 첫 칩)
  const [notice, setNotice] = useState<Notice>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const ym = currentYearMonth();
  const [dismissed, setDismissed] = useState(() => readDismissed(promptKey(ledgerId, ym)));

  useEffect(() => {
    let alive = true;
    Promise.all([listAssets(ledgerId), listBalanceHistory(ledgerId), listMembers(ledgerId)]).then(
      ([assets, history, members]) => alive && setState({ status: 'ready', assets, history, members }),
      () => alive && setState({ status: 'error' }),
    );
    return () => {
      alive = false;
    };
  }, [ledgerId, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  // 추가·수정·보관 화면에서 돌아올 때의 결과 → 토스트 (한 번만)
  useEffect(() => {
    const flash = (location.state as { flash?: AssetFlash } | null)?.flash;
    if (!flash) return;
    navigate('.', { replace: true, state: null });
    if (flash.kind === 'archived') {
      setNotice({
        text: `${quoteWithObject(flash.name)} 보관했어요`,
        undo: () => {
          setNotice(null);
          restoreAsset(flash.id).then(
            () => {
              setNotice({ text: `${quoteWithObject(flash.name)} 되살렸어요` });
              reload();
            },
            () => setNotice({ text: '되살리지 못했어요. 보관한 자산에서 다시 시도해 주세요.' }),
          );
        },
      });
    } else {
      setNotice({ text: FLASH_TEXT[flash.kind] });
    }
  }, [location.state, navigate, reload]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.undo ? 5000 : 3000);
    return () => clearTimeout(t);
  }, [notice]);

  const members = state.status === 'ready' ? state.members : [];
  const assets = state.status === 'ready' ? state.assets : [];
  const history = state.status === 'ready' ? state.history : [];

  const options = useMemo(() => ownerOptions(assets, members), [assets, members]);
  const selected: OwnerOption | null = mode === 'person' ? (options.find((o) => o.ownerId === owner) ?? options[0]) : null;
  const view: OwnerView = selected ? selected.ownerId : 'all';
  const viewAssets = useMemo(() => filterByOwner(assets, view), [assets, view]);
  const active = useMemo(() => viewAssets.filter(isActive), [viewAssets]);
  const archivedCount = assets.filter((a) => !isActive(a)).length;
  const anyActive = assets.some(isActive);
  const showPrompt = anyActive && !dismissed && needsMonthlyCheck(history);

  function dismissPrompt() {
    try {
      localStorage.setItem(promptKey(ledgerId, ym), '1');
    } catch {
      /* 저장소를 못 쓰면 이번 화면에서만 닫는다 */
    }
    setDismissed(true);
  }

  if (state.status === 'loading') {
    return (
      <div className="page-status" role="status">
        <span className="spinner" aria-hidden="true" />
        <p>자산을 불러오고 있어요</p>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="page-status" role="alert">
        <p>자산을 불러오지 못했어요. 네트워크를 확인해 주세요.</p>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => {
            setState({ status: 'loading' });
            reload();
          }}
        >
          다시 시도
        </button>
      </div>
    );
  }

  const monthNo = Number(ym.slice(5));
  const personName = selected ? (selected.ownerId === null ? null : selected.label) : null;

  return (
    <div className="assets">
      <section className="asset-card asset-view" aria-label="보기">
        <div className="segmented segmented--two" role="radiogroup" aria-label="보기 전환">
          {(
            [
              ['all', '합친'],
              ['person', '사람별'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className={`segmented__item${mode === value ? ' is-selected' : ''}`}>
              <input type="radio" name="asset-view" checked={mode === value} onChange={() => setMode(value)} />
              {label}
            </label>
          ))}
        </div>
        {mode === 'person' && (
          <div className="owner-chips" role="radiogroup" aria-label="누구 것">
            {options.map((o) => (
              <label key={o.ownerId ?? 'shared'} className="chip">
                <input
                  type="radio"
                  name="asset-owner"
                  checked={selected?.ownerId === o.ownerId}
                  onChange={(e) => {
                    setOwner(o.ownerId);
                    e.currentTarget.closest('label')?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
                  }}
                />
                <span>
                  {o.label}
                  {o.left && <span className="chip__weak"> (나감)</span>}
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      {showPrompt && (
        <div className="month-check">
          <button
            type="button"
            className="month-check__body"
            onClick={() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            <CalendarCheck size={20} aria-hidden="true" />
            <span>
              <span className="month-check__title">이번 달 잔액 확인하기</span>
              <span className="month-check__desc">{monthNo}월에 아직 잔액을 고치지 않았어요</span>
            </span>
          </button>
          <button type="button" className="icon-button" aria-label="이번 달 잔액 확인 안내 닫기" onClick={dismissPrompt}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
      )}

      {active.length === 0 ? (
        <section className="asset-card asset-empty">
          <span className="asset-empty__icon" aria-hidden="true">
            <AssetKindIcon kind="loan" size={28} />
          </span>
          <p className="asset-empty__title">{selected ? '등록한 자산이 없어요' : '아직 등록한 자산이 없어요'}</p>
          <p className="hint">
            {selected
              ? `${personName ?? '공동'} 이름으로 등록한 자산이 없어요`
              : '통장·적금 잔액과 대출을 적어 두면 우리집 순자산을 한눈에 볼 수 있어요'}
          </p>
          {!selected && (
            <Link to={ASSET_NEW_PATH} className="button button--primary">
              자산 추가
            </Link>
          )}
        </section>
      ) : (
        <>
          <NetWorthCard
            label={selected ? (personName ? `${personName}의 순자산` : '공동 순자산') : '순자산'}
            assets={viewAssets}
            history={history}
            ym={ym}
          />
          {/* 보기(합친/칩)가 바뀌면 선택한 달을 이번 달로 되돌린다 */}
          <NetWorthTrend key={`${mode}:${view ?? 'shared'}`} points={netWorthTrend(viewAssets, history)} />
          <CompositionCard assets={active} />
          <div ref={listRef} className="asset-lists">
            <div className="section-head">
              <h2 className="section-head__title">목록</h2>
              <Link to={ASSET_NEW_PATH} className="button button--primary button--small">
                <Plus size={16} aria-hidden="true" />
                자산 추가
              </Link>
            </div>
            <AssetGroupList title="자산" items={active.filter((a) => !isLiability(a.kind))} members={members} />
            <AssetGroupList title="부채" items={active.filter((a) => isLiability(a.kind))} members={members} />
          </div>
        </>
      )}

      {archivedCount > 0 && (
        <Link to={ASSETS_ARCHIVED_PATH} className="asset-card archived-link">
          <Archive size={20} aria-hidden="true" />
          <span className="archived-link__label">보관한 자산</span>
          <span className="archived-link__count">{archivedCount}개</span>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      )}

      <div className="toast toast--action" role="status" aria-live="polite">
        {notice && (
          <>
            <span>{notice.text}</span>
            {notice.undo && (
              <button type="button" className="toast__action" onClick={notice.undo}>
                되돌리기
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function NetWorthCard({
  label,
  assets,
  history,
  ym,
}: {
  label: string;
  assets: readonly Asset[];
  history: readonly AssetBalanceHistory[];
  ym: string;
}) {
  const nw = currentNetWorth(assets);
  const delta = netWorthChange(assets, history, ym);
  const netText = `${signedWon(nw.net)}원`;
  return (
    <section className="asset-card net-worth" aria-label={label}>
      <h2 className="net-worth__label">{label}</h2>
      <p
        className={`net-worth__value money${nw.net < 0 ? ' is-negative' : ''}${netText.length >= 14 ? ' net-worth__value--long' : ''}`}
      >
        <span aria-hidden="true">{netText}</span>
        <span className="sr-only">{`${nw.net < 0 ? '마이너스 ' : ''}${formatWon(Math.abs(nw.net))}원`}</span>
      </p>
      <Delta value={delta} label="지난달 말보다" />
      <dl className="net-worth__totals">
        <div>
          <dt>총자산</dt>
          <dd className="money">{formatWon(nw.assets)}원</dd>
        </div>
        <div>
          <dt>총부채</dt>
          <dd className="money">{formatWon(nw.liabilities)}원</dd>
        </div>
      </dl>
    </section>
  );
}

function CompositionCard({ assets }: { assets: readonly Asset[] }) {
  const c = composition(assets);
  return (
    <section className="asset-card composition" aria-labelledby="composition-title">
      <div className="card-head">
        <h2 id="composition-title" className="card-head__title">
          자산 구성
        </h2>
        <span className="card-head__sub">총자산 기준</span>
      </div>
      {c.assets.length === 0 ? (
        <p className="hint">총자산이 0원이라 비율을 표시하지 않아요</p>
      ) : (
        <ul className="composition__list">
          {c.assets.map((r) => (
            <li key={r.kind} className="composition__row">
              <span className="composition__icon" aria-hidden="true">
                <AssetKindIcon kind={r.kind} size={18} />
              </span>
              <span className="composition__name">{assetKindLabel(r.kind)}</span>
              <span className="composition__amount money">{formatWon(r.amount)}원</span>
              {r.percent !== null && <span className="composition__pct">{r.percent}%</span>}
              {r.percent !== null && (
                <span className="composition__bar" aria-hidden="true">
                  <span style={{ width: `${Math.max(1, r.percent)}%` }} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {c.liabilities.length > 0 && (
        <>
          <div className="card-head composition__debt-head">
            <h3 className="card-head__title card-head__title--small">부채</h3>
            <span className="card-head__sub">종류별 합계</span>
          </div>
          <ul className="composition__list">
            {c.liabilities.map((r) => (
              <li key={r.kind} className="composition__row composition__row--debt">
                <span className="composition__icon" aria-hidden="true">
                  <AssetKindIcon kind={r.kind} size={18} />
                </span>
                <span className="composition__name">{assetKindLabel(r.kind)}</span>
                <span className="composition__amount money">{formatWon(r.amount)}원</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function AssetGroupList({ title, items, members }: { title: string; items: readonly Asset[]; members: readonly Member[] }) {
  if (items.length === 0) return null; // 부채가 0개면 부채 카드를 숨긴다 (자산 0개·부채만 있을 때도 같은 규칙)
  const total = items.reduce((s, a) => s + a.balance, 0);
  const headId = `asset-group-${title}`;
  return (
    <section className="asset-card" aria-labelledby={headId}>
      <div className="card-head">
        <h3 id={headId} className="card-head__title">
          {title} <span className="card-head__count">{items.length}개</span>
        </h3>
        <span className="card-head__total money">{formatWon(total)}원</span>
      </div>
      <ul className="asset-items">
        {sortAssets(items).map((a) => {
          const ago = updatedAgo(a.updated_at);
          return (
            <li key={a.id}>
              <Link to={assetPath(a.id)} className="asset-item">
                <span className="asset-item__icon" aria-hidden="true">
                  <AssetKindIcon kind={a.kind} />
                </span>
                <span className="asset-item__main">
                  <span className="asset-item__name">{a.name}</span>
                  <span className="asset-item__sub">
                    {assetKindLabel(a.kind)} · {ownerLabel(a.owner_id, members)}
                  </span>
                </span>
                <span className="asset-item__side">
                  <span className="asset-item__amount money">{formatWon(a.balance)}원</span>
                  {ago.stale ? (
                    <span className="asset-item__ago asset-item__ago--stale">
                      <Clock size={12} aria-hidden="true" />
                      {ago.text}
                    </span>
                  ) : (
                    <span className="asset-item__ago">{ago.text}</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
