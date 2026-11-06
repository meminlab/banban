import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentUser } from '../app/auth';
import { copyText } from '../app/clipboard';
import { useLedgerId } from '../app/guards';
import { useLedgers } from '../app/ledgers';
import { SETTINGS_PATH } from '../app/routes';
import { useLoad } from '../app/useLoad';
import { StatusScreen } from '../components/StatusScreen';
import { SubPageTopbar } from '../components/SubPageTopbar';
import { getCurrentInvite, getLedger, issueInvite, leaveLedger, listMembers } from '../data/ledger';
import type { Invite, Ledger, Member } from '../data/types';
import { buildInviteLink, formatInviteExpiry, isInviteUsable } from '../lib/ledgerRules';

interface Data {
  ledger: Ledger;
  members: Member[];
  invite: Invite | null;
}

async function loadAll(ledgerId: string): Promise<Data> {
  const [ledger, members, invite] = await Promise.all([
    getLedger(ledgerId),
    listMembers(ledgerId),
    getCurrentInvite(ledgerId),
  ]);
  return { ledger, members, invite };
}

/** 설정 > 멤버·초대: 멤버 목록, 초대 링크/코드 발급·복사, 나가기 */
export function MembersPage() {
  const ledgerId = useLedgerId();
  const { state, reload, setData } = useLoad(() => loadAll(ledgerId), [ledgerId]);

  if (state.status === 'loading') return <StatusScreen kind="loading" message="멤버를 불러오고 있어요" />;
  if (state.status === 'error')
    return <StatusScreen kind="error" message="멤버를 불러오지 못했어요. 네트워크를 확인해 주세요." onRetry={reload} />;

  const { ledger, members, invite } = state.data;
  const active = members.filter((m) => m.left_at === null);

  return (
    <div className="shell">
      <SubPageTopbar title="멤버·초대" fallback={SETTINGS_PATH} />
      <main className="content content--no-tabbar members">
        <MemberList members={members} activeCount={active.length} limit={ledger.member_limit} />
        <InviteSection
          ledgerId={ledgerId}
          invite={invite}
          isFull={active.length >= ledger.member_limit}
          limit={ledger.member_limit}
          onIssued={(next) => setData({ ...state.data, invite: next })}
        />
        <LeaveSection ledgerId={ledgerId} isLast={active.length <= 1} />
      </main>
    </div>
  );
}

function MemberList({ members, activeCount, limit }: { members: Member[]; activeCount: number; limit: number }) {
  const me = useCurrentUser();
  // 현재 멤버 먼저(참여 순), 나간 사람은 뒤에
  const sorted = [...members].sort((a, b) => Number(a.left_at !== null) - Number(b.left_at !== null));
  return (
    <section aria-labelledby="members-title">
      <h2 id="members-title" className="section-title">
        멤버 <span className="section-title__sub">{activeCount}/{limit}명</span>
      </h2>
      <ul className="member-list">
        {sorted.map((m) => (
          <li key={m.id} className={`member-list__item${m.left_at ? ' is-left' : ''}`}>
            <span className="member-list__name">
              {m.display_name}
              {m.left_at && ' (나감)'}
            </span>
            {m.user_id === me.id && m.left_at === null && <span className="badge">나</span>}
            {m.role === 'owner' && m.left_at === null && <span className="badge badge--primary">대표</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

type CopyStatus = { target: 'link' | 'code'; ok: boolean } | null;

function InviteSection({
  ledgerId,
  invite,
  isFull,
  limit,
  onIssued,
}: {
  ledgerId: string;
  invite: Invite | null;
  isFull: boolean;
  limit: number;
  onIssued: (invite: Invite) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState<CopyStatus>(null);

  useEffect(() => {
    if (!copied?.ok) return;
    const t = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(t);
  }, [copied]);

  const usable = invite && isInviteUsable(invite) ? invite : null;
  const expired = invite !== null && usable === null;
  const link = usable ? buildInviteLink(window.location.origin, usable.code) : '';

  async function issue() {
    setBusy(true);
    setError(false);
    setCopied(null);
    try {
      onIssued(await issueInvite(ledgerId));
      setConfirming(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function copy(target: 'link' | 'code', text: string) {
    setCopied({ target, ok: await copyText(text) });
  }

  return (
    <section aria-labelledby="invite-title" className="form-card">
      <h2 id="invite-title" className="form-card__title">
        초대하기
      </h2>
      {isFull && (
        <p className="notice" role="note">
          지금은 인원이 가득 찼어요. 현재 최대 {limit}명까지 참여할 수 있어서, 초대해도 참여할 수 없어요.
        </p>
      )}

      {usable ? (
        <>
          <p className="hint">링크나 코드를 함께 쓸 사람에게 보내 주세요.</p>
          <p className="invite-code" aria-label={`초대 코드 ${usable.code.split('').join(' ')}`}>
            {usable.code}
          </p>
          <p className="invite-link">{link}</p>
          <p className="hint">{formatInviteExpiry(usable.expires_at)} 쓸 수 있어요.</p>
          <div className="form-card__actions">
            <button type="button" className="button button--primary" onClick={() => copy('link', link)}>
              링크 복사
            </button>
            <button type="button" className="button button--secondary" onClick={() => copy('code', usable.code)}>
              코드 복사
            </button>
          </div>
          {copied && (
            <p className={copied.ok ? 'form-success' : 'form-error'} role="status">
              {copied.ok
                ? `${copied.target === 'link' ? '링크를' : '코드를'} 복사했어요.`
                : '복사하지 못했어요. 위 글자를 길게 눌러 직접 복사해 주세요.'}
            </p>
          )}
        </>
      ) : (
        <p className="hint">
          {expired ? '초대 코드가 만료됐어요. 새로 만들어 주세요.' : '아직 만든 초대 코드가 없어요.'}
        </p>
      )}

      {error && (
        <p className="form-error" role="alert">
          초대 코드를 만들지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.
        </p>
      )}

      {usable && confirming ? (
        <div className="inline-confirm" role="group" aria-label="새로 발급 확인">
          <p>새로 발급하면 지금 코드와 링크는 더 이상 쓸 수 없어요.</p>
          <div className="form-card__actions">
            <button type="button" className="button button--secondary" onClick={() => setConfirming(false)} disabled={busy}>
              취소
            </button>
            <button type="button" className="button button--primary" onClick={issue} disabled={busy}>
              {busy ? '발급하는 중…' : '새로 발급'}
            </button>
          </div>
        </div>
      ) : usable ? (
        <button type="button" className="button button--secondary button--block" onClick={() => setConfirming(true)}>
          새로 발급
        </button>
      ) : (
        <button type="button" className="button button--primary button--block" onClick={issue} disabled={busy}>
          {busy ? '만드는 중…' : '초대 코드 만들기'}
        </button>
      )}
    </section>
  );
}

function LeaveSection({ ledgerId, isLast }: { ledgerId: string; isLast: boolean }) {
  const navigate = useNavigate();
  const { reload } = useLedgers();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function leave() {
    setBusy(true);
    setError(false);
    try {
      await leaveLedger(ledgerId);
      // 남은 가계부 중 가장 최근에 참여한 곳으로 전환, 없으면 시작 화면 (RequireLedger 가 보낸다)
      await reload();
      navigate('/', { replace: true });
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <section aria-label="가계부 나가기" className="leave">
      {error && (
        <p className="form-error" role="alert">
          나가지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.
        </p>
      )}
      {confirming ? (
        <div className="inline-confirm" role="group" aria-label="나가기 확인">
          <p>
            가계부에서 나가면 이 가계부를 더 이상 볼 수 없어요. 내가 기록한 내역은 그대로 남아요.
            {isLast && ' 마지막 멤버라서 나가면 가계부가 보관되고 아무도 볼 수 없어요.'}
          </p>
          <div className="form-card__actions">
            <button type="button" className="button button--secondary" onClick={() => setConfirming(false)} disabled={busy}>
              취소
            </button>
            <button type="button" className="button button--danger" onClick={leave} disabled={busy}>
              {busy ? '나가는 중…' : '나가기'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="button button--danger-outline button--block" onClick={() => setConfirming(true)}>
          가계부 나가기
        </button>
      )}
    </section>
  );
}
