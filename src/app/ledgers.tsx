import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getLastLedgerId, listMyLedgers, rememberLedger } from '../data/ledger';
import { pickCurrentLedgerId, type MyLedger } from '../domain/ledgers';
import { useCurrentUser } from './auth';

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; ledgers: MyLedger[]; currentId: string | null };

export interface LedgersValue {
  state: State;
  /** 다른 가계부로 전환 (서버에 마지막으로 본 가계부로 기록) */
  switchTo: (ledgerId: string) => void;
  /**
   * 목록을 다시 불러온다. prefer 를 주면(방금 만들거나 참여한 가계부) 그 가계부로,
   * 아니면 마지막으로 본 가계부 → 가장 최근에 참여한 가계부 순으로 고른다
   */
  reload: (prefer?: string) => Promise<void>;
}

const LedgersContext = createContext<LedgersValue | null>(null);

/** 마지막으로 본 가계부 기록. 실패해도 화면은 그대로 쓴다 (다음에 열 때 다른 가계부가 열릴 수 있을 뿐) */
function remember(ledgerId: string) {
  rememberLedger(ledgerId).catch(() => undefined);
}

/** 로그인한 사용자의 가계부 목록과 지금 보고 있는 가계부 */
export function LedgersProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const [state, setState] = useState<State>({ status: 'loading' });
  const seq = useRef(0);

  const load = useCallback(
    async (prefer?: string) => {
      const mine = ++seq.current;
      try {
        const [ledgers, lastId] = await Promise.all([listMyLedgers(user.id), getLastLedgerId(user.id)]);
        if (mine !== seq.current) return;
        const currentId =
          prefer && ledgers.some((l) => l.id === prefer) ? prefer : pickCurrentLedgerId(ledgers, lastId);
        setState({ status: 'ready', ledgers, currentId });
        // 저장된 값과 다르게 골랐으면(나갔거나 기록이 없음) 서버 기록도 맞춘다
        if (currentId && currentId !== lastId) remember(currentId);
      } catch {
        if (mine === seq.current) setState({ status: 'error' });
      }
    },
    [user.id],
  );

  useEffect(() => {
    setState({ status: 'loading' });
    void load();
  }, [load]);

  const reload = useCallback(
    (prefer?: string) => {
      setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
      return load(prefer);
    },
    [load],
  );

  const switchTo = useCallback((ledgerId: string) => {
    setState((s) => (s.status === 'ready' && s.ledgers.some((l) => l.id === ledgerId) ? { ...s, currentId: ledgerId } : s));
    remember(ledgerId);
  }, []);

  return <LedgersContext.Provider value={{ state, switchTo, reload }}>{children}</LedgersContext.Provider>;
}

export function useLedgers(): LedgersValue {
  const value = useContext(LedgersContext);
  if (!value) throw new Error('LedgersProvider 밖에서 useLedgers 사용');
  return value;
}

/** 지금 보고 있는 가계부 (RequireLedger 안에서만) */
export function useCurrentLedger(): MyLedger {
  const { state } = useLedgers();
  const current = state.status === 'ready' ? state.ledgers.find((l) => l.id === state.currentId) : undefined;
  if (!current) throw new Error('RequireLedger 밖에서 useCurrentLedger 사용');
  return current;
}
