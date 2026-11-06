import { formatWon } from '../domain/format';

/**
 * 금액 글자 "1,234원". 음수면 보이는 것은 "−52,000원", 화면낭독은 "마이너스 52,000원" (design.md 2.3).
 * '−' 기호는 기기마다 "빼기/하이픈"으로 읽거나 건너뛰므로 숨기고 단어를 넣는다. 색은 감싼 요소가 정한다.
 */
export function WonText({ amount }: { amount: number }) {
  if (amount >= 0) return <>{formatWon(amount)}</>;
  return (
    <>
      <span aria-hidden="true">{formatWon(amount)}</span>
      <span className="sr-only">마이너스 {formatWon(-amount)}</span>
    </>
  );
}
