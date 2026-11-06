import { useState } from 'react';

/** 프로필 이미지. 없거나 못 불러오면 이름 첫 글자 */
export function Avatar({ name, src, size = 48 }: { name: string; src: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (src && !failed) {
    return (
      <img
        className="avatar"
        style={style}
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="avatar avatar--initial" style={style} aria-hidden="true">
      {name.trim().charAt(0) || '?'}
    </span>
  );
}
