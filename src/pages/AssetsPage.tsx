import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCurrentUser } from '../app/auth';
import { useLedgerId } from '../app/guards';
import { AssetSheet } from '../components/AssetSheet';
import { AssetNotFoundError, createAsset, deleteAsset, listAssets, updateAsset } from '../data/asset';
import { listMembers } from '../data/member';
import type { Asset, Member } from '../data/types';
import { assetKindLabel, formatUpdatedAt, ownerLabel, sortAssets, summarizeAssets, type AssetInput } from '../domain/asset';
import { formatWon } from '../domain/money';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; assets: Asset[]; members: Member[] };

/** 시트 상태: 닫힘 / 추가 / 수정 */
type SheetState = null | { mode: 'create' } | { mode: 'edit'; asset: Asset };

export function AssetsPage() {
  const ledgerId = useLedgerId();
  const user = useCurrentUser();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const retry = useCallback(() => {
    setState({ status: 'loading' });
    reload();
  }, [reload]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  const members = state.status === 'ready' ? state.members : [];
  const assets = state.status === 'ready' ? state.assets : [];
  const summary = useMemo(() => summarizeAssets(assets, members), [assets, members]);
  const totalText = `${formatWon(summary.total)}원`;
  const sorted = useMemo(() => sortAssets(assets), [assets]);
  const myMemberId = members.find((m) => m.user_id === user.id && !m.left_at)?.id ?? null;

  const closeSheet = useCallback(() => setSheet(null), []);

  async function save(input: AssetInput) {
    if (!sheet) return;
    try {
      if (sheet.mode === 'create') await createAsset(ledgerId, input);
      else await updateAsset(sheet.asset.id, input);
      setNotice('저장했어요');
    } catch (e) {
      if (!(e instanceof AssetNotFoundError)) throw e; // 시트가 오류를 보여 준다
      setNotice('다른 멤버가 삭제한 자산이에요');
    }
    setSheet(null);
    reload();
  }

  async function remove() {
    if (sheet?.mode !== 'edit') return;
    await deleteAsset(sheet.asset.id);
    setSheet(null);
    setNotice('삭제했어요');
    reload();
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
        <button type="button" className="button button--secondary" onClick={retry}>
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="assets">
      <section className="asset-total" aria-labelledby="asset-total-label">
        <p id="asset-total-label" className="asset-total__label">
          전체 자산
        </p>
        <p className={`asset-total__total${totalText.length > 18 ? ' asset-total__total--long' : ''}`}>{totalText}</p>
        <ul className="owner-totals" aria-label="소유자별 합계">
          {summary.byOwner.map((o) => (
            <li key={o.ownerId ?? 'shared'} className="owner-totals__row">
              <span className="owner-totals__name">{o.label}</span>
              <span className="owner-totals__value">{formatWon(o.total)}원</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="section-head">
        <h2 className="section-head__title">자산 목록</h2>
        <button type="button" className="button button--primary button--small" onClick={() => setSheet({ mode: 'create' })}>
          + 자산 추가
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="empty">
          <p className="empty__title">아직 등록한 자산이 없어요</p>
          <p className="hint">통장·적금·현금 등의 잔액을 적어 두면 함께 볼 수 있어요.</p>
        </div>
      ) : (
        <ul className="asset-list">
          {sorted.map((a) => (
            <li key={a.id}>
              <button type="button" className="asset-row" onClick={() => setSheet({ mode: 'edit', asset: a })}>
                <span className="asset-row__main">
                  <span className="asset-row__name">{a.name}</span>
                  <span className="asset-row__meta">
                    {assetKindLabel(a.kind)} · {ownerLabel(a.owner_id, members)}
                  </span>
                </span>
                <span className="asset-row__side">
                  <span className="asset-row__balance">{formatWon(a.balance)}원</span>
                  <span className="asset-row__meta">{formatUpdatedAt(a.updated_at)} 수정</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="toast" role="status" aria-live="polite">
        {notice}
      </p>

      {sheet && (
        <AssetSheet
          asset={sheet.mode === 'edit' ? sheet.asset : null}
          members={members}
          defaultOwnerId={myMemberId}
          onSave={save}
          onDelete={remove}
          onClose={closeSheet}
        />
      )}
    </div>
  );
}
