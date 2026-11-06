import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * 확인 창 (화면 가운데 모달). 열리면 첫 버튼(취소/확인)에 포커스, Esc = onCancel.
 * actions 의 첫 번째 버튼에 포커스가 간다.
 */
export function Dialog({
  title,
  children,
  actions,
  onCancel,
}: {
  title: string;
  children?: ReactNode;
  actions: ReactNode;
  onCancel?: () => void;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    return () => prev?.focus?.();
  }, []);

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        ref={ref}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && onCancel) onCancel();
        }}
      >
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        {children}
        <div className="dialog__actions">{actions}</div>
      </div>
    </div>
  );
}
