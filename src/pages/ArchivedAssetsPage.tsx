import { useCallback, useEffect, useState } from 'react';
import { useLedgerId } from '../app/guards';
import { ASSETS_PATH } from '../app/routes';
import { AssetKindIcon } from '../components/AssetKindIcon';
import { BackHeader } from '../components/BackHeader';
import { StatusScreen } from '../components/StatusScreen';
import { AssetNotFoundError, listAssets, restoreAsset } from '../data/asset';
import { listMembers } from '../data/member';
import type { Asset, Member } from '../data/types';
import { assetKindLabel, formatDateKST, ownerLabel, quoteWithObject } from '../domain/asset';
import { formatWon } from '../domain/money';

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; assets: Asset[]; members: Member[] };

/** 보관한 자산 목록 · 되살리기 (design.md 5.22) */
export function ArchivedAssetsPage() {
  const ledgerId = useLedgerId();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([listAssets(ledgerId), listMembers(ledgerId)]).then(
      ([assets, members]) => alive && setState({ status: 'ready', assets, members }),
      () => alive && setState({ status: 'error' }),
    );
    return () => {
      alive = false;
    };
  }, [ledgerId, attempt]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  async function restore(a: Asset) {
    setBusyId(a.id);
    try {
      await restoreAsset(a.id);
      setNotice({ text: `${quoteWithObject(a.name)} 되살렸어요` });
    } catch (e) {
      setNotice(
        e instanceof AssetNotFoundError
          ? { text: '찾을 수 없는 자산이에요', error: true }
          : { text: '되살리지 못했어요. 다시 시도해 주세요.', error: true },
      );
    }
    setBusyId(null);
    reload();
  }

  if (state.status === 'loading') return <StatusScreen kind="loading" message="보관한 자산을 불러오고 있어요" />;
  if (state.status === 'error')
    return (
      <StatusScreen
        kind="error"
        message="보관한 자산을 불러오지 못했어요. 네트워크를 확인해 주세요."
        onRetry={() => {
          setState({ status: 'loading' });
          reload();
        }}
      />
    );

  const archived = state.assets
    .filter((a) => a.archived_at !== null)
    .sort((a, b) => (b.archived_at ?? '').localeCompare(a.archived_at ?? ''));

  return (
    <div className="shell">
      <BackHeader title="보관한 자산" fallback={ASSETS_PATH} />
      <main className="content content--no-tabbar assets">
        {archived.length === 0 ? (
          <p className="status-text">보관한 자산이 없어요</p>
        ) : (
          <section className="asset-card">
          <ul className="asset-items" aria-label="보관한 자산">
            {archived.map((a) => (
              <li key={a.id} className="asset-item asset-item--archived">
                <span className="asset-item__icon" aria-hidden="true">
                  <AssetKindIcon kind={a.kind} />
                </span>
                <span className="asset-item__main">
                  <span className="asset-item__name">{a.name}</span>
                  <span className="asset-item__sub">
                    {assetKindLabel(a.kind)} · {ownerLabel(a.owner_id, state.members)} · {formatDateKST(a.archived_at!)} 보관
                  </span>
                </span>
                <span className="asset-item__side">
                  <span className="asset-item__amount money asset-item__amount--muted">{formatWon(a.balance)}원</span>
                  <button
                    type="button"
                    className="button button--text asset-item__restore"
                    aria-label={`${a.name} 되살리기`}
                    onClick={() => restore(a)}
                    disabled={busyId !== null}
                  >
                    {busyId === a.id ? '되살리는 중…' : '되살리기'}
                  </button>
                </span>
              </li>
            ))}
          </ul>
          </section>
        )}
        <p className="hint">보관한 자산은 합계에 들어가지 않아요. 보관하기 전 달까지의 추이에는 남아 있어요.</p>
      </main>
      <p className="toast toast--no-tabbar" role={notice?.error ? 'alert' : 'status'} aria-live="polite">
        {notice?.text}
      </p>
    </div>
  );
}
