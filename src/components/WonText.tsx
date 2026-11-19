import { Fragment, type ReactNode } from 'react';
import { MINUS, formatWon } from '../domain/format';
import { wonGroups } from '../domain/money';

/**
 * 금액 글자를 쉼표 덩어리로 나눠 그린다 (design.md 2.3·5.4, BANB-15).
 * - 줄바꿈은 쉼표 뒤에서만(<wbr>). 덩어리 안은 nowrap이라 숫자 중간·숫자와 "원" 사이·부호(−, ▲▼)와 숫자 사이는 끊기지 않는다.
 *   감싼 요소가 `white-space: normal`(`.money--wrap`)일 때만 실제로 줄이 바뀐다.
 * - `smallUnit`: "원"을 한 단계 작게(0.75em/600) — hero·xl 금액에서만. 17px 이하 금액은 같은 크기.
 * - 화면낭독 글자는 감싼 요소가 맡는다(여기서는 보이는 글자만).
 */
export function WonParts({ amount, lead, smallUnit }: { amount: number; lead?: ReactNode; smallUnit?: boolean }) {
  const groups = wonGroups(amount);
  const last = groups.length - 1;
  return (
    <>
      {groups.map((g, i) => (
        <Fragment key={i}>
          <span className="money__group">
            {i === 0 && lead}
            {i === 0 && amount < 0 && MINUS}
            {g}
            {i < last ? ',' : <span className={smallUnit ? 'money__unit' : undefined}>원</span>}
          </span>
          {i < last && <wbr />}
        </Fragment>
      ))}
    </>
  );
}

/**
 * 금액 글자 "1,234원". 음수면 보이는 것은 "−52,000원", 화면낭독은 "마이너스 52,000원" (design.md 2.3).
 * '−' 기호는 기기마다 "빼기/하이픈"으로 읽거나 건너뛰므로 숨기고 단어를 넣는다. 색은 감싼 요소가 정한다.
 */
export function WonText({ amount, smallUnit }: { amount: number; smallUnit?: boolean }) {
  if (amount >= 0) return smallUnit ? <WonParts amount={amount} smallUnit /> : <>{formatWon(amount)}</>;
  return (
    <>
      <span aria-hidden="true">
        <WonParts amount={amount} smallUnit={smallUnit} />
      </span>
      <span className="sr-only">마이너스 {formatWon(-amount)}</span>
    </>
  );
}
