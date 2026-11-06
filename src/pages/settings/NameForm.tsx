import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { checkName, NAME_MAX } from '../../domain/catalog';

/** 이름 입력 + 저장 버튼. 1~20자 검사 후 onSubmit(앞뒤 공백 뺀 이름) */
export function NameForm({
  initial = '',
  submitLabel,
  busy,
  hint,
  extra,
  autoFocus,
  onSubmit,
}: {
  initial?: string;
  submitLabel: string;
  busy: boolean;
  hint?: string;
  /** 이름 아래·저장 버튼 위에 넣을 추가 입력 */
  extra?: ReactNode;
  /** 추가 시트처럼 바로 입력하는 곳에서만 */
  autoFocus?: boolean;
  onSubmit: (name: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const checked = checkName(value);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError(null);
    onSubmit(checked.value);
  }

  return (
    <form className="sheet__section" onSubmit={submit} noValidate>
      <label className="sheet__label" htmlFor={`${id}-name`}>
        이름
      </label>
      <input
        id={`${id}-name`}
        className="text-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
        autoFocus={autoFocus}
        enterKeyHint="done"
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-help`}
      />
      <p id={`${id}-help`} className={error ? 'form-error' : 'hint'} role={error ? 'alert' : undefined}>
        {error ?? hint ?? `${NAME_MAX}자까지 쓸 수 있어요.`}
      </p>
      {extra}
      <button type="submit" className="button button--primary button--block" disabled={busy}>
        {busy ? '저장하는 중…' : submitLabel}
      </button>
    </form>
  );
}
