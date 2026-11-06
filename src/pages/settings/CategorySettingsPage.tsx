import { useCallback, useState } from 'react';
import { useLedgerId } from '../../app/guards';
import { SETTINGS_PATH } from '../../app/routes';
import { useLoad } from '../../app/useLoad';
import { useSaving } from '../../app/useSaving';
import { BackHeader } from '../../components/BackHeader';
import { Sheet } from '../../components/Sheet';
import { StatusScreen } from '../../components/StatusScreen';
import { addChildCategory, addParentCategory, listCategories, saveOrder, updateCategory } from '../../data/catalog';
import type { Category, TransactionType } from '../../data/types';
import { buildCategoryTree, moveItem, nextSortOrder, positionOf, TRANSACTION_TYPES, TYPE_LABEL } from '../../domain/catalog';
import { HideButton, ItemButton, OrderButtons, SheetError } from './ManageParts';
import { NameForm } from './NameForm';

type SheetState = null | { kind: 'addParent' } | { kind: 'addChild'; parentId: string } | { kind: 'edit'; id: string };

export function CategorySettingsPage() {
  const ledgerId = useLedgerId();
  const { state, reload } = useLoad(() => listCategories(ledgerId), [ledgerId]);
  const [type, setType] = useState<TransactionType>('expense');
  const [sheet, setSheet] = useState<SheetState>(null);
  const saving = useSaving();

  const { clearError } = saving;
  const closeSheet = useCallback(() => {
    setSheet(null);
    clearError();
  }, [clearError]);

  if (state.status === 'loading') return <StatusScreen kind="loading" message="카테고리를 불러오고 있어요" />;
  if (state.status === 'error')
    return <StatusScreen kind="error" message="카테고리를 불러오지 못했어요. 네트워크를 확인해 주세요." onRetry={reload} />;

  const all = state.data;
  const tree = buildCategoryTree(all, type);
  const byId = new Map(all.map((c) => [c.id, c]));
  const siblingsOf = (c: Category) => all.filter((x) => x.type === c.type && x.parent_id === c.parent_id);

  async function save(fn: () => Promise<unknown>, done?: string) {
    const ok = await saving.run(fn, done);
    reload(); // 실패해도 다시 불러와 다른 멤버의 변경까지 반영
    return ok;
  }

  const editing = sheet?.kind === 'edit' ? byId.get(sheet.id) : undefined;
  const addParentOf = sheet?.kind === 'addChild' ? byId.get(sheet.parentId) : undefined;

  return (
    <div className="shell">
      <BackHeader title="카테고리 관리" fallback={SETTINGS_PATH} />
      <main className="content content--no-tabbar manage">
        <div className="segmented" role="tablist" aria-label="유형">
          {TRANSACTION_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`tab-${t}`}
              aria-selected={t === type}
              aria-controls="category-panel"
              className={`segmented__item${t === type ? ' is-active' : ''}`}
              onClick={() => setType(t)}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <p className="hint">항목을 누르면 이름·순서를 바꾸거나 숨길 수 있어요. 숨긴 항목은 내역 입력에서 빠지고, 지난 내역에는 그대로 보여요.</p>

        <section id="category-panel" role="tabpanel" aria-labelledby={`tab-${type}`}>
          {tree.length === 0 ? (
            <p className="empty">아직 {TYPE_LABEL[type]} 카테고리가 없어요. 아래에서 대분류를 추가해 보세요.</p>
          ) : (
            <ul className="manage-list">
              {tree.map(({ category: parent, children }) => (
                <li key={parent.id} className="manage-group">
                  <ItemButton item={parent} level="parent" onClick={() => setSheet({ kind: 'edit', id: parent.id })} />
                  <ul className="manage-list manage-list--children">
                    {children.map((child) => (
                      <li key={child.id}>
                        <ItemButton item={child} level="child" onClick={() => setSheet({ kind: 'edit', id: child.id })} />
                      </li>
                    ))}
                    <li>
                      <button
                        type="button"
                        className="manage-add"
                        aria-label={`${parent.name}에 소분류 추가`}
                        onClick={() => setSheet({ kind: 'addChild', parentId: parent.id })}
                      >
                        + 소분류 추가
                      </button>
                    </li>
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>

        <button type="button" className="button button--secondary button--block" onClick={() => setSheet({ kind: 'addParent' })}>
          + {TYPE_LABEL[type]} 대분류 추가
        </button>

        <p className="toast toast--no-tabbar" role="status" aria-live="polite">
          {saving.done}
        </p>
      </main>

      {sheet?.kind === 'addParent' && (
        <Sheet title={`${TYPE_LABEL[type]} 대분류 추가`} onClose={closeSheet}>
          <SheetError message={saving.error} />
          <NameForm
            autoFocus
            submitLabel="추가"
            busy={saving.busy}
            hint="같은 이름의 소분류가 함께 만들어져요."
            onSubmit={async (name) => {
              const siblings = all.filter((c) => c.type === type && c.parent_id === null);
              const ok = await save(() => addParentCategory({ ledgerId, type, name, sortOrder: nextSortOrder(siblings) }), '추가했어요');
              if (ok) closeSheet();
            }}
          />
        </Sheet>
      )}

      {sheet?.kind === 'addChild' && addParentOf && (
        <Sheet title={`${addParentOf.name}에 소분류 추가`} onClose={closeSheet}>
          <SheetError message={saving.error} />
          <NameForm
            autoFocus
            submitLabel="추가"
            busy={saving.busy}
            onSubmit={async (name) => {
              const siblings = all.filter((c) => c.parent_id === addParentOf.id);
              const ok = await save(
                () =>
                  addChildCategory({ ledgerId, type: addParentOf.type, parentId: addParentOf.id, name, sortOrder: nextSortOrder(siblings) }),
                '추가했어요',
              );
              if (ok) closeSheet();
            }}
          />
        </Sheet>
      )}

      {editing && (
        <Sheet title={editing.parent_id ? '소분류' : '대분류'} onClose={closeSheet}>
          <SheetError message={saving.error} />
          <NameForm
            key={editing.id}
            initial={editing.name}
            submitLabel="이름 저장"
            busy={saving.busy}
            onSubmit={async (name) => {
              if (await save(() => updateCategory(editing.id, { name }))) closeSheet();
            }}
          />
          <OrderButtons
            busy={saving.busy}
            position={positionOf(siblingsOf(editing), editing.id)}
            onMove={(dir) => save(() => saveOrder('category', moveItem(siblingsOf(editing), editing.id, dir)), '순서를 바꿨어요')}
          />
          <HideButton
            hidden={editing.is_hidden}
            busy={saving.busy}
            note={editing.parent_id === null ? '대분류를 숨기면 그 아래 소분류도 내역 입력에서 빠져요.' : undefined}
            onToggle={async () => {
              const hide = !editing.is_hidden;
              if (await save(() => updateCategory(editing.id, { is_hidden: hide }), hide ? '숨겼어요' : '다시 보이게 했어요')) closeSheet();
            }}
          />
        </Sheet>
      )}
    </div>
  );
}
