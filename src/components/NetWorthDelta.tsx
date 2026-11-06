import { formatWon } from '../domain/money';

/** 순자산 등 부호 있는 금액: 음수는 U+2212 "−" (design.md 2.3) */
export function signedWon(n: number): string {
  return n < 0 ? `−${formatWon(-n)}` : formatWon(n);
}

/** 화면낭독용 증감 문장 (design.md 5.21) */
export function deltaSpeech(value: number | null, label: string): string {
  if (value === null) return `${label} 기록이 없어요`;
  if (value === 0) return `${label} 변동 없음`;
  return `${label} ${formatWon(Math.abs(value))}원 ${value > 0 ? '늘었어요' : '줄었어요'}`;
}

/** 증감 ▲▼ (design.md 5.21): 늘면 delta-up, 줄면 delta-down(회색), 이력 없으면 "–" */
export function Delta({ value, label }: { value: number | null; label: string }) {
  // 보이는 글자는 aria-hidden, 화면낭독은 sr-only 문장으로 (역할 없는 요소의 aria-label은 읽히지 않을 수 있음)
  if (value === null)
    return (
      <p className="delta">
        <span aria-hidden="true">{label} –</span>
        <span className="sr-only">{deltaSpeech(value, label)}</span>
      </p>
    );
  if (value === 0) return <p className="delta">{label} 변동 없음</p>;
  const up = value > 0;
  const amount = `${formatWon(Math.abs(value))}원`;
  return (
    <p className={`delta ${up ? 'delta--up' : 'delta--down'}`}>
      <span aria-hidden="true">
        <span className="delta__label">{label}</span>{' '}
        <span className="delta__value money">
          <span className="delta__arrow">{up ? '▲' : '▼'}</span> {amount}
        </span>
      </span>
      <span className="sr-only">{deltaSpeech(value, label)}</span>
    </p>
  );
}
