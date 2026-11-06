import { useEffect, useId, useRef, type ReactNode } from 'react';

/** 아래에서 올라오는 시트 (모달 대화상자). 배경 탭·Esc·닫기 버튼으로 닫힌다 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // 시트 자체에 초점 (입력칸 자동 초점은 휴대폰 키보드를 바로 띄우므로, 필요한 곳에서 autoFocus로)
    if (panel && !panel.contains(document.activeElement)) panel.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet__head">
          <h2 id={titleId} className="sheet__title">
            {title}
          </h2>
          <button type="button" className="icon-button sheet__close" aria-label="닫기" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
