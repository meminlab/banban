import { useEffect, useId, useState, type FormEvent } from 'react';

/**
 * 설정 하위 화면의 이름 바꾸기 폼 (가계부 이름 · 내 이름 공통).
 * 입력하는 동안 검사해서, 규칙에 안 맞으면 안내 문구를 보여 주고 저장 버튼을 끈다. 바뀐 게 없어도 끈다.
 * 저장에 실패하면 저장된 값은 그대로 두고 오류를 알린다(입력한 값은 남겨 다시 시도할 수 있게).
 */
export function RenameForm({
  label,
  initial,
  hint,
  validate,
  save,
}: {
  label: string;
  initial: string;
  /** 규칙에 맞을 때 입력칸 아래 보조 문구 */
  hint: string;
  /** 문제없으면 null, 있으면 안내 문구 */
  validate: (raw: string) => string | null;
  /** 앞뒤 공백을 뺀 이름을 저장한다. 실패하면 던진다 */
  save: (name: string) => Promise<void>;
}) {
  const id = useId();
  const [name, setName] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saveError, setSaveError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 2500);
    return () => clearTimeout(t);
  }, [done]);

  const invalid = validate(name);
  const unchanged = name.trim() === saved;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (invalid || unchanged || busy) return;
    const next = name.trim();
    setBusy(true);
    setSaveError(false);
    setDone(false);
    try {
      await save(next);
      setSaved(next);
      setName(next);
      setDone(true);
    } catch {
      setSaveError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-card" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={`${id}-name`} className="field__label">
          {label}
        </label>
        <input
          id={`${id}-name`}
          className="field__input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDone(false);
            setSaveError(false);
          }}
          autoComplete="off"
          enterKeyHint="done"
          aria-invalid={invalid ? true : undefined}
          aria-describedby={`${id}-help`}
        />
        <span id={`${id}-help`} className={invalid ? 'form-error' : 'hint'} role={invalid ? 'alert' : undefined}>
          {invalid ?? hint}
        </span>
      </div>
      {saveError && (
        <p className="form-error" role="alert">
          저장하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.
        </p>
      )}
      {done && (
        <p className="form-success" role="status">
          저장했어요.
        </p>
      )}
      <button type="submit" className="button button--primary button--block" disabled={busy || unchanged || invalid !== null}>
        {busy ? '저장하는 중…' : '저장'}
      </button>
    </form>
  );
}
