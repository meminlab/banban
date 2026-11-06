/** 전체 화면 상태 표시: 불러오는 중 / 오류(다시 시도) */
export function StatusScreen({
  kind,
  message,
  onRetry,
}: {
  kind: 'loading' | 'error';
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="shell">
      <main className="status-screen" role={kind === 'error' ? 'alert' : 'status'} aria-live="polite">
        {kind === 'loading' && <span className="spinner" aria-hidden="true" />}
        <p>{message}</p>
        {onRetry && (
          <button type="button" className="button button--secondary" onClick={onRetry}>
            다시 시도
          </button>
        )}
      </main>
    </div>
  );
}
