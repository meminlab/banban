# banban

부부(나중엔 n명)가 같이 쓰는 공동 가계부. 모바일 웹.

## 기술 스택 (운영 비용 0원)

| 영역 | 선택 | 이유 |
|---|---|---|
| 화면 | React + TypeScript + Vite | 정적 파일로 빌드돼서 무료 호스팅에 그대로 올라간다 |
| DB·인증 | **Supabase 무료 요금제** | Postgres + 구글 로그인 + 행 단위 권한(RLS)을 서버 없이 쓸 수 있다. 무료 한도(DB 500MB, 월간 활성 사용자 5만)가 2인 가계부에 충분하다 |
| 호스팅 | **Cloudflare Pages 무료 요금제** | 대역폭 무제한·상업적 사용 제한 없음, GitHub 연결 시 `main` 푸시마다 자동 배포, PR마다 미리보기 URL |
| 테스트 | Vitest + Testing Library / Docker Postgres | 화면 테스트, 스키마·권한 규칙 테스트 |

> Supabase 무료 프로젝트는 **7일 동안 요청이 없으면 일시 정지**된다. 대시보드에서 다시 켜면 데이터는 그대로다. (비용 발생 없음)

### 폴더 구조

```
src/
  app/          라우팅, 탭 정의, 로그인 상태(auth.tsx), 화면 접근 규칙(guards.tsx)
  components/   공통 UI (상단바·하단 탭·아이콘)
  pages/        화면 (홈 / 가계부 / 자산 / 설정)
  data/         저장소 접근은 여기서만 (supabase 클라이언트, DB 행 타입)
  domain/       화면과 분리된 집계·계산·검사 순수 함수 (월 요약, 월 계산 KST, 금액 표시, 내역 입력 검사) — 단위 테스트 동반
supabase/
  migrations/   DB 스키마·권한 규칙 (SQL)
  tests/        스키마·권한 규칙 테스트 (Docker로 실행)
```

## 로컬 실행

필요: Node.js 20 이상 (권장 22)

```bash
npm install
cp .env.example .env.local   # Supabase 값 입력 (지금 단계 화면은 값 없이도 뜬다)
npm run dev                  # http://localhost:5173
```

휴대폰 폭 확인: 브라우저 개발자 도구 → 기기 모드 → 폭 360px.

| 명령 | 내용 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 타입 검사 + 배포용 빌드 (`dist/`) |
| `npm test` | 화면 테스트 |
| `npm run test:db` | 스키마·권한 규칙 테스트 (Docker 필요. Postgres 컨테이너를 띄워 마이그레이션 적용 후 검사하고 지움). `STRICT=1`이면 테이블 자동 노출을 끈 프로젝트 조건으로 검사 |
| `SUPABASE_URL=… SUPABASE_KEY=… npx vitest run src/data/catalog.integration.test.ts` | 카테고리·주머니 저장소 함수를 실제 Supabase API로 확인 (두 멤버 간 변경 반영, 숨김 후 지난 내역 이름, N1 거부). **로컬 Supabase 전용**. 환경변수가 없으면 `npm test`에서 건너뛴다 |
| `node supabase/tests/api_flow.mjs` | 가입 → 가계부 생성 → 초대 → 참여 흐름을 실제 Supabase API로 확인. **로컬 Supabase(`npx supabase start`) 전용** — 테스트 계정을 만들므로 운영 프로젝트에는 돌리지 않는다. `SUPABASE_URL`, `SUPABASE_KEY`(publishable) 필요 |
| `node supabase/tests/asset_flow.mjs` | 자산 추가·수정·삭제·값 검증·외부인 차단을 실제 Supabase API로 확인. **로컬 Supabase 전용**, 환경변수는 위와 같음 |
| `node supabase/tests/transaction_flow.mjs` | 내역 입력 → 다른 멤버가 수정(마지막 수정자 바뀜) → 삭제 → 삭제된 내역 저장 시 0행 흐름을 실제 Supabase API로 확인. 로컬 Supabase 전용, 환경변수는 위와 같음 |

### 환경변수

| 이름 | 값 | 비고 |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL | 프로젝트 설정 → API |
| `VITE_SUPABASE_ANON_KEY` | publishable key (`sb_publishable_...`) 또는 예전 anon key | 브라우저에 노출돼도 되는 키. 실제 권한은 RLS가 막는다. **secret / service_role 키는 절대 넣지 않는다** |

## Supabase 준비 (최초 1회)

운영 프로젝트: `ryubtqzwqswmsrbiuorp` (리전 **Tokyo, ap-northeast-1**)

1. https://supabase.com 에서 무료 프로젝트 생성
2. **스키마 적용** — SQL Editor에서 아래 순서로 실행 (각 파일 전체 내용을 붙여넣고 Run)
   1. `supabase/migrations/` 의 파일을 **이름 순서대로, 각각 한 번만** 실행 (다시 실행하면 "already exists" 오류)
      - `20261105000000_init.sql` — 스키마·권한 규칙
      - `20261105010000_category_depth_invite_rules.sql` — 카테고리 2단계, 초대 만료·무효 규칙 보강
      - `20261106000000_profile.sql` — 사용자 프로필(구글 이름·이미지) 테이블과 자동 저장 트리거
      - `20261106120000_ledger_leave_rejoin.sql` — 가계부 나가기(owner 자동 승계·보관), 다시 참여 시 예전 멤버 연결, 보관된 가계부 초대 무효
      - `20261106130000_category_in_use_stays_child.sql` — 내역에 쓰인 소분류는 대분류로 바꿀 수 없게 (적용 전 대분류를 가리키는 내역이 있으면 멈춤)
      - `20261106140000_member_limit_four.sql` — 가계부 인원 상한 2명 → 4명 (기본값 + 기존 가계부 모두)
   2. `supabase/tests/check_applied.sql` — 적용 확인. 8행 모두 `rls_enabled=true`, `anon_select=false`, `authenticated_select=true`, `rpc=true`, `leave_rpc=true`, `invite_rules=true`, `profile_sync=true`, `n1_rule=true`, `member_limit_4=true`, policies는 ledger 2 / member 2 / invite 3 / 나머지 1
   3. `supabase/tests/10_rls_test.sql` — 권한 규칙 자체 테스트. 가짜 사용자로 가입·초대·참여·차단을 확인하고 **마지막에 ROLLBACK 해서 아무것도 남기지 않는다**. 오류 없이 끝나면 통과, 실패하면 `TEST FAILED: ...` 오류가 보인다
   4. `supabase/tests/20_category_pocket_test.sql` — 카테고리·주머니 관리 규칙 테스트 (같은 방식, 마지막에 ROLLBACK)
   - Supabase CLI를 쓰면 `supabase link` 후 `supabase db push`로 1번을 대신할 수 있다
3. 프로젝트 설정 → API Keys에서 URL, publishable key를 복사해 `.env.local`과 호스팅 환경변수에 넣기
4. 구글 로그인 설정 — 아래 "구글 로그인 설정" 참고

## 구글 로그인 설정 (최초 1회, 계정 주인이 직접)

비밀 값(Client Secret)은 Supabase 대시보드에만 넣는다. 레포·`.env`·이슈 댓글에 남기지 않는다.

1. **Google Cloud Console** (https://console.cloud.google.com) → 프로젝트 선택/생성
   1. APIs & Services → **OAuth consent screen**: User type `External`, 앱 이름 `반반`, 지원 이메일 입력. 공개 상태가 `Testing`이면 Test users에 로그인할 구글 계정을 추가해야 로그인된다(또는 `In production`으로 게시 — 이름·이메일·프로필 기본 범위만 쓰므로 심사 없음)
   2. APIs & Services → **Credentials → Create credentials → OAuth client ID** → 유형 `Web application`
      - Authorized JavaScript origins: `https://banban-nzh.pages.dev`
      - Authorized redirect URIs: `https://ryubtqzwqswmsrbiuorp.supabase.co/auth/v1/callback`
   3. 만들어진 **Client ID / Client Secret** 복사
2. **Supabase 대시보드** → Authentication
   1. **Sign In / Providers → Google**: Enable, Client ID·Client Secret 붙여넣기 → Save
   2. **URL Configuration**
      - Site URL: `https://banban-nzh.pages.dev`
      - Redirect URLs에 추가: `https://banban-nzh.pages.dev/login`, `https://*.banban-nzh.pages.dev/login` (PR 미리보기), `http://localhost:5173/login` (로컬 개발)
3. 확인: 운영 주소에서 "구글 계정으로 로그인" → 구글 계정 선택 → 앱으로 돌아와 "가계부 시작하기" 화면이 보이면 끝

로그인 흐름
- 구글 로그인 후 `/login`으로 돌아온다(PKCE). 세션은 브라우저 localStorage에 저장돼 새로고침해도 유지된다
- 초대 링크는 `/join/<코드>`. 로그인 전이면 코드를 기억해 두고 로그인 후 참여 화면으로 이어 간다
- 로그인 안 했으면 모든 화면이 `/login`으로 간다. 로그인 후 참여한 가계부가 있으면 홈, 없으면 `/start`(가계부 만들기 / 초대코드 입력)
- 로그아웃은 설정(또는 `/start`) 맨 아래. 이 기기에서만 로그아웃된다
- 구글 이름·프로필 이미지는 로그인할 때마다 DB 트리거가 `profile` 테이블에 저장한다(화면은 읽기만)

## 배포 (Cloudflare Pages)

1. Cloudflare 대시보드 → Workers & Pages → Create → Pages → GitHub 연결 → `meminlab/banban`
2. 빌드 설정: Framework `Vite` / Build command `npm run build` / Output `dist`
3. 환경변수: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `NODE_VERSION=22`
4. 이후 `main`에 머지하면 자동 배포. 주소를 직접 입력하거나 새로고침해도 SPA로 처리된다(404.html이 없으면 Pages가 index.html을 돌려줌)

## 홈 화면에 추가 (전체 화면 실행)

홈 화면 아이콘으로 열면 주소창·아래 도구 막대 없이 앱처럼 뜬다. 오프라인·푸시 알림은 없다(서비스 워커 없음).

- 아이폰 사파리: 공유 → 홈 화면에 추가 / 안드로이드 크롬: 메뉴 → 홈 화면에 추가(또는 앱 설치)
- 아이폰은 홈 화면 앱과 사파리가 로그인 저장소를 따로 쓴다 → 홈 화면 앱에서 처음 한 번은 다시 로그인해야 할 수 있다
- 설정 파일: `public/manifest.webmanifest`, 아이폰용 설정은 `index.html`의 `apple-*` 메타 태그
- 노치·홈 바: `viewport-fit=cover` + `global.css`의 `--safe-top` / `--safe-bottom` 여백(상단바·하단 탭·로그인·상태 화면에 적용)
- 아이콘: `public/icons/` (초록 배경 + 흰 글자 "반반"). 바꿀 때만 `python3 scripts/make-icons.py <Pretendard-ExtraBold.otf>`로 다시 만든다(Pillow 필요, 글꼴은 OFL 라이선스 Pretendard)

## 데이터 모델

전체 스키마: `supabase/migrations/20261105000000_init.sql` (명세 BANB-2 "확정 명세"의 용어를 코드 이름으로 그대로 사용)

| 테이블 | 내용 | 주요 규칙 |
|---|---|---|
| `ledger` | 가계부 | `member_limit` 기본 4 (클라이언트에서 변경 불가) |
| `member` | 멤버 | role `owner`/`member`, 사용자당 참여 중인 가계부 1개, 나가기는 `left_at` 기록(행 유지 → 그 사람 내역 보존) |
| `invite` | 초대 | 코드(8자리)·만료(발급+7일)는 서버가 기록, 새로 발급하면 이전 것 `is_revoked`, 유효 초대는 가계부당 1개, 멤버는 무효화만 가능(되살리기·만료 연장 불가) |
| `category` | 카테고리 | type `expense`/`income`/`saving`, 대분류(`parent_id` null) > 소분류 2단계만(자기 자신·소분류 있는 대분류는 부모 지정 불가, 부모와 type 같아야 함), 숨김 |
| `pocket` | 주머니 | scope `shared`/`personal`, 숨김 |
| `transaction` | 내역 | 금액 정수 1~9,999,999,999, `occurred_on` 날짜, 소분류만, 지출이면 주머니 필수, `is_fixed`는 지출만, 메모 100자, `source` 기본 `manual`, 작성자·마지막 수정자 자동 기록 |
| `profile` | 사용자 프로필 | 로그인 사용자 1명당 1행. 구글 이름(1~100자, 없으면 이메일 앞부분)·이미지(https만). `auth.users`가 생기거나 바뀔 때 트리거가 저장, 클라이언트는 읽기만. 나 + 내가 현재 멤버인 가계부에 참여했던 사람만 조회 |
| `asset` | 자산 | kind `checking`/`installment_saving`/`deposit`/`investment`/`cash`/`other`, `owner_id` null = 공동, 잔액 정수 0~9,999,999,999 |

권한 규칙
- 모든 테이블 RLS 사용. **해당 가계부의 현재 멤버만** 읽기·쓰기 가능, 비로그인은 전부 차단
- 가계부 만들기·참여·나가기는 RPC로만: `create_ledger(name, display_name)`, `join_ledger(code, display_name)`, `leave_ledger()`
  - 오류 코드: `ALREADY_IN_LEDGER`, `INVITE_NOT_FOUND`, `INVITE_EXPIRED`, `MEMBER_LIMIT_REACHED`(details = 현재 상한 값), `NOT_IN_LEDGER`, `NOT_AUTHENTICATED`
  - 인원 상한은 `ledger.member_limit` 값으로만 정한다(화면·API로 변경 불가, DB 관리자가 SQL로 변경). 동시 참여도 가계부 행 잠금으로 상한을 넘지 않는다
  - 나가기: 행은 남기고 `left_at` 기록 → 그 사람 내역 유지, 화면에 "(나감)". owner가 나가면 남은 멤버 중 가장 먼저 참여한 사람이 owner. 마지막 멤버가 나가면 가계부는 보관(현재 멤버 0명 → 아무도 못 봄)되고 초대는 모두 무효
  - 다시 참여: 같은 가계부에 예전 멤버 행이 있으면 되살린다(새 행 X) → 과거 내역이 다시 그 사람 이름으로 보인다. 이때 참여 시각은 다시 참여한 시각
  - 보관된 가계부의 초대 코드로는 참여 불가(`INVITE_NOT_FOUND`)
- 다른 가계부의 카테고리·주머니·멤버는 참조 불가 (복합 외래키)
- 사용 중인 카테고리·주머니는 삭제 불가 → 숨김 처리
- 가계부 생성 시 기본 카테고리(대분류 27 / 소분류 43)와 기본 주머니 4개 자동 생성
- 이름(가계부·멤버·카테고리·주머니·자산) 1~20자, 메모 100자
- 테이블 권한은 기본값에 기대지 않고 마이그레이션에서 명시적으로 부여
