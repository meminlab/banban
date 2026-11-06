import { Archive } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCurrentUser } from '../app/auth';
import { useLedgerId } from '../app/guards';
import { ASSETS_PATH, type AssetFlash } from '../app/routes';
import { AssetKindIcon } from '../components/AssetKindIcon';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { StatusScreen } from '../components/StatusScreen';
import { AssetNotFoundError, archiveAsset, createAsset, getAsset, updateAsset } from '../data/asset';
import { listMembers } from '../data/member';
import type { Asset, Member } from '../data/types';
import {
  ASSET_KINDS,
  ASSET_MEMO_MAX,
  ASSET_NAME_MAX,
  SHARED_OWNER_LABEL,
  ownerLabel,
  quoteWithObject,
  validateAssetForm,
  type AssetFormErrors,
  type AssetFormValues,
} from '../domain/asset';
import { formatWon, formatWonInput } from '../domain/money';
import { isLiability } from '../domain/netWorth';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'notFound' }
  | { status: 'ready'; asset: Asset | null; members: Member[]; myMemberId: string | null };

/** 자산 추가(/assets/new) · 수정(/assets/:assetId). 삭제 대신 보관 (design.md 5.22 "자산 입력·수정") */
export function AssetFormPage() {
  const ledgerId = useLedgerId();
  const user = useCurrentUser();
  const { assetId } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    Promise.all([listMembers(ledgerId), assetId ? getAsset(assetId) : null]).then(
      ([members, asset]) => {
        if (!alive) return;
        // 다른 가계부의 자산이거나 보관된 자산이면 수정 화면을 열지 않는다
        if (assetId && (!asset || asset.ledger_id !== ledgerId || asset.archived_at)) return setState({ status: 'notFound' });
        const me = members.find((m) => m.user_id === user.id && !m.left_at)?.id ?? null;
        setState({ status: 'ready', asset, members, myMemberId: me });
      },
      () => alive && setState({ status: 'error' }),
    );
    return () => {
      alive = false;
    };
  }, [ledgerId, assetId, user.id, attempt]);

  const close = useCallback(
    (flash?: AssetFlash) => navigate(ASSETS_PATH, { replace: true, state: flash ? { flash } : undefined }),
    [navigate],
  );
  const title = assetId ? '자산 수정' : '자산 추가';

  if (state.status === 'loading') return <StatusScreen kind="loading" message="자산을 불러오고 있어요" />;
  if (state.status === 'error')
    return (
      <StatusScreen
        kind="error"
        message="자산을 불러오지 못했어요. 네트워크를 확인해 주세요."
        onRetry={() => setAttempt((n) => n + 1)}
      />
    );

  return (
    <div className="shell">
      <header className="topbar">
        <button type="button" className="icon-button" aria-label="닫기" onClick={() => close()}>
          <Icon name="back" />
        </button>
        <h1 className="topbar__title">{title}</h1>
        <span className="icon-button" aria-hidden="true" />
      </header>
      {state.status === 'notFound' ? (
        <main className="content content--no-tabbar">
          <p className="status-text" role="alert">
            보관했거나 찾을 수 없는 자산이에요.
          </p>
          <button type="button" className="button button--secondary button--block" onClick={() => close()}>
            자산 목록으로
          </button>
        </main>
      ) : (
        <AssetForm
          ledgerId={ledgerId}
          asset={state.asset}
          members={state.members}
          defaultOwnerId={state.myMemberId}
          onClose={close}
        />
      )}
    </div>
  );
}

function AssetForm({
  ledgerId,
  asset,
  members,
  defaultOwnerId,
  onClose,
}: {
  ledgerId: string;
  asset: Asset | null;
  members: readonly Member[];
  defaultOwnerId: string | null;
  onClose: (flash?: AssetFlash) => void;
}) {
  const id = useId();
  const [values, setValues] = useState<AssetFormValues>(() =>
    asset
      ? {
          name: asset.name,
          kind: asset.kind,
          ownerId: asset.owner_id,
          balance: formatWon(asset.balance),
          memo: asset.memo ?? '',
        }
      : { name: '', kind: 'checking', ownerId: defaultOwnerId, balance: '', memo: '' },
  );
  const [errors, setErrors] = useState<AssetFormErrors>({});
  const [busy, setBusy] = useState<'save' | 'archive' | null>(null);
  const [failed, setFailed] = useState<'save' | 'archive' | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  // 누구 것: 현재 멤버 + 공동. 수정 중인 자산의 소유자가 나간 멤버면 그 사람도 남겨 둔다
  const owners: { id: string | null; label: string }[] = [
    ...members.filter((m) => !m.left_at).map((m) => ({ id: m.id, label: m.display_name })),
    { id: null, label: SHARED_OWNER_LABEL },
  ];
  if (asset?.owner_id && !owners.some((o) => o.id === asset.owner_id)) {
    owners.push({ id: asset.owner_id, label: ownerLabel(asset.owner_id, members) });
  }

  const set = <K extends keyof AssetFormValues>(key: K, value: AssetFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const result = validateAssetForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      const first = (['balance', 'name', 'memo'] as const).find((k) => result.errors[k]);
      if (first) document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    setBusy('save');
    setFailed(null);
    try {
      if (asset) await updateAsset(asset.id, result.value);
      else await createAsset(ledgerId, result.value);
      onClose({ kind: 'saved' });
    } catch (err) {
      if (err instanceof AssetNotFoundError) return onClose({ kind: 'gone' });
      setFailed('save');
      setBusy(null);
    }
  }

  async function archive() {
    if (!asset) return;
    setBusy('archive');
    setFailed(null);
    try {
      await archiveAsset(asset.id);
      onClose({ kind: 'archived', id: asset.id, name: asset.name });
    } catch (err) {
      if (err instanceof AssetNotFoundError) return onClose({ kind: 'gone' });
      setConfirmArchive(false);
      setFailed('archive');
      setBusy(null);
    }
  }

  const err = (key: keyof AssetFormErrors) =>
    errors[key] && (
      <p id={`${id}-${key}-err`} className="field__error">
        {errors[key]}
      </p>
    );
  const describedBy = (key: keyof AssetFormErrors) => (errors[key] ? `${id}-${key}-err` : undefined);
  const liability = isLiability(values.kind);

  const kindGroup = (group: 'asset' | 'liability', legend: string) => (
    <fieldset className="kind-grid">
      <legend className="kind-grid__legend">{legend}</legend>
      <div className="kind-grid__items">
        {ASSET_KINDS.filter((k) => k.group === group).map((k) => (
          <label key={k.value} className="kind-grid__item">
            <input
              type="radio"
              name="kind"
              value={k.value}
              checked={values.kind === k.value}
              onChange={() => set('kind', k.value)}
            />
            <span className="kind-grid__icon" aria-hidden="true">
              <AssetKindIcon kind={k.value} />
            </span>
            <span className="kind-grid__label">{k.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <main className="content content--no-tabbar">
      <form className="tx-form asset-form" onSubmit={submit} noValidate>
        <div className="asset-form__kinds" role="group" aria-label="종류">
          {kindGroup('asset', '자산')}
          {kindGroup('liability', '부채')}
        </div>

        <div className="field">
          <label htmlFor={`${id}-balance`} className="field__label">
            {liability ? '잔액 (갚을 돈)' : '잔액'}
          </label>
          <div className="amount-input">
            <input
              id={`${id}-balance`}
              value={values.balance}
              inputMode="numeric"
              placeholder="0"
              autoComplete="off"
              aria-invalid={!!errors.balance}
              aria-describedby={describedBy('balance')}
              onChange={(e) => set('balance', formatWonInput(e.target.value))}
            />
            <span aria-hidden="true">원</span>
          </div>
          {err('balance')}
        </div>

        <div className="field">
          <div className="field__label-row">
            <label htmlFor={`${id}-name`} className="field__label">
              이름
            </label>
            <span className="field__count" aria-hidden="true">
              {values.name.trim().length}/{ASSET_NAME_MAX}
            </span>
          </div>
          <input
            id={`${id}-name`}
            className="input"
            value={values.name}
            maxLength={ASSET_NAME_MAX}
            placeholder={liability ? '예: 전세자금대출' : '예: 생활비 통장'}
            autoComplete="off"
            aria-invalid={!!errors.name}
            aria-describedby={describedBy('name')}
            onChange={(e) => set('name', e.target.value)}
          />
          {err('name')}
        </div>

        <fieldset className="field">
          <legend className="field__label">누구 것</legend>
          <div className="chips">
            {owners.map((o) => (
              <label key={o.id ?? 'shared'} className="chip">
                <input
                  type="radio"
                  name="owner"
                  value={o.id ?? ''}
                  checked={values.ownerId === o.id}
                  onChange={() => set('ownerId', o.id)}
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor={`${id}-memo`} className="field__label">
            메모 <span className="field__optional">(선택)</span>
          </label>
          <textarea
            id={`${id}-memo`}
            className="input input--memo"
            value={values.memo}
            maxLength={ASSET_MEMO_MAX}
            rows={2}
            aria-invalid={!!errors.memo}
            aria-describedby={describedBy('memo')}
            onChange={(e) => set('memo', e.target.value)}
          />
          {err('memo')}
        </div>

        <div className="tx-form__actions">
          {failed && (
            <p className="form-error" role="alert">
              {failed === 'save' ? '저장하지 못했어요.' : '보관하지 못했어요.'} 네트워크를 확인하고 다시 시도해 주세요.
            </p>
          )}
          <div className="asset-form__buttons">
            {asset && (
              <button
                type="button"
                className="button button--secondary asset-form__archive"
                onClick={() => setConfirmArchive(true)}
                disabled={!!busy}
              >
                <Archive size={18} aria-hidden="true" />
                보관
              </button>
            )}
            <button type="submit" className="button button--primary asset-form__save" disabled={!!busy}>
              {busy === 'save' ? '저장하는 중…' : '저장'}
            </button>
          </div>
        </div>
      </form>

      {confirmArchive && asset && (
        <Dialog
          title={`${quoteWithObject(asset.name)} 보관할까요?`}
          onCancel={() => !busy && setConfirmArchive(false)}
          actions={
            <>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setConfirmArchive(false)}
                disabled={!!busy}
              >
                취소
              </button>
              <button type="button" className="button button--primary" onClick={archive} disabled={!!busy}>
                {busy === 'archive' ? '보관하는 중…' : '보관하기'}
              </button>
            </>
          }
        >
          <p className="dialog__body">
            이번 달부터 목록과 합계에서 빠져요. 지난 달 추이에는 그대로 남고, 보관함에서 언제든 되살릴 수 있어요.
          </p>
        </Dialog>
      )}
    </main>
  );
}
