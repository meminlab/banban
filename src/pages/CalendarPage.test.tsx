import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { App } from '../app/App';
import { AuthProvider } from '../app/auth';
import type { CalendarEvent, Member } from '../data/types';
import type { EventInput } from '../domain/event';

// ── 저장소 가짜: 메모리 DB (두 멤버가 같은 가계부를 공유)
const db = vi.hoisted(() => ({
  events: [] as CalendarEvent[],
  members: [] as Member[],
  togetherSince: null as string | null,
  failNext: null as null | 'list' | 'create' | 'pin',
  goneNext: false,
  seq: 0,
  created: [] as EventInput[],
}));

vi.mock('../data/auth', () => ({
  AUTH_CALLBACK_PATH: '/login',
  onAuthChange: (cb: (u: unknown) => void) => {
    queueMicrotask(() => cb({ id: 'u-a', email: 'a@example.com', name: '민지', avatarUrl: null }));
    return () => {};
  },
  signInWithGoogle: async () => {},
  signOut: async () => {},
}));
vi.mock('../data/ledger', () => ({
  listMyLedgers: async () => [{ id: 'L', name: '우리집', memberCount: 2, joinedAt: '2026-11-01T00:00:00Z' }],
  getLastLedgerId: async () => 'L',
  rememberLedger: async () => {},
  getLedger: async () => ({ id: 'L', name: '우리집', member_limit: 4, created_by: 'u-a', created_at: '', together_since: db.togetherSince }),
  setTogetherSince: vi.fn(async (_l: string, d: string | null) => {
    db.togetherSince = d;
  }),
}));
vi.mock('../data/profile', () => ({ getProfile: async () => null }));
vi.mock('../data/member', () => ({ listMembers: async () => db.members }));
vi.mock('../data/event', () => {
  class EventNotFoundError extends Error {}
  class EventPinLimitError extends Error {}
  const row = (ledgerId: string, input: EventInput, prev?: CalendarEvent): CalendarEvent => {
    const { pinned, ...rest } = input;
    return {
      id: prev?.id ?? `e${++db.seq}`,
      ledger_id: ledgerId,
      ...rest,
      pinned_at: pinned ? (prev?.pinned_at ?? '2026-11-09T00:00:00Z') : null,
      created_by: prev?.created_by ?? 'ma',
      updated_by: 'ma',
      created_at: prev?.created_at ?? `2026-11-09T00:00:${String(db.seq).padStart(2, '0')}Z`,
      updated_at: '2026-11-09T00:00:00Z',
    };
  };
  return {
    EventNotFoundError,
    EventPinLimitError,
    listEventsForRange: async () => {
      if (db.failNext === 'list') {
        db.failNext = null;
        throw new Error('network');
      }
      return db.events.map((e) => ({ ...e }));
    },
    hasAnyEvent: async () => db.events.length > 0,
    listPinnedEventIds: async () => db.events.filter((e) => e.pinned_at).map((e) => e.id),
    getEvent: async (id: string) => {
      const e = db.events.find((x) => x.id === id);
      return e ? { ...e } : null;
    },
    createEvent: async (ledgerId: string, input: EventInput) => {
      if (db.failNext === 'create') {
        db.failNext = null;
        throw new Error('network');
      }
      if (db.failNext === 'pin') {
        db.failNext = null;
        throw new EventPinLimitError();
      }
      db.created.push(input);
      const e = row(ledgerId, input);
      db.events.push(e);
      return e;
    },
    updateEvent: async (id: string, input: EventInput) => {
      const i = db.events.findIndex((x) => x.id === id);
      if (i < 0 || db.goneNext) throw new EventNotFoundError();
      db.events[i] = row(db.events[i].ledger_id, input, db.events[i]);
      return db.events[i];
    },
    deleteEvent: async (id: string) => {
      const i = db.events.findIndex((x) => x.id === id);
      if (i < 0) throw new EventNotFoundError();
      db.events.splice(i, 1);
    },
  };
});

const member = (id: string, name: string, joined_at: string): Member => ({
  id,
  ledger_id: 'L',
  user_id: `u-${id}`,
  role: 'member',
  display_name: name,
  joined_at,
  left_at: null,
});

const ev = (id: string, extra: Partial<CalendarEvent>): CalendarEvent => ({
  id,
  ledger_id: 'L',
  title: id,
  kind: 'appointment',
  event_date: '2026-11-09',
  all_day: true,
  start_time: null,
  repeat: 'none',
  lunar_month: null,
  lunar_day: null,
  target_member_id: null,
  place: null,
  memo: null,
  pinned_at: null,
  created_by: 'ma',
  updated_by: 'ma',
  created_at: `2026-11-01T00:00:0${id.length % 10}Z`,
  updated_at: '2026-11-01T00:00:00Z',
  ...extra,
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** 그 날짜 칸 버튼 (aria-label 이 "11월 14일 토요일, ..." 로 시작) */
async function dayCell(label: string) {
  // 달력 칸은 불러오기 전에도 그려지므로, 다 불러온 뒤(aria-busy=false)에 찾는다
  const cal = await screen.findByRole('region', { name: /일정 달력$/ });
  await waitFor(() => expect(cal).toHaveAttribute('aria-busy', 'false'));
  return screen.findByRole('button', { name: new RegExp(`^${label}`) });
}

beforeEach(() => {
  db.members = [member('ma', '민지', '2026-01-01T00:00:00Z'), member('mb', '준호', '2026-01-02T00:00:00Z')];
  db.events = [];
  db.togetherSince = null;
  db.failNext = null;
  db.goneNext = false;
  db.seq = 0;
  db.created = [];
});

describe('탭바 4개 + 가운데 ＋', () => {
  it('일정 탭에서는 ＋가 "일정 추가", 다른 탭에서는 "내역 추가"', async () => {
    const user = userEvent.setup();
    renderAt('/calendar?m=2026-11');
    const nav = await screen.findByRole('navigation', { name: '주요 메뉴' });
    const names = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('aria-label') ?? a.textContent);
    expect(names).toEqual(['홈', '가계부', '일정 추가', '일정', '자산']);
    expect(within(nav).getByRole('link', { name: '일정' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1, name: '일정' })).toBeInTheDocument();

    await user.click(within(nav).getByRole('link', { name: '가계부' }));
    expect(within(nav).getByRole('link', { name: '내역 추가' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: '일정 추가' })).not.toBeInTheDocument();
  });
});

describe('일정 탭 월 달력', () => {
  it('일정이 하나도 없으면 안내 문구 (해요체)', async () => {
    renderAt('/calendar?m=2026-11');
    expect(await screen.findByText('아직 일정이 없어요. ＋로 첫 일정을 남겨 보세요')).toBeInTheDocument();
    // 달력은 그대로 보인다
    expect(await dayCell('11월 30일 월요일, 일정 없음')).toBeInTheDocument();
  });

  it('반복을 펼쳐 그린다: 매주·매월 31일(→ 30일)·매년·음력 매년', async () => {
    db.events = [
      ev('풋살', { event_date: '2026-11-07', repeat: 'weekly', target_member_id: 'mb', all_day: false, start_time: '10:00:00' }),
      ev('카드값', { kind: 'bill_day', event_date: '2026-01-31', repeat: 'monthly' }),
      ev('결혼기념일', { kind: 'anniversary', event_date: '2020-11-14', repeat: 'yearly' }),
      ev('아버님 제사', { kind: 'anniversary', event_date: '2025-11-21', repeat: 'yearly_lunar', lunar_month: 10, lunar_day: 3 }),
    ];
    renderAt('/calendar?m=2026-11');
    // 매주 토요일
    for (const d of ['11월 7일 토요일', '11월 14일 토요일', '11월 21일 토요일', '11월 28일 토요일'])
      expect((await dayCell(d)).getAttribute('aria-label')).toContain('풋살 준호 오전 10시');
    // 매월 31일 → 11월은 30일
    expect((await dayCell('11월 30일 월요일')).getAttribute('aria-label')).toContain('카드값 함께');
    // 매년 11월 14일
    expect((await dayCell('11월 14일 토요일')).getAttribute('aria-label')).toContain('결혼기념일 함께');
    // 음력 10월 3일 → 2026년은 양력 11월 11일
    expect((await dayCell('11월 11일 수요일')).getAttribute('aria-label')).toContain('아버님 제사');
    expect(screen.queryByText('아직 일정이 없어요. ＋로 첫 일정을 남겨 보세요')).not.toBeInTheDocument();
  });

  it('한 칸 4개 이상이면 칩 2개 + "+n"', async () => {
    db.events = ['가', '나', '다', '라'].map((t) => ev(t, { event_date: '2026-11-14' }));
    renderAt('/calendar?m=2026-11');
    const cell = await dayCell('11월 14일 토요일, 일정 4개');
    expect(cell.querySelectorAll('.event-chip')).toHaveLength(2);
    expect(within(cell).getByText('+2')).toBeInTheDocument();
  });

  it('칩 색은 누구(함께 = 살구, 멤버 = 참여 순), 아이콘은 종류', async () => {
    db.events = [
      ev('함께 약속', { event_date: '2026-11-03' }),
      ev('준호 생일', { kind: 'anniversary', event_date: '2026-11-03', target_member_id: 'mb' }),
    ];
    renderAt('/calendar?m=2026-11');
    const chips = (await dayCell('11월 3일 화요일, 일정 2개')).querySelectorAll('.event-chip');
    expect(chips[0].className).toContain('event-color--2'); // 기념일 먼저, 준호 = 멤버 2
    expect(chips[1].className).toContain('event-color--together');
    expect(chips[0].querySelector('svg')).not.toBeNull();
  });

  it('날짜를 누르면 그날 목록 시트: 누구 · 시각 · 장소, 고정 배지', async () => {
    const user = userEvent.setup();
    db.events = [
      ev('레스토랑', { event_date: '2026-11-14', all_day: false, start_time: '19:00:00', place: '성수동' }),
      ev('결혼기념일', { kind: 'anniversary', event_date: '2020-11-14', repeat: 'yearly', pinned_at: '2026-11-01T00:00:00Z' }),
    ];
    renderAt('/calendar?m=2026-11');
    await user.click(await dayCell('11월 14일 토요일'));
    const sheet = await screen.findByRole('dialog', { name: '11월 14일 (토)' });
    const rows = within(sheet).getAllByRole('link').filter((a) => a.classList.contains('day-sheet__row'));
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('결혼기념일함께 · 매년 11월 14일'),
      '레스토랑함께 · 오후 7:00 · 성수동',
    ]);
    expect(within(rows[0]).getByText(/^D[-+]|D-day/)).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: '이 날 일정 추가' })).toBeInTheDocument();
  });

  it('빈 날 시트: 따뜻한 빈 화면 문구', async () => {
    const user = userEvent.setup();
    renderAt('/calendar?m=2026-11');
    await user.click(await dayCell('11월 20일 금요일'));
    expect(await screen.findByText('이 날은 아직 비어 있어요')).toBeInTheDocument();
  });

  it('월 이동: 주소에 달이 남는다', async () => {
    const user = userEvent.setup();
    renderAt('/calendar?m=2026-11');
    await user.click(await screen.findByRole('button', { name: '다음 달' }));
    expect(await dayCell('12월 31일 목요일')).toBeInTheDocument();
  });

  it('불러오지 못하면 다시 시도', async () => {
    const user = userEvent.setup();
    db.failNext = 'list';
    renderAt('/calendar?m=2026-11');
    expect(await screen.findByText('일정을 불러오지 못했어요. 네트워크를 확인해 주세요.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await dayCell('11월 1일 일요일')).toBeInTheDocument();
  });
});

describe('일정 추가·수정·삭제', () => {
  it('날짜 시트에서 "이 날 일정 추가" → 제목·누구·시각 → 저장하면 달력에 보인다', async () => {
    const user = userEvent.setup();
    renderAt('/calendar?m=2026-11');
    await user.click(await dayCell('11월 20일 금요일'));
    await user.click(await screen.findByRole('link', { name: '이 날 일정 추가' }));

    expect(await screen.findByRole('heading', { level: 1, name: '일정 추가' })).toBeInTheDocument();
    const save = screen.getByRole('button', { name: '저장' });
    expect(save).toBeDisabled(); // 제목 없음
    expect(screen.getByText('제목을 적어 주세요')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '약속' })).toBeChecked(); // 기본 = 약속
    expect(screen.getByRole('radio', { name: '함께' })).toBeChecked(); // 기본 = 함께
    expect(screen.getByRole('button', { name: /날짜/ })).toHaveTextContent('11월 20일 (금)');

    await user.type(screen.getByLabelText('제목'), '  치과  ');
    await user.click(screen.getByRole('radio', { name: '준호' }));
    await user.click(screen.getByRole('button', { name: '시각: 종일' }));
    await user.click(await screen.findByRole('radio', { name: '시각 정하기' }));
    await user.clear(screen.getByLabelText('시각', { selector: 'input' }));
    await user.type(screen.getByLabelText('시각', { selector: 'input' }), '14:30');
    await user.click(screen.getByRole('button', { name: '완료' }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('일정을 저장했어요')).toBeInTheDocument();
    expect(db.created[0]).toMatchObject({
      title: '치과',
      kind: 'appointment',
      event_date: '2026-11-20',
      all_day: false,
      start_time: '14:30:00',
      repeat: 'none',
      target_member_id: 'mb',
      pinned: false,
    });
    expect((await dayCell('11월 20일 금요일')).getAttribute('aria-label')).toContain('치과 준호 오후 2시 30분');
  });

  it('기념일 + 음력: 반복은 매년(음력), 올해 양력 날짜 안내, 음력 월·일 저장', async () => {
    const user = userEvent.setup();
    renderAt('/calendar?m=2026-11');
    await user.click(await dayCell('11월 11일 수요일'));
    await user.click(await screen.findByRole('link', { name: '이 날 일정 추가' }));
    await user.type(await screen.findByLabelText('제목'), '아버님 제사');
    await user.click(screen.getByRole('radio', { name: '기념일' }));
    await user.click(screen.getByRole('button', { name: /날짜/ }));
    const sheet = await screen.findByRole('dialog', { name: '날짜' });
    await user.click(within(sheet).getByRole('radio', { name: '음력' }));
    expect(within(sheet).getByLabelText('음력 월')).toHaveValue('10');
    expect(within(sheet).getByLabelText('음력 일')).toHaveValue('3');
    expect(within(sheet).getByRole('status')).toHaveTextContent('11월 11일 (수)');
    await user.click(within(sheet).getByRole('button', { name: '이 날짜로 할게요' }));

    expect(screen.getByRole('button', { name: /날짜/ })).toHaveTextContent('음력 10월 3일');
    expect(screen.getByRole('button', { name: '반복: 매년 (음력)' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('일정을 저장했어요')).toBeInTheDocument();
    expect(db.created[0]).toMatchObject({ kind: 'anniversary', event_date: '2026-11-11', repeat: 'yearly_lunar', lunar_month: 10, lunar_day: 3 });
  });

  it('반복 시트: 29~31일 매월 안내, 음력은 기념일만', async () => {
    const user = userEvent.setup();
    renderAt('/calendar?m=2026-10');
    await user.click(await dayCell('10월 31일 토요일'));
    await user.click(await screen.findByRole('link', { name: '이 날 일정 추가' }));
    await user.click(await screen.findByRole('button', { name: '반복: 반복 안 함' }));
    const sheet = await screen.findByRole('dialog', { name: '반복' });
    expect(within(sheet).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual([
      '안 함',
      '매주 (토요일)',
      '매월 (31일)',
      '매년 (10월 31일)',
    ]);
    expect(within(sheet).getByText('매월은 짧은 달은 말일에 보여요')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('radio', { name: '매월 (31일)' }));
    expect(screen.getByRole('button', { name: '반복: 매월' })).toBeInTheDocument();
  });

  it('D-day 고정은 기념일만, 이미 2개면 비활성 + 안내', async () => {
    const user = userEvent.setup();
    db.events = [
      ev('결혼기념일', { kind: 'anniversary', event_date: '2020-06-12', repeat: 'yearly', pinned_at: '2026-01-01T00:00:00Z' }),
      ev('첫 만남', { kind: 'anniversary', event_date: '2019-03-02', repeat: 'yearly', pinned_at: '2026-01-02T00:00:00Z' }),
    ];
    renderAt('/calendar?m=2026-11');
    await user.click(await dayCell('11월 20일 금요일'));
    await user.click(await screen.findByRole('link', { name: '이 날 일정 추가' }));
    await screen.findByLabelText('제목');
    expect(screen.queryByRole('switch', { name: /홈에 D-day 고정/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '기념일' }));
    const pin = screen.getByRole('switch', { name: /홈에 D-day 고정/ });
    expect(pin).toBeDisabled();
    expect(screen.getByText('이미 2개를 고정했어요 · 다른 기념일의 고정을 풀어 주세요')).toBeInTheDocument();
  });

  it('고정 1개일 때는 켤 수 있고, 서버가 2개 초과로 거부하면 안내', async () => {
    const user = userEvent.setup();
    db.events = [ev('결혼기념일', { kind: 'anniversary', event_date: '2020-06-12', repeat: 'yearly', pinned_at: '2026-01-01T00:00:00Z' })];
    renderAt('/calendar?m=2026-11');
    await user.click(await dayCell('11월 20일 금요일'));
    await user.click(await screen.findByRole('link', { name: '이 날 일정 추가' }));
    await user.type(await screen.findByLabelText('제목'), '준호 생일');
    await user.click(screen.getByRole('radio', { name: '기념일' }));
    expect(screen.getByText('2개까지 · 지금 1개 고정됨')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: /홈에 D-day 고정/ }));
    expect(screen.getByText('2개까지 · 지금 2개 고정됨')).toBeInTheDocument();
    db.failNext = 'pin'; // 그 사이 다른 멤버가 고정
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 2개를 고정했어요');
    expect(screen.getByRole('switch', { name: /홈에 D-day 고정/ })).not.toBeChecked();
  });

  it('저장 실패: 안내하고 화면은 그대로', async () => {
    const user = userEvent.setup();
    renderAt('/calendar?m=2026-11');
    await user.click(await dayCell('11월 20일 금요일'));
    await user.click(await screen.findByRole('link', { name: '이 날 일정 추가' }));
    await user.type(await screen.findByLabelText('제목'), '치과');
    db.failNext = 'create';
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('저장하지 못했어요');
    expect(screen.getByLabelText('제목')).toHaveValue('치과');
  });

  it('수정: 값이 채워져 있고, 반복 일정 안내. 삭제는 확인 후 모든 날짜에서 사라진다', async () => {
    const user = userEvent.setup();
    db.events = [ev('요가', { event_date: '2026-11-02', repeat: 'weekly', place: '집 앞' })];
    renderAt('/calendar?m=2026-11');
    await user.click(await dayCell('11월 9일 월요일'));
    await user.click(await screen.findByRole('link', { name: /요가/ }));
    expect(await screen.findByRole('heading', { level: 1, name: '일정 수정' })).toBeInTheDocument();
    expect(screen.getByLabelText('제목')).toHaveValue('요가');
    expect(screen.getByRole('button', { name: '장소: 집 앞' })).toBeInTheDocument();
    expect(screen.getByText('반복 일정은 모든 날짜에 함께 바뀌어요')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '삭제' }));
    const dialog = await screen.findByRole('alertdialog', { name: "'요가'을(를) 삭제할까요?" });
    expect(dialog).toHaveTextContent('모든 날짜의 일정이 지워져요');
    await user.click(within(dialog).getByRole('button', { name: '삭제하기' }));
    expect(await screen.findByText('일정을 삭제했어요')).toBeInTheDocument();
    expect(await dayCell('11월 9일 월요일, 일정 없음')).toBeInTheDocument();
    expect(db.events).toHaveLength(0);
  });

  it('다른 멤버가 지운 일정을 저장하면 "삭제된 일정이에요"', async () => {
    const user = userEvent.setup();
    db.events = [ev('치과', { event_date: '2026-11-20' })];
    renderAt('/calendar?m=2026-11');
    await user.click(await dayCell('11월 20일 금요일'));
    await user.click(await screen.findByRole('link', { name: /치과/ }));
    await screen.findByRole('heading', { level: 1, name: '일정 수정' });
    db.goneNext = true;
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('삭제된 일정이에요')).toBeInTheDocument();
  });

  it('없는 일정 주소로 들어오면 안내', async () => {
    renderAt('/calendar/nope');
    expect(await screen.findByRole('alert')).toHaveTextContent('삭제된 일정이에요');
  });
});

describe('설정 › 함께한 날', () => {
  it('정하지 않음 → 날짜를 골라 저장 → 값 표시, 지우기', async () => {
    const user = userEvent.setup();
    renderAt('/settings');
    const row = await screen.findByRole('button', { name: /함께한 날/ });
    expect(await within(row).findByText('정하지 않음')).toBeInTheDocument();
    await user.click(row);
    const sheet = await screen.findByRole('dialog', { name: '함께한 날' });
    expect(within(sheet).queryByRole('button', { name: '지우기' })).not.toBeInTheDocument();
    const save = within(sheet).getByRole('button', { name: '저장' });
    expect(save).toBeDisabled();
    await user.type(within(sheet).getByLabelText('함께한 날'), '2021-06-12');
    await user.click(save);
    expect(await screen.findByText('함께한 날을 저장했어요')).toBeInTheDocument();
    expect(row).toHaveTextContent('2021년 6월 12일');
    expect(db.togetherSince).toBe('2021-06-12');

    await user.click(row);
    await user.click(within(await screen.findByRole('dialog', { name: '함께한 날' })).getByRole('button', { name: '지우기' }));
    expect(await screen.findByText('함께한 날을 지웠어요')).toBeInTheDocument();
    expect(db.togetherSince).toBeNull();
  });

  it('오늘 이후 날짜는 저장할 수 없다', async () => {
    const user = userEvent.setup();
    renderAt('/settings');
    await user.click(await screen.findByRole('button', { name: /함께한 날/ }));
    const sheet = await screen.findByRole('dialog', { name: '함께한 날' });
    await user.type(within(sheet).getByLabelText('함께한 날'), '2099-01-01');
    expect(within(sheet).getByText('오늘 이후 날짜는 고를 수 없어요')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: '저장' })).toBeDisabled();
  });
});
