import { Check, Plus, Tag } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { Category, TransactionType } from '../data/types';
import { NAME_MAX, sortByOrder, TRANSACTION_TYPES, TYPE_LABEL } from '../domain/catalog';
import { categoryGlyph, ICON_GROUPS, isKnownIcon } from '../domain/categoryIcon';
import { checkCategoryDraft, type ParentChoice } from '../domain/categoryPicker';
import { GlyphCircle, LucideByKey } from './CategoryIcon';

export interface CategoryEditorValues {
  name: string;
  icon: string | null;
  /** 추가일 때만 (수정은 대분류를 바꾸지 않는다) */
  parent: ParentChoice | null;
}

/**
 * 카테고리 추가·수정 (design.md 5.17 "추가 화면").
 * 미리보기 → 이름(글자 수) → [추가만] 넣을 대분류 칩 → 아이콘 6열 격자 → 저장.
 * 이름이 비었거나 같은 곳에 같은 이름이 있으면 저장 버튼을 끄고 이유를 한 줄 보여 준다.
 */
export function CategoryEditor({
  categories,
  type,
  onTypeChange,
  editing,
  initialParent = null,
  busy,
  submitLabel,
  children,
  onSubmit,
}: {
  categories: readonly Category[];
  type: TransactionType;
  /** 넘기면 맨 위에 지출/수입/저축 세그먼트 (설정에서 추가할 때만) */
  onTypeChange?: (type: TransactionType) => void;
  editing?: Category;
  initialParent?: ParentChoice | null;
  busy: boolean;
  submitLabel: string;
  /** 저장 버튼 위에 넣을 내용 (저장 실패 안내 등) */
  children?: ReactNode;
  onSubmit: (values: CategoryEditorValues) => void;
}) {
  const id = useId();
  const [name, setName] = useState(editing?.name ?? '');
  const [icon, setIcon] = useState<string | null>(isKnownIcon(editing?.icon) ? editing.icon : null);
  const [parent, setParent] = useState<ParentChoice | null>(editing ? null : initialParent);
  const [touched, setTouched] = useState(false);

  const isAdd = !editing;
  // 미리보기는 저장 후 실제로 보일 모양과 같게: 고른 아이콘 → (소분류면) 대분류 아이콘 → 이름 첫 글자 → 이름도 없으면 Tag
  const previewParentId = editing ? editing.parent_id : parent?.kind === 'existing' ? parent.id : null;
  const previewParent = previewParentId ? categories.find((c) => c.id === previewParentId) : undefined;
  const previewGlyph = categoryGlyph({ name, icon }, previewParent);
  const previewEmpty = previewGlyph.kind === 'letter' && name.trim() === '';
  const check = checkCategoryDraft({ name, type, categories, parent, editing });
  const parents = sortByOrder(
    categories.filter(
      (c) => c.type === type && c.parent_id === null && (!c.is_hidden || (parent?.kind === 'existing' && parent.id === c.id)),
    ),
  );
  const nameLength = [...name.trim()].length;
  // 이름을 아직 안 쓴 첫 화면에서는 "이름을 입력해 주세요"를 오류처럼 보이지 않게 안내만 한다
  const showReason = !check.ok && (touched || name.length > 0 || !isAdd);

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!check.ok || busy) return;
    onSubmit({ name: check.name, icon, parent: isAdd ? parent : null });
  }

  return (
    <form className="cat-editor" onSubmit={submit} noValidate>
      {isAdd && onTypeChange && (
        <fieldset className="segmented cat-editor__type" aria-label="종류">
          {TRANSACTION_TYPES.map((t) => (
            <label key={t} className={`segmented__item${t === type ? ' is-selected' : ''}`}>
              <input
                type="radio"
                name={`${id}-type`}
                value={t}
                checked={t === type}
                onChange={() => {
                  onTypeChange(t);
                  setParent(parent?.kind === 'new' ? parent : null);
                }}
              />
              {TYPE_LABEL[t]}
            </label>
          ))}
        </fieldset>
      )}

      <div className="cat-editor__preview" aria-hidden="true">
        <span className="cat-editor__preview-circle">
          {previewEmpty ? (
            <span className="cat-icon cat-icon--preview">
              <Tag size={30} strokeWidth={2} aria-hidden="true" focusable="false" />
            </span>
          ) : (
            <GlyphCircle glyph={previewGlyph} size="preview" />
          )}
        </span>
        <span className="cat-editor__preview-name">{name.trim() || '새 카테고리'}</span>
      </div>

      <div className="cat-editor__field">
        <div className="cat-editor__label-row">
          <label className="manage-sheet__label" htmlFor={`${id}-name`}>
            이름
          </label>
          <span className="cat-editor__count" id={`${id}-count`}>
            {nameLength}/{NAME_MAX}
          </span>
        </div>
        <input
          id={`${id}-name`}
          className="manage-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          autoComplete="off"
          autoFocus={isAdd}
          enterKeyHint="done"
          aria-invalid={showReason ? true : undefined}
          aria-describedby={`${id}-count${check.ok ? '' : ` ${id}-reason`}`}
        />
      </div>

      {isAdd && (
        <fieldset className="cat-editor__field">
          <legend className="manage-sheet__label">어디에 넣을까요</legend>
          <div className="chips">
            {parents.map((p) => (
              <label key={p.id} className="chip">
                <input
                  type="radio"
                  name={`${id}-parent`}
                  checked={parent?.kind === 'existing' && parent.id === p.id}
                  onChange={() => setParent({ kind: 'existing', id: p.id })}
                />
                <span>{p.name}</span>
              </label>
            ))}
            <label className="chip">
              <input type="radio" name={`${id}-parent`} checked={parent?.kind === 'new'} onChange={() => setParent({ kind: 'new' })} />
              <span>
                <Plus size={16} strokeWidth={2} aria-hidden="true" focusable="false" className="chip__lead" />새 대분류
              </span>
            </label>
          </div>
          {parent?.kind === 'new' && <p className="hint">이 이름으로 대분류를 만들어요(같은 이름의 소분류도 함께).</p>}
        </fieldset>
      )}

      <div className="cat-editor__field">
        <p className="manage-sheet__label" id={`${id}-icons`}>
          아이콘 <span className="field__optional">(안 고르면 대분류 아이콘, 없으면 이름 첫 글자)</span>
        </p>
        <div className="icon-grid" role="radiogroup" aria-labelledby={`${id}-icons`}>
          {ICON_GROUPS.flatMap((g) => g.icons).map((o) => {
            const selected = icon === o.key;
            return (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={o.label}
                className={`icon-grid__item${selected ? ' is-selected' : ''}`}
                // 같은 아이콘을 다시 누르면 고르지 않은 상태(첫 글자)로
                onClick={() => setIcon(selected ? null : o.key)}
              >
                <LucideByKey iconKey={o.key} size={22} />
                {selected && (
                  <span className="icon-grid__check" aria-hidden="true">
                    <Check size={10} strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="cat-editor__actions">
        {children}
        {!check.ok && (
          <p id={`${id}-reason`} className={showReason ? 'form-error' : 'hint'} role={showReason ? 'alert' : undefined}>
            {check.reason}
          </p>
        )}
        <button type="submit" className="button button--primary button--block" disabled={busy || !check.ok}>
          {busy ? '저장하는 중…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
