import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Plus } from 'lucide-react';
import { useState } from 'react';
import type { Category } from '../data/types';
import { groupHas, secondStepOptions, selectsDirectly, type PickerGroup, type PickerModel } from '../domain/categoryPicker';
import { CategoryIcon } from './CategoryIcon';

/**
 * 카테고리 선택 시트 본문 (BANB-36 한 단계).
 * 대분류 아이콘 격자: 자주 쓰는 8개 → "전체 보기"로 나머지 + 끝에 "추가" 칸.
 * 대분류를 누르면 바로 선택(onSelect 에 같은 이름 소분류). 보이는 소분류가 있는 대분류만 두 번째 단계로 간다:
 * 맨 앞 "대분류 이름" → 소분류.
 */
export function CategoryPicker({
  model,
  selectedId,
  onSelect,
  onAdd,
}: {
  model: PickerModel;
  selectedId: string;
  onSelect: (category: Category) => void;
  onAdd: () => void;
}) {
  // 고른 것이 "전체 보기" 쪽에 있으면 펼쳐서 보여 준다
  const [expanded, setExpanded] = useState(() => model.rest.some((g) => groupHas(g, selectedId)));
  const [openParentId, setOpenParentId] = useState<string | null>(null);
  const open = openParentId ? [...model.frequent, ...model.rest].find((g) => g.parent.id === openParentId) : undefined;

  if (open) {
    return <SecondStep group={open} selectedId={selectedId} onSelect={onSelect} onBack={() => setOpenParentId(null)} />;
  }

  const parentCell = (g: PickerGroup) => {
    const selected = groupHas(g, selectedId);
    const direct = selectsDirectly(g);
    return (
      <button
        key={g.parent.id}
        type="button"
        role="radio"
        aria-checked={selected}
        className={`cat-cell${selected ? ' is-selected' : ''}`}
        onClick={() => (direct && g.self ? onSelect(g.self) : setOpenParentId(g.parent.id))}
      >
        <span className="cat-cell__circle">
          <CategoryIcon category={g.parent} size="grid" />
          {selected && <CheckBadge />}
          {!direct && !selected && (
            <span className="cat-cell__more" aria-hidden="true">
              <ChevronRight size={12} strokeWidth={3} />
            </span>
          )}
        </span>
        <span className="cat-cell__name">
          {g.parent.name}
          {g.parent.is_hidden ? ' (숨김)' : ''}
        </span>
        {!direct && <span className="visually-hidden">, 소분류 고르기</span>}
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

  const hasRest = model.rest.length > 0;
  const empty = model.frequent.length === 0;

  return (
    <div className="cat-picker">
      {empty ? (
        <section className="cat-picker__section">
          <p className="hint">고를 수 있는 카테고리가 없어요. 추가해 보세요.</p>
          <div className="cat-grid">{addCell}</div>
        </section>
      ) : (
        <section className="cat-picker__section" aria-label="자주 쓰는 것">
          <div className="cat-grid" role="radiogroup" aria-label="자주 쓰는 것">
            {model.frequent.map(parentCell)}
            {!hasRest && addCell}
          </div>
        </section>
      )}
      {hasRest && (
        <>
          <button
            type="button"
            className="cat-picker__more"
            aria-expanded={expanded}
            aria-controls="cat-picker-rest"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '접기' : `전체 보기 (${model.rest.length}개 더)`}
            {expanded ? (
              <ChevronUp size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
            ) : (
              <ChevronDown size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
            )}
          </button>
          {expanded && (
            <section id="cat-picker-rest" className="cat-picker__section" aria-label="전체">
              <div className="cat-grid" role="radiogroup" aria-label="전체">
                {model.rest.map(parentCell)}
                {addCell}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * 가계부 탭 필터의 카테고리 고르기 (BANB-32, design.md 5.17 격자 모양).
 * 여러 개 고르기(checkbox). 선택 표시는 선택 시트와 같다(primary 원 + Check 배지 + 이름 700).
 * 필터라서 "추가" 칸·자주 쓰는 순서·"전체 보기"·두 번째 단계(소분류)는 없다 — 대분류 단위, 기본 순서.
 */
export function CategoryCheckGrid({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend: string;
  options: { id: string; label: string; category: Pick<Category, 'name' | 'icon'> }[];
  selected: readonly string[];
  onToggle: (id: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <fieldset className="manage-sheet__section filter-group">
      <legend className="manage-sheet__label">{legend}</legend>
      <div className="cat-grid cat-grid--check">
        {options.map((o) => {
          const checked = selected.includes(o.id);
          return (
            <label key={o.id} className={`cat-cell${checked ? ' is-selected' : ''}`}>
              <input type="checkbox" className="visually-hidden" checked={checked} onChange={() => onToggle(o.id)} />
              <span className="cat-cell__circle">
                <CategoryIcon category={o.category} size="grid" />
                {checked && <CheckBadge />}
              </span>
              <span className="cat-cell__name">{o.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function CheckBadge() {
  return (
    <span className="cat-cell__check" aria-hidden="true">
      <Check size={12} strokeWidth={3} />
    </span>
  );
}

/** 두 번째 단계: 맨 앞 대분류 이름(같은 이름 소분류) → 보이는 소분류 */
function SecondStep({
  group,
  selectedId,
  onSelect,
  onBack,
}: {
  group: PickerGroup;
  selectedId: string;
  onSelect: (category: Category) => void;
  onBack: () => void;
}) {
  const { parent } = group;
  return (
    <div className="cat-picker">
      <div className="cat-picker__step">
        <button type="button" className="cat-picker__back" onClick={onBack} aria-label="대분류로 돌아가기">
          <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" focusable="false" />
        </button>
        <h3 className="cat-picker__head" id={`cat-step-${parent.id}`}>
          <CategoryIcon category={parent} size="inline" />
          {parent.name}
          {parent.is_hidden ? ' (숨김)' : ''}
        </h3>
      </div>
      <div className="cat-grid" role="radiogroup" aria-labelledby={`cat-step-${parent.id}`}>
        {secondStepOptions(group).map((c) => {
          const selected = c.id === selectedId;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`cat-cell${selected ? ' is-selected' : ''}`}
              onClick={() => onSelect(c)}
            >
              <span className="cat-cell__circle">
                <CategoryIcon category={c} parent={parent} size="grid" />
                {selected && <CheckBadge />}
              </span>
              <span className="cat-cell__name">
                {c.name}
                {c.is_hidden ? ' (숨김)' : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
