import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { TxFlash, TxUndo } from '../app/routes';
import { undoRecurringRecord } from '../data/recurring';
import { deleteTransaction, updateTransaction } from '../data/transaction';

type Notice = { text: string; undo?: TxUndo };

const UNDO_MS = 5000;
const PLAIN_MS = 3000;

/**
 * 내역 입력·수정 화면에서 돌아왔을 때의 토스트 (design.md 5.10, 5.15 "저장했어요 · 되돌리기").
 * 탭 공통 틀에 두어 홈·가계부·자산 어디로 돌아와도 같은 자리에 뜬다.
 * 되돌리면 onUndone 으로 지금 탭을 다시 불러온다.
 */
export function TxFlashToast({ onUndone }: { onUndone: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [undoing, setUndoing] = useState(false);

  // 알림은 한 번만: 새로고침·뒤로가기로 다시 뜨지 않게 history state 를 지운다 (쿼리는 유지)
  useEffect(() => {
    const flash = (location.state as { txFlash?: TxFlash } | null)?.txFlash;
    if (!flash) return;
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
    setNotice(
      flash.kind === 'saved'
        ? { text: '저장했어요', undo: flash.undo }
        : flash.kind === 'recorded'
          ? { text: flash.text, undo: flash.undo }
          : { text: '삭제했어요' },
    );
  }, [location.state, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!notice || undoing) return;
    const t = setTimeout(() => setNotice(null), notice.undo ? UNDO_MS : PLAIN_MS);
    return () => clearTimeout(t);
  }, [notice, undoing]);

  const undo = useCallback(async () => {
    const u = notice?.undo;
    if (!u || undoing) return;
    setUndoing(true);
    try {
      if (u.op === 'delete') await deleteTransaction(u.id);
      else if (u.op === 'unrecord') await undoRecurringRecord(u.ledgerId, u.keys);
      else if ((await updateTransaction(u.id, u.values)) === 'deleted') {
        setNotice({ text: '다른 멤버가 삭제한 내역이라 되돌리지 못했어요' });
        return;
      }
      setNotice({ text: '되돌렸어요' });
      onUndone();
    } catch {
      setNotice({ text: '되돌리지 못했어요. 네트워크를 확인해 주세요' });
    } finally {
      setUndoing(false);
    }
  }, [notice, undoing, onUndone]);

  return (
    <div className="toast toast--action" role="status" aria-live="polite">
      {notice && (
        <>
          <span>{notice.text}</span>
          {notice.undo && (
            <button type="button" className="toast__action" onClick={undo} disabled={undoing}>
              되돌리기
            </button>
          )}
        </>
      )}
    </div>
  );
}
