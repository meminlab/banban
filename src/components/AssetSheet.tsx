import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Asset, Member } from '../data/types';
import {
  ASSET_KINDS,
  ASSET_MEMO_MAX,
  ASSET_NAME_MAX,
  SHARED_OWNER_LABEL,
  ownerLabel,
  validateAssetForm,
  type AssetFormErrors,
  type AssetFormValues,
  type AssetInput,
} from '../domain/asset';
import { formatWon, formatWonInput } from '../domain/money';

export interface AssetSheetProps {
  /** 수정할 자산. 없으면 추가 */
  asset: Asset | null;
  members: readonly Member[];
  /** 추가할 때 기본 소유자 (본인 member id) */
  defaultOwnerId: string | null;
  onSave: (input: AssetInput) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

/** 자산 추가·수정 화면 (아래에서 올라오는 시트) */
export function AssetSheet({ asset, members, defaultOwnerId, onSave, onDelete, onClose }: AssetSheetProps) {
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
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
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [failed, setFailed] = useState<'save' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  // 소유자 선택지: 현재 멤버 + 공동. 수정 중인 자산의 소유자가 나간 멤버면 그 사람도 남겨 둔다
  const ownerOptions: { id: string | null; label: string }[] = [
    ...members.filter((m) => !m.left_at).map((m) => ({ id: m.id, label: m.display_name })),
    { id: null, label: SHARED_OWNER_LABEL },
  ];
  if (asset?.owner_id && !ownerOptions.some((o) => o.id === asset.owner_id)) {
    ownerOptions.push({ id: asset.owner_id, label: ownerLabel(asset.owner_id, members) });
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
      return;
    }
    setBusy('save');
    setFailed(null);
    try {
      await onSave(result.value);
    } catch {
      setFailed('save');
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    setFailed(null);
    try {
      await onDelete();
    } catch {
      setFailed('delete');
      setBusy(null);
    }
  }

  const err = (key: keyof AssetFormErrors) => errors[key] && (
    <p id={`${titleId}-${key}-err`} className="field__error">
      {errors[key]}
    </p>
  );
  const describedBy = (key: keyof AssetFormErrors) => (errors[key] ? `${titleId}-${key}-err` : undefined);

  return (
    <div className="sheet-backdrop" onClick={() => !busy && onClose()}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet__header">
          <h2 id={titleId} className="sheet__title">
            {asset ? '자산 수정' : '자산 추가'}
          </h2>
          <button type="button" className="button button--text" onClick={onClose} disabled={!!busy}>
            닫기
          </button>
        </header>

        <form className="sheet__body" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor={`${titleId}-name`} className="field__label">
              이름
            </label>
            <input
              ref={nameRef}
              id={`${titleId}-name`}
              className="input"
              value={values.name}
              maxLength={ASSET_NAME_MAX}
              placeholder="예: 생활비 통장"
              autoComplete="off"
              aria-invalid={!!errors.name}
              aria-describedby={describedBy('name')}
              onChange={(e) => set('name', e.target.value)}
            />
            {err('name')}
          </div>

          <fieldset className="field">
            <legend className="field__label">종류</legend>
            <div className="chips">
              {ASSET_KINDS.map((k) => (
                <label key={k.value} className="chip">
                  <input
                    type="radio"
                    name="kind"
                    value={k.value}
                    checked={values.kind === k.value}
                    onChange={() => set('kind', k.value)}
                  />
                  <span>{k.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="field">
            <legend className="field__label">소유자</legend>
            <div className="chips">
              {ownerOptions.map((o) => (
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
            <label htmlFor={`${titleId}-balance`} className="field__label">
              잔액
            </label>
            <div className="input-unit">
              <input
                id={`${titleId}-balance`}
                className="input input--amount"
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
            <label htmlFor={`${titleId}-memo`} className="field__label">
              메모 <span className="field__optional">(선택)</span>
            </label>
            <textarea
              id={`${titleId}-memo`}
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

          {failed && (
            <p className="form-error" role="alert">
              {failed === 'save' ? '저장하지 못했어요.' : '삭제하지 못했어요.'} 네트워크를 확인하고 다시 시도해 주세요.
            </p>
          )}

          {confirmDelete ? (
            <div className="confirm" role="group" aria-label="삭제 확인">
              <p className="confirm__text">이 자산을 삭제할까요? 되돌릴 수 없어요.</p>
              <div className="sheet__actions">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setConfirmDelete(false)}
                  disabled={!!busy}
                >
                  취소
                </button>
                <button type="button" className="button button--danger" onClick={remove} disabled={!!busy}>
                  {busy === 'delete' ? '삭제하는 중…' : '삭제'}
                </button>
              </div>
            </div>
          ) : (
            <div className="sheet__actions">
              {asset && (
                <button
                  type="button"
                  className="button button--secondary button--danger-text"
                  onClick={() => setConfirmDelete(true)}
                  disabled={!!busy}
                >
                  삭제
                </button>
              )}
              <button type="submit" className="button button--primary" disabled={!!busy}>
                {busy === 'save' ? '저장하는 중…' : '저장'}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
