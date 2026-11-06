import { Check, Plus } from 'lucide-react';
import type { Category } from '../data/types';
import type { PickerModel } from '../domain/categoryPicker';
import { CategoryIcon } from './CategoryIcon';

/**
 * 카테고리 선택 시트 본문 (design.md 5.17).
 * 최근 쓴 것 → 대분류 구역(소분류 아이콘 격자 4열) → 그 밖의 분류 → 끝에 "추가" 칸.
 * 고르면 onSelect, "추가"는 onAdd.
 * 구역마다 radiogroup 을 따로 둔다: 고른 카테고리가 "최근 쓴 것"과 원래 구역에 함께 나와도
 * 한 그룹 안에서 선택(aria-checked)은 하나뿐이다.
 */
export function CategoryPicker({
  model,
  parentById,
  selectedId,
  onSelect,
  onAdd,
}: {
  model: PickerModel;
  parentById: ReadonlyMap<string, Category>;
  selectedId: string;
  onSelect: (category: Category) => void;
  onAdd: () => void;
}) {
  const cell = (c: Category, keyPrefix = '') => {
    const parent = c.parent_id ? parentById.get(c.parent_id) : undefined;
    const selected = c.id === selectedId;
    const hidden = c.is_hidden || parent?.is_hidden;
    return (
      <button
        key={keyPrefix + c.id}
        type="button"
        role="radio"
        aria-checked={selected}
        className={`cat-cell${selected ? ' is-selected' : ''}`}
        onClick={() => onSelect(c)}
      >
        <span className="cat-cell__circle">
          <CategoryIcon category={c} parent={parent} size="grid" />
          {selected && (
            <span className="cat-cell__check" aria-hidden="true">
              <Check size={12} strokeWidth={3} />
            </span>
          )}
        </span>
        <span className="cat-cell__name">
          {c.name}
          {hidden ? ' (숨김)' : ''}
        </span>
      </button>
    );
  };

  const addCell = (
    <button type="button" className="cat-cell cat-cell--add" onClick={onAdd}>
      <span className="cat-cell__circle">
        <span className="cat-icon cat-icon--grid cat-icon--add" aria-hidden="true">
          <Plus size={22} strokeWidth={2} />
        </span>
      </span>
      <span className="cat-cell__name">추가</span>
    </button>
  );

  const empty = model.sections.length === 0 && model.others.length === 0;
  const lastIsOthers = model.others.length > 0;

  return (
    <div className="cat-picker">
      {model.recent.length > 0 && (
        <section className="cat-picker__section" aria-label="최근 쓴 것">
          <h3 className="cat-picker__head">최근 쓴 것</h3>
          <div className="cat-grid" role="radiogroup" aria-label="최근 쓴 것">{model.recent.map((c) => cell(c, 'recent-'))}</div>
        </section>
      )}
      {model.sections.map(({ parent, children }, i) => (
        <section key={parent.id} className="cat-picker__section" aria-label={parent.name}>
          <h3 className="cat-picker__head">
            <CategoryIcon category={parent} size="inline" />
            {parent.name}
            {parent.is_hidden ? ' (숨김)' : ''}
          </h3>
          <div className="cat-grid" role="radiogroup" aria-label={parent.name}>
            {children.map((c) => cell(c))}
            {!lastIsOthers && i === model.sections.length - 1 && addCell}
          </div>
        </section>
      ))}
      {lastIsOthers && (
        <section className="cat-picker__section" aria-label="그 밖의 분류">
          <h3 className="cat-picker__head">그 밖의 분류</h3>
          <div className="cat-grid" role="radiogroup" aria-label="그 밖의 분류">
            {model.others.map((c) => cell(c))}
            {addCell}
          </div>
        </section>
      )}
      {empty && (
        <section className="cat-picker__section">
          <p className="hint">고를 수 있는 카테고리가 없어요. 추가해 보세요.</p>
          <div className="cat-grid">{addCell}</div>
        </section>
      )}
    </div>
  );
}
