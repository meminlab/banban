import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { listOpenGames, subscribeLedgerGames, sweepGames } from '../data/game';
import { listMembers } from '../data/member';
import type { Game, Member } from '../data/types';
import { isOpenStatus } from '../domain/omok';
import { useCurrentUser } from './auth';
import { useLedgerId } from './guards';

/**
 * 같이 놀기 (BANB-49): 지금 가계부의 진행 중인 판(초대·대국)을 실시간으로 들고 있는 틀.
 * 초대 배너·홈 카드·판 화면이 같은 목록을 쓴다. 불러오기에 실패해도 다른 화면은 막지 않는다(판 관련 표시만 숨김).
 */
export interface GamesValue {
  /** 진행 중인 판 (서버 상태 invited·active). 지난 초대·멈춘 판 거르기는 domain/omok effectiveStatus */
  open: Game[];
  /** 이 가계부의 멤버 (나간 멤버 포함 — 지난 판의 이름) */
  members: Member[];
  /** 이 가계부에서 내 member id (불러오기 전·실패 시 null) */
  me: string | null;
  ready: boolean;
  /** 처음 불러오기 실패 (다시 시도는 refresh) */
  failed: boolean;
  /** 서버 값으로 다시 맞춘다 (지난 초대·멈춘 판 닫기 포함) */
  refresh: () => void;
  /** 방금 받은 판 결과를 목록에 바로 반영 (실시간 도착 전) */
  upsert: (game: Game) => void;
}

const GamesContext = createContext<GamesValue | null>(null);

function upsertOpen(list: Game[], game: Game): Game[] {
  const rest = list.filter((g) => g.id !== game.id);
  return isOpenStatus(game.status) ? [game, ...rest].sort((a, b) => b.created_at.localeCompare(a.created_at)) : rest;
}

/** RequireLedger 안에서 모든 화면을 감싼다 */
export function GamesLayout() {
  const ledgerId = useLedgerId();
  const user = useCurrentUser();
  const [open, setOpen] = useState<Game[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  const refresh = useCallback(() => {
    const mine = ++seq.current;
    // 닫기는 실패해도 목록은 받는다 (화면은 effectiveStatus 로 거른다)
    sweepGames(ledgerId)
      .catch(() => undefined)
      .then(() => Promise.all([listOpenGames(ledgerId), listMembers(ledgerId)]))
      .then(
        ([games, ms]) => {
          if (mine !== seq.current) return;
          setOpen(games);
          setMembers(ms);
          setReady(true);
          setFailed(false);
        },
        () => mine === seq.current && setFailed(true),
      );
  }, [ledgerId]);

  useEffect(() => {
    let stop = () => {};
    try {
      stop = subscribeLedgerGames(ledgerId, {
        onGame: (g) => setOpen((list) => upsertOpen(list, g)),
        onResync: refresh,
      });
    } catch {
      // 실시간 연결을 못 열면(설정 없음 등) 한 번 불러오기만 한다
      refresh();
    }
    // 앱을 다시 열면(백그라운드 → 앞) 서버 값으로 맞춘다
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ledgerId, refresh]);

  const upsert = useCallback((g: Game) => setOpen((list) => upsertOpen(list, g)), []);
  const me = useMemo(
    () => members.find((m) => m.user_id === user.id && m.left_at === null)?.id ?? null,
    [members, user.id],
  );

  return (
    <GamesContext.Provider value={{ open, members, me, ready, failed, refresh, upsert }}>
      <Outlet />
    </GamesContext.Provider>
  );
}

/** 틀 밖(단독 화면 테스트 등)에서는 빈 값 — 같이 놀기 표시만 숨겨진다 */
const EMPTY: GamesValue = {
  open: [],
  members: [],
  me: null,
  ready: false,
  failed: false,
  refresh: () => undefined,
  upsert: () => undefined,
};

export function useGames(): GamesValue {
  return useContext(GamesContext) ?? EMPTY;
}

/** 1초(또는 ms)마다 바뀌는 지금 시각 — 초대 남은 시간·만료 표시 */
export function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** member id → 이름 (모르면 "상대") */
export function useMemberName(): (memberId: string) => string {
  const { members } = useGames();
  return useCallback((id: string) => members.find((m) => m.id === id)?.display_name ?? '상대', [members]);
}
