-- BANB-16 가계부 인원 상한 2명 → 4명 (기존 가계부 포함, 클라이언트 요청)
--   * 새 가계부: member_limit 기본값 4
--   * 기존 가계부: 모두 4로 맞춘다
--   * member_limit은 여전히 화면·API로 못 바꾼다 (authenticated 에는 ledger.name 컬럼 update 권한만 있음 — 변경 없음)
--   * 되돌리기: 같은 방식으로 default·값을 2로 바꾸는 마이그레이션 1개

alter table public.ledger alter column member_limit set default 4;

update public.ledger set member_limit = 4 where member_limit <> 4;
