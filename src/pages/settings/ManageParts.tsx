/** 카테고리·주머니 관리 화면 공통 부품 */

export function SheetError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="form-error" role="alert">
      {message}
    </p>
  );
}

export function ItemButton({
  item,
  level,
  badge,
  onClick,
}: {
  item: { name: string; is_hidden: boolean };
  level: 'parent' | 'child' | 'flat';
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`manage-row manage-row--${level}${item.is_hidden ? ' is-hidden' : ''}`} onClick={onClick}>
      <span className="manage-row__name">{item.name}</span>
      {badge && <Badge text={badge} />}
      {item.is_hidden && <Badge text="숨김" muted />}
      <span className="manage-row__chevron" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

export function OrderButtons({
  busy,
  position,
  onMove,
}: {
  busy: boolean;
  position: { isFirst: boolean; isLast: boolean };
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <div className="manage-sheet__section">
      <p className="manage-sheet__label">순서</p>
      <div className="manage-button-row">
        <button type="button" className="button button--secondary" disabled={busy || position.isFirst} onClick={() => onMove(-1)}>
          ↑ 위로
        </button>
        <button type="button" className="button button--secondary" disabled={busy || position.isLast} onClick={() => onMove(1)}>
          ↓ 아래로
        </button>
      </div>
    </div>
  );
}

export function HideButton({
  hidden,
  busy,
  note,
  onToggle,
}: {
  hidden: boolean;
  busy: boolean;
  note?: string;
  onToggle: () => void;
}) {
  return (
    <div className="manage-sheet__section">
      <button type="button" className="button button--secondary button--block" disabled={busy} onClick={onToggle}>
        {hidden ? '다시 보이기' : '숨기기'}
      </button>
      <p className="hint">
        {hidden ? '다시 보이게 하면 내역 입력에서 다시 고를 수 있어요.' : '숨겨도 지난 내역에는 이름이 그대로 보여요.'}
        {!hidden && note ? ` ${note}` : ''}
      </p>
    </div>
  );
}

/** 목록 표시(공동/개인, 숨김). 화면 읽기에서는 "이름, 공동, 숨김"처럼 쉼표로 끊어 읽힌다 */
function Badge({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <span className={`manage-badge${muted ? ' manage-badge--muted' : ''}`}>
      <span className="visually-hidden">, </span>
      {text}
    </span>
  );
}
