import { useCallback, useState } from 'react';
import { useLedgerId } from '../../app/guards';
import { SETTINGS_PATH } from '../../app/routes';
import { useLoad } from '../../app/useLoad';
import { useSaving } from '../../app/useSaving';
import { BackHeader } from '../../components/BackHeader';
import { Sheet } from '../../components/Sheet';
import { StatusScreen } from '../../components/StatusScreen';
import { addPocket, listPockets, saveOrder, updatePocket } from '../../data/catalog';
import type { PocketScope } from '../../data/types';
import { moveItem, nextSortOrder, positionOf, SCOPE_LABEL, sortByOrder } from '../../domain/catalog';
import { HideButton, ItemButton, OrderButtons, SheetError } from './ManageParts';
import { NameForm } from './NameForm';

type SheetState = null | { kind: 'add' } | { kind: 'edit'; id: string };

const SCOPES: readonly PocketScope[] = ['shared', 'personal'];

export function PocketSettingsPage() {
  const ledgerId = useLedgerId();
  const { state, reload } = useLoad(() => listPockets(ledgerId), [ledgerId]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [newScope, setNewScope] = useState<PocketScope>('shared');
  const saving = useSaving();
  const { clearError } = saving;
  const closeSheet = useCallback(() => {
    setSheet(null);
    clearError();
  }, [clearError]);

  if (state.status === 'loading') return <StatusScreen kind="loading" message="주머니를 불러오고 있어요" />;
  if (state.status === 'error')
    return <StatusScreen kind="error" message="주머니를 불러오지 못했어요. 네트워크를 확인해 주세요." onRetry={reload} />;

  const pockets = sortByOrder(state.data);
  const editing = sheet?.kind === 'edit' ? pockets.find((p) => p.id === sheet.id) : undefined;

  async function save(fn: () => Promise<unknown>, done?: string) {
    const ok = await saving.run(fn, done);
    reload();
    return ok;
  }

  return (
    <div className="shell">
      <BackHeader title="주머니 관리" fallback={SETTINGS_PATH} />
      <main className="content content--no-tabbar manage">
        <p className="hint">
          주머니는 지출을 어디에 쓴 돈인지 나누는 구분이에요. 공동·개인 구분은 홈의 지출 나눠 보기에 쓰여요. 숨긴 주머니는 내역 입력에서 빠지고, 지난 내역에는 그대로 보여요.
        </p>

        {pockets.length === 0 ? (
          <p className="manage-empty">아직 주머니가 없어요. 아래에서 주머니를 추가해 보세요.</p>
        ) : (
          <ul className="manage-list">
            {pockets.map((p) => (
              <li key={p.id}>
                <ItemButton item={p} level="flat" badge={SCOPE_LABEL[p.scope]} onClick={() => setSheet({ kind: 'edit', id: p.id })} />
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          className="button button--secondary button--block"
          onClick={() => {
            setNewScope('shared');
            setSheet({ kind: 'add' });
          }}
        >
          + 주머니 추가
        </button>

        <p className="manage-toast" role="status" aria-live="polite">
          {saving.done}
        </p>
      </main>

      {sheet?.kind === 'add' && (
        <Sheet title="주머니 추가" onClose={closeSheet}>
          <SheetError message={saving.error} />
          <NameForm
            autoFocus
            submitLabel="추가"
            busy={saving.busy}
            extra={<ScopePicker value={newScope} disabled={saving.busy} onChange={setNewScope} />}
            onSubmit={async (name) => {
              const ok = await save(
                () => addPocket({ ledgerId, name, scope: newScope, sortOrder: nextSortOrder(pockets) }),
                '추가했어요',
              );
              if (ok) closeSheet();
            }}
          />
        </Sheet>
      )}

      {editing && (
        <Sheet title="주머니" onClose={closeSheet}>
          <SheetError message={saving.error} />
          <NameForm
            key={editing.id}
            initial={editing.name}
            submitLabel="이름 저장"
            busy={saving.busy}
            onSubmit={async (name) => {
              if (await save(() => updatePocket(editing.id, { name }))) closeSheet();
            }}
          />
          <div className="manage-sheet__section">
            <ScopePicker
              value={editing.scope}
              disabled={saving.busy}
              onChange={(scope) => {
                if (scope !== editing.scope) void save(() => updatePocket(editing.id, { scope }));
              }}
            />
            <p className="hint">바꾸면 이 주머니의 지난 내역도 바뀐 구분으로 집계돼요.</p>
          </div>
          <OrderButtons
            busy={saving.busy}
            position={positionOf(pockets, editing.id)}
            onMove={(dir) => save(() => saveOrder('pocket', moveItem(pockets, editing.id, dir)), '순서를 바꿨어요')}
          />
          <HideButton
            hidden={editing.is_hidden}
            busy={saving.busy}
            onToggle={async () => {
              const hide = !editing.is_hidden;
              if (await save(() => updatePocket(editing.id, { is_hidden: hide }), hide ? '숨겼어요' : '다시 보이게 했어요')) closeSheet();
            }}
          />
        </Sheet>
      )}
    </div>
  );
}

/** 공동 / 개인 고르기 (라디오) */
function ScopePicker({ value, disabled, onChange }: { value: PocketScope; disabled: boolean; onChange: (s: PocketScope) => void }) {
  return (
    <fieldset className="scope-picker" disabled={disabled}>
      <legend className="manage-sheet__label">구분</legend>
      <div className="manage-tabs">
        {SCOPES.map((s) => (
          <label key={s} className={`manage-tabs__item${s === value ? ' is-active' : ''}`}>
            <input type="radio" name="pocket-scope" value={s} checked={s === value} onChange={() => onChange(s)} className="visually-hidden" />
            {SCOPE_LABEL[s]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
