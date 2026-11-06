# 반반 디자인 시스템 v1

> 상태: v1 (BANB-18) · 기준 폭 360–430px · 이 문서가 화면 시안(BANB-19)과 개발 반영의 기준이다.
> 미리보기: `docs/design-preview.html`을 브라우저로 열면 토큰과 컴포넌트를 라이트/다크로 볼 수 있다.

## 0. 방향

**"우리 집 냉장고에 붙은 메모처럼 따뜻하고, 은행 앱처럼 숫자가 또렷한 가계부."**

| 원칙 | 뜻 | 화면에서 |
|---|---|---|
| 10초 안에 | 열자마자 이번 달 숫자, 한 번 눌러 입력 | 홈 첫 화면에 남은 돈·지출, 가계부 탭 ＋ 버튼은 항상 같은 자리 |
| 숫자가 주인공 | 금액은 가장 크고 굵고, 자릿수가 세로로 맞는다 | 금액은 항상 `tabular-nums`, 라벨은 작고 연하게 |
| 따뜻하고 차분하게 | 흰 바탕 + 살구색 포인트, 둥근 모서리, 해요체 | 차가운 회색·형광색·각진 표 대신 아이보리 바탕과 부드러운 카드 |
| 색은 거들 뿐 | 의미는 글자·기호·아이콘으로 먼저 전한다 | 음수는 `−` 기호 + 빨강, 선택은 체크 아이콘 + 색 |

벤치마크(모아불리)는 수준과 흐름만 참고하고, 색·문구·로고는 가져오지 않았다.

---

## 1. 색

### 1.1 기본 팔레트 토큰

토큰 이름 `color.xxx` → CSS 변수 `--color-xxx` (점 `.`은 하이픈 `-`으로).

| 토큰 | 라이트 | 다크 | 쓰는 곳 |
|---|---|---|---|
| `color.bg` | `#FBF8F3` | `#171412` | 앱 바탕(아이보리). 카드 바깥 |
| `color.surface` | `#FFFFFF` | `#221E1B` | 카드·헤더·탭바·시트·입력 |
| `color.surface-sunken` | `#F4EFE7` | `#2C2723` | 세그먼트 바탕, 막대 그래프 바탕, 스켈레톤, 보조 정보 상자 |
| `color.border` | `#EAE3D8` | `#3A342E` | 카드 테두리, 목록 구분선 (장식용) |
| `color.border-strong` | `#8E8579` | `#7D7368` | 입력·체크박스 테두리 (바탕 대비 3:1 이상) |
| `color.text` | `#2A2420` | `#F4EFE9` | 본문·제목·지출 금액 |
| `color.text-sub` | `#615850` | `#C2B8AD` | 라벨·보조 설명·비활성 탭 |
| `color.text-weak` | `#7A7066` | `#9E9388` | 자리표시(placeholder)·글자 수 등 덜 중요한 글자 |
| `color.primary` | `#BF4D1B` | `#F0895A` | 주 버튼 바탕, 활성 탭, ＋ 버튼, 포커스 링, 링크 |
| `color.primary-pressed` | `#A23F14` | `#E07444` | 주 버튼 누름 |
| `color.primary-strong` | `#A3401A` | `#F7A27C` | `primary-soft` 위 글자 (선택된 칩·배지) |
| `color.primary-soft` | `#FCEDE5` | `#3A2519` | 선택된 칩·현재 가계부 행·활성 탭 알약 바탕 |
| `color.on-primary` | `#FFFFFF` | `#1A1310` | 주 버튼·＋ 버튼 위 글자/아이콘 |
| `color.focus` | `#BF4D1B` | `#F0895A` | 키보드 포커스 링 (= primary) |
| `color.scrim` | `rgb(23 20 18 / 0.45)` | `rgb(0 0 0 / 0.6)` | 시트·확인 창 뒤 어둡게 |
| `color.inverse-surface` | `#2A2420` | `#F4EFE9` | 토스트 바탕 |
| `color.on-inverse` | `#FFFFFF` | `#171412` | 토스트 글자 |
| `color.inverse-action` | `#F7A27C` | `#A3401A` | 토스트 안 "되돌리기" 버튼 글자 |

### 1.2 의미 색 토큰 (돈·상태)

| 토큰 | 라이트 | 다크 | 쓰는 곳 | 색 외 표시(필수) |
|---|---|---|---|---|
| `color.expense` | `#2A2420` | `#F4EFE9` | 지출 금액 (= text, 무채색) | 목록에서 `−` 기호, 요약에서는 "지출" 라벨 |
| `color.income` | `#2459D6` | `#8AAEFF` | 수입 금액 | `+` 기호 또는 "수입" 라벨 |
| `color.income-soft` | `#EAF0FD` | `#1E2A44` | 수입 배지 바탕 | — |
| `color.saving` | `#13795B` | `#5CC99E` | 저축 금액 | "저축" 배지(돼지저금통 아이콘) |
| `color.saving-soft` | `#E3F3EC` | `#17332A` | 저축 배지 바탕 | — |
| `color.negative` | `#C8283C` | `#FF7B88` | 남은 돈 음수, 자산 합계 음수 | `−` 기호 + 화면낭독 "마이너스" |
| `color.negative-soft` | `#FDECEE` | `#3D1D22` | 음수 강조 상자 바탕 | — |
| `color.danger` | `#C8283C` | `#FF7B88` | 오류 글자, 위험 버튼 바탕, 오류 입력 테두리 | 오류 아이콘 + 문장 |
| `color.on-danger` | `#FFFFFF` | `#1A1310` | 위험 버튼 글자 | — |
| `color.danger-soft` | `#FDECEE` | `#3D1D22` | 삭제 확인 상자 바탕 | — |
| `color.success` | `#1E7A46` | `#66CF8F` | 저장·복사 완료 글자 | 체크 아이콘 + 문장 |
| `color.notice-bg` | `#FFF3D6` | `#3A2E14` | 안내 상자 바탕, 고정지출 배지 바탕 | — |
| `color.notice-text` | `#7A4B00` | `#F5C56B` | 안내 상자·고정지출 배지 글자 | 아이콘/라벨 |
| `color.chart-bar` | `#BF4D1B` | `#F0895A` | 홈 나눠 보기 막대 (= primary) | 금액·% 숫자 같이 표시 |
| `color.chart-track` | `#F4EFE7` | `#2C2723` | 막대 바탕 (= surface-sunken) | — |
| `color.cal-sun` | `#C8283C` | `#FF7B88` | 달력 일요일 날짜 숫자 | 요일 머리글 "일" |
| `color.cal-sat` | `#2459D6` | `#8AAEFF` | 달력 토요일 날짜 숫자 | 요일 머리글 "토" |

**결정: 지출은 무채색.** 지출은 가장 자주 보이는 숫자라 빨강으로 칠하면 화면 전체가 경고처럼 보이고, "남은 돈 음수(빨강)"와 구분이 안 된다. 국내 은행·가계부 앱 관행(출금 검정, 입금 파랑)과도 맞다.
**결정: 주 색(살구)은 금액에 쓰지 않는다.** 금액 색은 위 표의 돈 토큰만 쓴다. 주 색은 "누를 수 있는 것"에만.

### 1.3 명도 대비 검증 (WCAG 2.1 AA)

모두 계산으로 확인했다 (상대 휘도 공식). 글자 4.5:1, 큰 글자·UI 요소 3:1 기준.

| 조합 | 라이트 | 다크 |
|---|---|---|
| text / bg | 14.45 | 16.04 |
| text-sub / surface | 6.95 | 8.47 |
| text-sub / surface-sunken | 6.08 | 7.56 |
| text-weak / surface | 4.84 | 5.50 |
| primary / surface (링크·활성 탭) | 4.89 | 6.64 |
| on-primary / primary (주 버튼) | 4.89 | 7.37 |
| primary-strong / primary-soft (선택 칩) | 5.56 | 7.14 |
| income / surface · income-soft | 6.04 · 5.29 | 7.55 · 6.52 |
| saving / surface · saving-soft | 5.37 · 4.68 | 8.12 · 6.68 |
| negative / surface · negative-soft | 5.49 · 4.81 | 6.65 · 6.04 |
| on-danger / danger (위험 버튼) | 5.49 | 7.37 |
| success / surface | 5.35 | 8.58 |
| notice-text / notice-bg | 6.72 | 8.28 |
| on-inverse / inverse-surface (토스트) | 15.31 | 16.04 |
| inverse-action / inverse-surface | 7.59 | 5.56 |
| border-strong / surface (입력 테두리, 3:1) | 3.63 | 3.56 |
| focus / surface (포커스 링, 3:1) | 4.89 | 6.64 |

> `primary`를 `primary-soft` 위 글자로 쓰면 4.28로 미달 → 그 자리엔 반드시 `primary-strong`을 쓴다.
> 비활성(disabled) 요소는 WCAG 대비 예외지만, 투명도(opacity) 대신 `surface-sunken` 바탕 + `text-weak` 글자로 표현한다.

### 1.4 다크 모드

- v1은 토큰만 정의한다. 적용 방식: `prefers-color-scheme: dark` 자동 전환, 앱 안 토글은 두지 않는다(다음 단계).
- 다크에서는 그림자 대신 `surface` 명도 차이와 `border`로 층을 구분한다.
- `<meta name="theme-color">`를 두 개 둔다: 라이트 `#FFFFFF`, 다크 `#221E1B` (`media="(prefers-color-scheme: dark)"`).

---

## 2. 글자

### 2.1 글꼴

| 항목 | 내용 |
|---|---|
| 글꼴 | **Pretendard** (가변 글꼴, 한글·영문·숫자 한 벌) |
| 라이선스 | SIL Open Font License 1.1 — 무료, 상업 사용·임베딩·재배포 가능. **비용 0원** |
| 출처 | https://github.com/orioncactus/pretendard (npm 패키지 `pretendard`) |
| 불러오기 | npm `pretendard`를 설치해 `pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css`를 앱에서 import (빌드에 포함되어 외부 CDN 의존 없음, 쓰는 글자만 나눠 받음) |
| 대체 글꼴 | `'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif` |
| 숫자 | 금액·날짜·코드는 항상 `font-variant-numeric: tabular-nums` (자릿수 세로 정렬) |
| 굵기 | 400 본문 / 500 라벨 강조 / 600 제목·버튼 / 700 금액 (800 이상은 쓰지 않음) |

### 2.2 크기 단계

`font.xxx` → `--font-xxx` (크기), 줄 높이는 함께 쓴다. 본문 최소 15px, 입력은 16px(iOS 확대 방지).

| 토큰 | 크기 / 줄높이 | 굵기 | 쓰는 곳 |
|---|---|---|---|
| `font.amount-hero` | 32 / 40 | 700 | 홈 "남은 돈", 자산 합계 |
| `font.amount-lg` | 24 / 32 | 700 | 요약 카드 주 금액, 입력 화면 금액 |
| `font.title-lg` | 22 / 30 | 600 | 시작·로그인 큰 제목 |
| `font.title` | 18 / 26 | 600 | 상단 헤더 제목·가계부 이름, 시트·확인 창 제목 |
| `font.amount-md` | 17 / 24 | 700 | 목록 행 금액, 요약 보조 금액 |
| `font.body-lg` | 17 / 26 | 400 | 강조 본문 |
| `font.body` | 16 / 24 | 400 | 기본 본문, 입력, 버튼(600) |
| `font.body-sm` | 15 / 22 | 400 | 목록 행 제목, 설명 |
| `font.caption` | 13 / 18 | 500 | 라벨·보조 정보·배지 |
| `font.micro` | 11 / 14 | 600 | 달력 칸 금액, 탭바 라벨(12) — 이 두 곳만 |

- 자간: 한글 제목·금액 `-0.01em`, 그 외 0.
- 화면 확대(브라우저 글자 크기 200%)에서 금액이 넘치면 금액 칸이 다음 줄로 내려간다. 금액 자체를 자르지 않는다.

### 2.3 금액·숫자 표기 규칙

| 규칙 | 예 | 비고 |
|---|---|---|
| 천 단위 쉼표 + `원`, 띄어쓰기 없음 | `1,234,000원` | `toLocaleString('ko-KR')` |
| `원`은 숫자보다 한 단계 작게 | 숫자 32px → `원` 24px(0.75em), 굵기 600 | 숫자가 먼저 읽히게. 17px 이하 금액은 같은 크기 |
| 숫자+`원`은 한 덩어리, 중간 줄바꿈 금지 | — | `white-space: nowrap` (기존 `.money` 유지) |
| **음수 기호는 `−`(U+2212 마이너스 기호)로 통일** | `−52,000원` | 하이픈 `-` 금지. 홈 "남은 돈"의 현재 `-`를 바꾼다 (BANB-9 QA 이관 항목) |
| 음수는 기호 + `color.negative` 둘 다 | `−52,000원`(빨강) | 색만으로 전달 금지 |
| 화면낭독: 기호는 숨기고 단어로 읽힘 | 보이는 것 `−52,000원` / 읽는 것 "마이너스 52,000원" | 아래 마크업 참고 |
| 종류가 섞인 목록·달력에서만 기호 표시 | 지출 `−12,000원` / 수입 `+3,000,000원` / 저축 `500,000원`+저축 배지 | 화면낭독은 "지출 12,000원"처럼 종류 단어로 |
| 라벨이 붙은 합계에는 기호를 붙이지 않음 | "지출 1,234,000원" | 단, 남은 돈·자산 합계가 음수일 때는 `−` |
| 0원 | `0원` (기호·색 없음) | |
| 큰 금액 | 최대 `9,999,999,999원`(13자). hero 금액이 14자 이상(`−` 포함)이면 `amount-hero` → `amount-lg`로 한 단계 줄임 | 기존 `.asset-total__total--long`과 같은 방식 |
| 줄여 쓰기(만·억) | 달력 칸·그래프 축처럼 좁은 곳만. `1.2만`, `35만`, `1.5억` (기존 `compactWon` 규칙) | 줄인 숫자를 누르면 원래 금액이 보여야 하고, 화면낭독은 원래 금액 |
| 비율 | 정수 `%`, 숫자 오른쪽 정렬 | `formatPercent` |
| 날짜 | 목록 그룹 `11월 6일 (목)`, 월 이동 `2026년 11월` | 요일은 괄호 |

음수 금액 마크업 (개발 기준):

```html
<span class="money money--negative">
  <span aria-hidden="true">−</span><span class="sr-only">마이너스 </span>52,000<span class="money__unit">원</span>
</span>
```

> **결정 기록 (디자인, 2026-11-06)**: 음수 기호는 `−`(U+2212)로 통일. 하이픈은 글꼴에 따라 짧고 높이가 달라 숫자와 어긋나 보이고, 화면낭독기가 "하이픈"으로 읽거나 건너뛴다. `−`도 기기마다 "빼기/마이너스"로 다르게 읽으므로, 기호는 `aria-hidden`으로 숨기고 "마이너스"를 글자로 넣는다. 금액 표시 함수(`formatWon`)는 기호만 `−`로 바꾸고, 화면낭독 처리는 금액 컴포넌트가 맡는다.

---

## 3. 간격·모서리·그림자·움직임

### 3.1 간격 (4px 단위)

| 토큰 | 값 | 쓰는 곳 |
|---|---|---|
| `space.1` | 4px | 아이콘–글자 사이 최소 |
| `space.2` | 8px | 칩 사이, 버튼 2개 사이 |
| `space.3` | 12px | 목록 행 안 요소 사이, 라벨–입력 사이 |
| `space.4` | 16px | 카드 안 묶음 사이, 목록 행 세로 여백 |
| `space.5` | 20px | **화면 좌우 여백**, 카드 안쪽 여백 |
| `space.6` | 24px | 섹션 사이 |
| `space.8` | 32px | 큰 섹션 사이, 빈 화면 위아래 |
| `space.10` | 40px | 시작 화면 위 여백 |

### 3.2 모서리

| 토큰 | 값 | 쓰는 곳 |
|---|---|---|
| `radius.sm` | 8px | 배지, 달력 칸, 작은 상자 |
| `radius.md` | 12px | 버튼, 입력, 세그먼트 안쪽 |
| `radius.lg` | 16px | 카드, 목록 묶음, 확인 창 |
| `radius.xl` | 24px | 바텀시트 위 모서리, 홈 요약 큰 카드 |
| `radius.full` | 999px | 칩, 토스트, ＋ 버튼, 아바타 |

### 3.3 그림자 (라이트만, 따뜻한 갈색 기운)

| 토큰 | 값 | 쓰는 곳 |
|---|---|---|
| `shadow.sm` | `0 1px 2px rgb(42 36 32 / 0.06)` | 카드, 세그먼트 선택 |
| `shadow.md` | `0 4px 12px rgb(42 36 32 / 0.08)` | 떠 있는 헤더(스크롤 시), 토스트 |
| `shadow.lg` | `0 8px 24px rgb(42 36 32 / 0.16)` | 바텀시트, 확인 창, ＋ 버튼 |

다크: 모두 `none`, 대신 `surface`와 `border`로 구분.

### 3.4 움직임

| 토큰 | 값 | 쓰는 곳 |
|---|---|---|
| `motion.fast` | 120ms ease-out | 누름·선택 색 변화 |
| `motion.base` | 200ms cubic-bezier(0.2, 0, 0, 1) | 시트·확인 창 등장, 토스트 |
| `motion.slow` | 300ms | 탭 화면 전환 페이드 |

`prefers-reduced-motion: reduce`이면 이동 애니메이션은 끄고 투명도만(또는 즉시).

### 3.5 레이아웃 (360px 기준)

| 토큰 | 값 | 비고 |
|---|---|---|
| `layout.min-width` | 360px | 이보다 좁으면 가로 스크롤 |
| `layout.max-width` | 480px | 넓은 화면에서는 가운데 정렬, 바깥은 `bg` |
| `layout.gutter` | 20px | 화면 좌우 여백 → 360px에서 본문 320px |
| `layout.topbar-height` | 56px | + `safe-top` |
| `layout.tabbar-height` | 64px | + `safe-bottom` (기존 60 → 64, 라벨 여유) |
| `layout.touch` | 44px | **누르는 영역 최소.** 주요 버튼·입력은 48px |
| `layout.fab-size` | 56px | 오른쪽 20px, 탭바 위 16px |
| 안전 영역 | `--safe-top/right/bottom/left = env(safe-area-inset-*)` | 기존 변수 그대로. 헤더는 top, 탭바·시트·하단 고정 버튼은 bottom을 더한다 |

430px까지는 같은 레이아웃이 늘어난다(카드 폭만 넓어짐). 글자 크기는 고정.

---

## 4. 아이콘

| 항목 | 내용 |
|---|---|
| 세트 | **Lucide** 한 세트만 사용 (다른 세트·이모지 아이콘·직접 그린 SVG 혼용 금지) |
| 라이선스 | ISC License (일부 Feather 유래 아이콘은 MIT) — 무료, 상업 사용 가능. **비용 0원** |
| 출처 | https://lucide.dev · https://github.com/lucide-icons/lucide · npm `lucide-react` (확인 버전 1.69.0, 아래 아이콘 이름 모두 존재 확인) |
| 크기 | 24px(헤더·탭바·＋), 20px(목록·버튼 안), 16px(배지·인라인) |
| 선 굵기 | `strokeWidth` 1.75 (24px), 2 (20px 이하) |
| 색 | `currentColor` — 글자 색을 따른다 |
| 접근성 | 장식용은 `aria-hidden`, 아이콘만 있는 버튼은 `aria-label` 필수 |

기본 매핑 (이름은 `lucide-react` 컴포넌트명):

| 자리 | 아이콘 | 자리 | 아이콘 |
|---|---|---|---|
| 탭 홈 | `House` | 뒤로 | `ChevronLeft` |
| 탭 가계부 | `NotebookPen` | 가계부 전환 ▾ | `ChevronDown` |
| 탭 자산 | `Landmark` | 목록 이동 › | `ChevronRight` |
| 설정 | `Settings` | 닫기 | `X` |
| 내역 추가 | `Plus` | 필터 | `SlidersHorizontal` |
| 달력 보기 | `CalendarDays` | 목록 보기 | `List` |
| 선택됨 | `Check` | 복사 | `Copy` |
| 공유 | `Share2` | 수정 | `Pencil` |
| 삭제 | `Trash2` | 멤버 | `Users` |
| 초대 | `UserPlus` | 로그아웃 | `LogOut` |
| 카테고리 | `Tag` | 주머니 | `Wallet` |
| 저축 | `PiggyBank` | 고정지출 | `Repeat` |
| 공동 주머니 | `Users` | 개인 주머니 | `User` |
| 오류 | `CircleAlert` | 완료 | `CircleCheck` |
| 불러오는 중 | `LoaderCircle` | 다시 시도 | `RotateCw` |
| 빈 화면(내역) | `ReceiptText` | 빈 화면(자산) | `Landmark` |

기본 대분류 아이콘 (목록 행 왼쪽 원). 사용자가 만든 카테고리는 이름 첫 글자를 원 안에 쓴다.

| 지출 대분류 | 아이콘 | 지출 대분류 | 아이콘 |
|---|---|---|---|
| 식비 | `UtensilsCrossed` | 문화·여가 | `Ticket` |
| 주거 | `House` | 경조사·선물 | `Gift` |
| 통신 | `Smartphone` | 교육 | `GraduationCap` |
| 교통 | `Bus` | 보험 | `ShieldCheck` |
| 생활 | `ShoppingBasket` | 반려동물 | `PawPrint` |
| 쇼핑 | `ShoppingBag` | 육아 | `Baby` |
| 건강 | `HeartPulse` | 대출이자 | `Percent` |
| 기타 | `Ellipsis` | | |
| **수입** (모든 대분류) | `Banknote` | **저축** (모든 대분류) | `PiggyBank` |

---

## 5. 컴포넌트

공통: 모든 누를 수 있는 요소는 **최소 44×44px**, 키보드 포커스 시 `2px solid color.focus` + `outline-offset: 2px` (요소 안쪽에 그릴 때 `-2px`). 누름 상태는 색만 한 단계 진하게(`motion.fast`).

### 5.1 버튼

| 종류 | 바탕 | 글자 | 테두리 | 쓰는 곳 |
|---|---|---|---|---|
| 주(primary) | `primary` | `on-primary` | 없음 | 화면당 1개. 저장·만들기·참여 |
| 보조(secondary) | `surface` | `text` | `1px border-strong` | 취소, 두 번째 선택지 |
| 텍스트(text) | 투명 | `primary` | 없음 | 덜 중요한 동작, "다시 시도" 옆 링크 |
| 위험(danger) | `danger` | `on-danger` | 없음 | 확인 창의 최종 삭제·나가기 |
| 위험 외곽(danger-outline) | `surface` | `danger` | `1px danger` | 화면 안 "삭제" 진입 버튼 |

| 크기 | 높이 | 글자 | 좌우 여백 | 쓰는 곳 |
|---|---|---|---|---|
| L | 52px | 16/600 | 20px | 화면 아래 고정 CTA(가득 폭) |
| M | 48px | 16/600 | 20px | 기본 |
| S | 44px | 15/600 | 14px | 카드·목록 안 |

상태: 누름 `primary-pressed` / 비활성 `surface-sunken` 바탕 + `text-weak` 글자(투명도 금지) / 처리 중 `LoaderCircle` 16px 회전 + 문구 유지("저장 중…"), 중복 누름 막기.
아래 고정 CTA는 `surface` 바탕 띠 위에 놓고, 띠 아래쪽 여백에 `safe-bottom`을 더한다.

### 5.2 입력·선택

| 요소 | 규칙 |
|---|---|
| 텍스트 입력 | 높이 48, 글자 16, 안쪽 여백 0 14px, `radius.md`, `1px border-strong`, 바탕 `surface` |
| 라벨 | 입력 위 `font.caption`(13/500) `text-sub`, 간격 8. 선택 입력은 라벨 뒤 "(선택)" |
| 포커스 | 테두리 `primary` 2px로 (레이아웃 흔들리지 않게 `box-shadow: inset 0 0 0 1px primary` 추가) |
| 오류 | 테두리 `danger` + 아래에 `CircleAlert` 16px + 문장(`danger`, 13/500). `aria-invalid`, `aria-describedby` 연결 |
| 도움말·글자 수 | 아래 오른쪽 `text-weak` 13px (`12/20`) |
| 금액 입력 | 높이 64, 숫자 `font.amount-lg`(24/700) 오른쪽 정렬, 뒤에 `원` 18/600. `inputmode="numeric"`, 입력하며 쉼표 |
| 선택(카테고리·주머니·사람) | 항목 10개 이하 → 칩 묶음(5.5). 그보다 많거나 2단계(대분류→소분류) → 선택 행 + 바텀시트 |
| 선택 행 | 입력과 같은 상자, 왼쪽 값(없으면 `text-weak` "선택해 주세요"), 오른쪽 `ChevronRight` 20 |
| 세그먼트(지출/수입/저축) | `surface-sunken` 바탕 4px 안쪽, 선택 칸 `surface` + `shadow.sm` + 글자는 종류 색(지출 `text`, 수입 `income`, 저축 `saving`), 굵기 600. 높이 48 |
| 체크박스(고정지출) | 22px 상자 `border-strong`, 체크 시 `primary` 바탕 + 흰 `Check`. 라벨 전체가 누르는 영역(높이 44) |

### 5.3 목록 행

**내역 행**

```
[아이콘 40] 제목(메모 또는 소분류)            −12,000원
           대분류 · 주머니 · 사람 [고정][저축]
```

| 부분 | 규칙 |
|---|---|
| 높이 | 최소 64px, 세로 여백 12, 좌우 0(카드 안이면 16) |
| 아이콘 원 | 40px `radius.full`, 바탕 `surface-sunken`, 아이콘 20 `text-sub` (4절 대분류 매핑). 수입은 `income-soft`/`income`, 저축은 `saving-soft`/`saving` |
| 제목 | `font.body-sm` 15/600 `text`, 한 줄 넘으면 말줄임 |
| 보조 | 13/400 `text-sub`, `·`로 구분, 한 줄 말줄임 |
| 금액 | `font.amount-md` 17/700, 지출 `−`+`expense`, 수입 `+`+`income`, 저축 기호 없음+`saving`. 줄바꿈 금지, 오른쪽 정렬 |
| 배지 | 고정지출 `notice-bg`/`notice-text` + `Repeat` 12, 저축 `saving-soft`/`saving` |
| 구분 | 행 사이 `1px border`, 아이콘 오른쪽부터(왼쪽 56px 들여서) |
| 날짜 묶음 머리 | `11월 6일 (목)` 13/600 `text-sub` + 오른쪽 그날 지출 합 13/600 `text` |
| 누름 | 전체 행이 링크. 누름 바탕 `surface-sunken` |

**자산 행**: 같은 구조. 아이콘 원에 종류별 아이콘(입출금 `Wallet` / 적금·예금 `PiggyBank` / 투자 `TrendingUp` / 현금 `Banknote` / 기타 `Ellipsis`), 보조 줄 "종류 · 소유자(공동)", 금액은 `text` 17/700(음수 없음, 잔액 ≥ 0).

**메뉴 행(설정)**: 높이 56, 왼쪽 아이콘 20 `text-sub` + 이름 16, 오른쪽 현재 값 15 `text-sub` + `ChevronRight`.

### 5.4 금액 표시 (`Money`)

| 변형 | 크기 | 쓰는 곳 |
|---|---|---|
| `hero` | 32/700, `원` 24 | 홈 남은 돈, 자산 합계 |
| `lg` | 24/700, `원` 18 | 요약 카드 주요 3개(수입·지출·저축) |
| `md` | 17/700 | 목록 행, 나눠 보기 |
| `sm` | 15/600 | 보조 금액, 소유자별 합계 |

| 톤 | 색 | 기호 |
|---|---|---|
| `neutral` | `text` | 없음 (음수면 자동으로 `negative` 톤) |
| `expense` | `expense` | 목록에서 `−` |
| `income` | `income` | 목록에서 `+` |
| `saving` | `saving` | 없음 |
| `negative` | `negative` | `−` (+ 화면낭독 "마이너스") |

홈 요약 카드 구성(시안 BANB-19에서 확정): 위 라벨 "11월 남은 돈"(13 `text-sub`) → `hero` 금액 → 아래 3칸 수입/지출/저축(`caption` 라벨 + `md` 금액). 남은 돈 계산식은 카드 아래 `text-weak` 13px로.
360px에서 3칸 폭(약 90px)보다 금액이 길면(예: `10,000,000원` 이상) 기존 D-1 규칙대로 그 항목만 한 줄 전체로 내려간다. 금액을 자르거나 글자를 줄이지 않는다.

### 5.5 칩 (필터·주머니·카테고리 선택)

| 상태 | 바탕 | 글자 | 테두리 | 기타 |
|---|---|---|---|---|
| 기본 | `surface` | `text` | `1px border-strong` | — |
| 선택 | `primary-soft` | `primary-strong`, 600 | `1px primary` | 앞에 `Check` 16 (색만으로 구분 금지) |
| 비활성 | `surface-sunken` | `text-weak` | 없음 | — |

- 높이 44, 좌우 14, `radius.full`, 글자 15, 사이 8. 넘치면 줄바꿈(가로 스크롤 금지 — 숨은 선택지가 생김).
- 주머니 칩은 이름 뒤에 범위 아이콘(`Users` 공동 / `User` 개인) 14px을 붙이고 `aria-label`에 "공동"/"개인" 포함.
- 필터가 걸려 있으면 가계부 탭 위에 "필터 2개 적용 중 · 지우기" 띠(`primary-soft`/`primary-strong`).

### 5.6 상단 헤더 (가계부 전환 포함)

| 화면 | 왼쪽 | 가운데 | 오른쪽 |
|---|---|---|---|
| 탭 화면(홈·가계부·자산) | **가계부 전환 버튼** | — | `Settings` 아이콘 버튼 44 |
| 하위 화면(설정·입력 등) | `ChevronLeft` 버튼 44 | 화면 제목 `font.title` | 화면 동작(있으면) |

- 높이 56 + `safe-top`, 바탕 `surface`, 아래 `1px border`(스크롤 0일 때는 테두리 없음, 스크롤되면 `border` 표시).
- **가계부 전환 버튼**: [가계부 첫 글자 원 28px `primary-soft`/`primary-strong` 14/700] + 가계부 이름 `font.title` 18/600(한 줄 말줄임, 최대 폭 = 헤더 − 오른쪽 버튼) + `ChevronDown` 20 `text-sub`. 전체가 하나의 버튼(높이 44 이상). `aria-label="가계부 전환, 지금 보는 가계부: {이름}"`, `aria-haspopup="dialog"`.
- **가계부 전환 시트**(5.8 바텀시트 사용, 제목 "가계부"):
  - 행: 높이 64, [첫 글자 원 40] 이름 16/600(두 줄까지, 넘치면 말줄임) + "멤버 N명" 13 `text-sub`. 현재 가계부는 행 바탕 `primary-soft` + 오른쪽 `Check` 20 `primary` + `aria-current="true"` (배지 문구 "지금 보는 중"은 화면낭독용으로만).
  - 목록 아래 구분선 후 텍스트 행 2개: `Plus` "새 가계부 만들기", `UserPlus` "초대코드로 참여" (높이 56, `primary` 글자). 5개 상한이면 두 행을 비활성으로 두고 아래 "가계부는 최대 5개까지 참여할 수 있어요" 13 `text-sub`.
  - 360px에서 5개 + 동작 2개가 스크롤 없이 보이는 높이 기준(64×5 + 56×2 + 머리 56 ≈ 488px).

### 5.7 하단 탭

- 높이 64 + `safe-bottom`, 바탕 `surface`, 위 `1px border`. 3칸 균등.
- 칸: 아이콘 24 + 라벨 12/500, 사이 4.
- 기본: `text-sub`. 활성: 아이콘 뒤 알약 56×32 `primary-soft`, 아이콘 `primary-strong`, 라벨 `text` 12/700 + `aria-current="page"`. (색 + 알약 모양 + 굵기로 구분)
- ＋ 버튼(내역 추가)은 탭이 아니라 가계부·홈 탭 위 떠 있는 56px 원(`primary`/`on-primary`, `shadow.lg`, `aria-label="내역 추가"`). 위치: 오른쪽 20, 탭바 위 16.

### 5.8 바텀시트 (아래에서 올라오는 시트)

- 바탕 `surface`, 위 모서리 `radius.xl`(24), `shadow.lg`, 뒤 `scrim`.
- 맨 위 손잡이 36×4 `border-strong` 가운데(장식, 닫기는 아래 방법들로).
- 머리: 제목 `font.title` 왼쪽, `X` 닫기 버튼 44 오른쪽. 높이 56.
- 본문 좌우 20, 아래 여백 24 + `safe-bottom`. 최대 높이 90dvh, 넘치면 본문만 스크롤, 아래 동작 버튼은 고정.
- 닫기: `X`, 바깥 누르기, Esc, 뒤로가기. 열릴 때 첫 포커스는 제목, 닫히면 연 버튼으로 포커스 복귀. `role="dialog" aria-modal="true"`.
- 등장 `motion.base` 아래→위, 줄인 움직임 설정이면 페이드.

### 5.9 확인 창

- 가운데, 폭 `min(320px, 100% − 40px)`, `radius.lg`, 안쪽 24/20/16, `shadow.lg`, 뒤 `scrim`.
- 제목 18/600, 본문 15 `text-sub`(무엇이 어떻게 되는지 한 문장), 버튼 2개 가로 균등(M 48): 왼쪽 보조 "취소", 오른쪽 주 또는 위험.
- 위험 동작 문구는 동사로: "삭제할까요?" → [취소] [삭제하기]. "확인/예" 금지.
- `role="alertdialog"`, 첫 포커스는 **취소** 버튼(실수 방지).

### 5.10 토스트

- 아래 가운데, 탭바(또는 하단 고정 버튼) 위 16px. 바탕 `inverse-surface`, 글자 `on-inverse` 15/500, `radius.full`, 안쪽 12 20, `shadow.md`.
- 앞에 아이콘 16(`CircleCheck` 완료 / `CircleAlert` 실패). 2.5초 후 사라짐(실패는 4초). 한 번에 1개.
- `role="status"`(실패는 `role="alert"`). 되돌리기 동작이 필요하면 오른쪽 텍스트 버튼("되돌리기", `inverse-action`).

### 5.11 빈 화면

- 가운데 정렬, 위아래 `space.8`. 원 72px `surface-sunken` 안에 아이콘 32 `text-sub` → 제목 16/600 → 설명 15 `text-sub`(최대 2줄) → 필요하면 주 버튼 M.
- 문구는 다음 행동을 알려 준다. 예:

| 자리 | 제목 | 설명 | 버튼 |
|---|---|---|---|
| 가계부 탭(이번 달 0건) | 아직 이번 달 내역이 없어요 | 오늘 쓴 돈부터 가볍게 남겨 볼까요? | 내역 추가 |
| 필터 결과 0건 | 조건에 맞는 내역이 없어요 | 필터를 바꾸거나 지워 보세요 | 필터 지우기(보조) |
| 자산 탭 | 아직 등록한 자산이 없어요 | 통장·적금 잔액을 적어 두면 한눈에 볼 수 있어요 | 자산 추가 |
| 홈(이번 달 0건) | 이번 달 기록을 기다리고 있어요 | 둘이 함께 쓴 돈이 여기 모여요 | 내역 추가 |

### 5.12 오류·로딩 상태

| 상태 | 표시 |
|---|---|
| 화면 첫 로딩(앱 시작·로그인 확인) | 가운데 `LoaderCircle` 32 `primary` + "불러오는 중…" 15 `text-sub` |
| 탭 본문 로딩 | **스켈레톤**: 카드·행 자리에 `surface-sunken` 둥근 막대. 0.3초 안에 끝나면 안 보이게(0.3초 뒤부터 표시). 줄인 움직임 설정이면 반짝임 없이 정지 |
| 버튼 처리 중 | 5.1 처리 중 상태 |
| 불러오기 실패 | 빈 화면 형식 + `CircleAlert` + "내역을 불러오지 못했어요" / "인터넷 연결을 확인하고 다시 시도해 주세요" + 보조 버튼 `RotateCw` "다시 시도" |
| 저장 실패 | 입력은 그대로 두고, 하단 고정 버튼 위에 오류 문장(`danger`, 아이콘 포함). 토스트로만 알리지 않는다 |
| 입력 오류 | 5.2 오류 규칙. 저장을 누르면 첫 오류 입력으로 포커스 이동 |
| 권한 없음·나간 가계부 | 빈 화면 형식 + "이 가계부를 볼 수 없어요" + "내 가계부로 가기" |

### 5.13 배지

높이 20, 좌우 6, `radius.sm`, 12/600. 종류: 기본(`surface-sunken`/`text-sub`), 주(`primary-soft`/`primary-strong`), 수입·저축·고정(1.2 표의 soft/글자 조합).

---

## 6. 접근성 체크리스트

- [ ] 누르는 영역 최소 44×44px (주 버튼·입력 48px). 작은 아이콘도 감싸는 버튼은 44.
- [ ] 키보드 포커스가 항상 보인다(`:focus-visible` 2px `focus` 링). 링을 지우는 `outline: none` 금지.
- [ ] 색만으로 의미 전달 금지: 음수 `−`+단어, 선택 `Check`, 오류 아이콘+문장, 수입·지출 기호/라벨, 활성 탭 알약+굵기.
- [ ] 글자 대비 4.5:1, 큰 글자·테두리·포커스 3:1 (1.3 표). 새 색 조합은 표에 추가하고 계산한다.
- [ ] 아이콘만 있는 버튼에 `aria-label`. 장식 아이콘은 `aria-hidden`.
- [ ] 금액은 화면낭독기가 "마이너스 52,000원", "지출 12,000원"처럼 의미대로 읽는다.
- [ ] 시트·확인 창: 포커스 가두기, Esc 닫기, 닫으면 포커스 복귀.
- [ ] 글자 크기 200%에서 금액·버튼 글자가 잘리지 않는다(줄바꿈 허용, 금액 내부 줄바꿈 금지).
- [ ] `prefers-reduced-motion` 존중.

## 7. 문구 톤

- 해요체, 짧게. "~하시겠습니까?" 대신 "~할까요?".
- 탓하지 않기: "잘못된 입력입니다" → "금액을 숫자로 적어 주세요".
- 둘이 함께 쓰는 앱: "우리", "둘이" 같은 말을 홈·빈 화면에서 가볍게 쓴다(설정·오류 문구에서는 쓰지 않는다).
- 숫자 단위는 항상 붙인다: "3건", "멤버 2명", "5개까지".

---

## 8. CSS 변수 (그대로 옮겨 쓰기)

```css
:root {
  /* 색 — 라이트 */
  --color-bg: #FBF8F3;
  --color-surface: #FFFFFF;
  --color-surface-sunken: #F4EFE7;
  --color-border: #EAE3D8;
  --color-border-strong: #8E8579;
  --color-text: #2A2420;
  --color-text-sub: #615850;
  --color-text-weak: #7A7066;
  --color-primary: #BF4D1B;
  --color-primary-pressed: #A23F14;
  --color-primary-strong: #A3401A;
  --color-primary-soft: #FCEDE5;
  --color-on-primary: #FFFFFF;
  --color-focus: #BF4D1B;
  --color-scrim: rgb(23 20 18 / 0.45);
  --color-inverse-surface: #2A2420;
  --color-on-inverse: #FFFFFF;
  --color-inverse-action: #F7A27C;

  --color-expense: #2A2420;
  --color-income: #2459D6;
  --color-income-soft: #EAF0FD;
  --color-saving: #13795B;
  --color-saving-soft: #E3F3EC;
  --color-negative: #C8283C;
  --color-negative-soft: #FDECEE;
  --color-danger: #C8283C;
  --color-on-danger: #FFFFFF;
  --color-danger-soft: #FDECEE;
  --color-success: #1E7A46;
  --color-notice-bg: #FFF3D6;
  --color-notice-text: #7A4B00;
  --color-chart-bar: #BF4D1B;
  --color-chart-track: #F4EFE7;
  --color-cal-sun: #C8283C;
  --color-cal-sat: #2459D6;

  /* 글자 */
  --font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui,
    'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
  --font-amount-hero: 700 2rem/2.5rem var(--font-family);       /* 32/40 */
  --font-amount-lg: 700 1.5rem/2rem var(--font-family);         /* 24/32 */
  --font-title-lg: 600 1.375rem/1.875rem var(--font-family);    /* 22/30 */
  --font-title: 600 1.125rem/1.625rem var(--font-family);       /* 18/26 */
  --font-amount-md: 700 1.0625rem/1.5rem var(--font-family);    /* 17/24 */
  --font-body-lg: 400 1.0625rem/1.625rem var(--font-family);    /* 17/26 */
  --font-body: 400 1rem/1.5rem var(--font-family);              /* 16/24 */
  --font-body-sm: 400 0.9375rem/1.375rem var(--font-family);    /* 15/22 */
  --font-caption: 500 0.8125rem/1.125rem var(--font-family);    /* 13/18 */
  --font-micro: 600 0.6875rem/0.875rem var(--font-family);      /* 11/14 */

  /* 간격 */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px;

  /* 모서리 */
  --radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px; --radius-xl: 24px; --radius-full: 999px;

  /* 그림자 */
  --shadow-sm: 0 1px 2px rgb(42 36 32 / 0.06);
  --shadow-md: 0 4px 12px rgb(42 36 32 / 0.08);
  --shadow-lg: 0 8px 24px rgb(42 36 32 / 0.16);

  /* 움직임 */
  --motion-fast: 120ms ease-out;
  --motion-base: 200ms cubic-bezier(0.2, 0, 0, 1);
  --motion-slow: 300ms cubic-bezier(0.2, 0, 0, 1);

  /* 레이아웃 */
  --layout-min-width: 360px;
  --layout-max-width: 480px;
  --layout-gutter: 20px;
  --topbar-height: 56px;
  --tabbar-height: 64px;
  --touch: 44px;
  --touch-lg: 48px;
  --fab-size: 56px;
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);

  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #171412;
    --color-surface: #221E1B;
    --color-surface-sunken: #2C2723;
    --color-border: #3A342E;
    --color-border-strong: #7D7368;
    --color-text: #F4EFE9;
    --color-text-sub: #C2B8AD;
    --color-text-weak: #9E9388;
    --color-primary: #F0895A;
    --color-primary-pressed: #E07444;
    --color-primary-strong: #F7A27C;
    --color-primary-soft: #3A2519;
    --color-on-primary: #1A1310;
    --color-focus: #F0895A;
    --color-scrim: rgb(0 0 0 / 0.6);
    --color-inverse-surface: #F4EFE9;
    --color-on-inverse: #171412;
    --color-inverse-action: #A3401A;

    --color-expense: #F4EFE9;
    --color-income: #8AAEFF;
    --color-income-soft: #1E2A44;
    --color-saving: #5CC99E;
    --color-saving-soft: #17332A;
    --color-negative: #FF7B88;
    --color-negative-soft: #3D1D22;
    --color-danger: #FF7B88;
    --color-on-danger: #1A1310;
    --color-danger-soft: #3D1D22;
    --color-success: #66CF8F;
    --color-notice-bg: #3A2E14;
    --color-notice-text: #F5C56B;
    --color-chart-bar: #F0895A;
    --color-chart-track: #2C2723;
    --color-cal-sun: #FF7B88;
    --color-cal-sat: #8AAEFF;

    --shadow-sm: none;
    --shadow-md: none;
    --shadow-lg: none;
  }
}

/* 금액 */
.money { white-space: nowrap; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.money__unit { font-size: 0.75em; font-weight: 600; margin-left: 1px; }  /* hero·lg에서만 */
.money--income { color: var(--color-income); }
.money--saving { color: var(--color-saving); }
.money--negative { color: var(--color-negative); }
```

## 9. 지금 코드에서 옮길 때 (개발 참고)

현재 `src/styles/global.css`의 값 → 새 토큰. 한 번에 바꾸지 않고 화면 리디자인 이슈마다 옮겨도 된다(이름이 같은 변수는 값만 바뀜).

| 지금 | 새 토큰 |
|---|---|
| `--color-bg #f6f7f9` | `--color-bg` (값 변경) |
| `--color-surface`, `--color-text`, `--color-text-sub`, `--color-border` | 이름 같음, 값 변경 |
| `--color-primary #1f6f5c` (초록) | `--color-primary` (살구로 변경). 저축 의미로 쓰던 곳(`.tx-row__amount--saving`, `.tx-badge--saving`)은 `--color-saving` |
| `--color-danger #c62828` | 오류·위험은 `--color-danger`, 남은 돈 음수(`.is-negative`)는 `--color-negative` |
| `--color-success`, `--color-notice-bg` | 이름 같음, 값 변경 |
| 하드코딩 `#1d4ed8` (수입·토요일) | `--color-income` / `--color-cal-sat` |
| 하드코딩 `#e6f2ee`, `#e3f1ed`, `#f1f8f6` (선택 바탕) | `--color-primary-soft` (저축 배지는 `--color-saving-soft`) |
| 하드코딩 `#8a929c`, `#8a94a3` (입력 테두리) | `--color-border-strong` |
| 하드코딩 `#fdecea` (삭제 확인) | `--color-danger-soft` |
| 하드코딩 `#7a4b00` (고정 배지) | `--color-notice-text` |
| `--tabbar-height: 60px` | `64px` |
| `--touch: 48px` | 최소 `--touch: 44px`, 주요 버튼·입력 `--touch-lg: 48px` |
| `font-family: system-ui …` | `--font-family` (Pretendard) |
| `src/components/Icon.tsx` 직접 그린 SVG | `lucide-react` 아이콘으로 교체 (4절 매핑) |
| 가계부 전환 `▾` 글자 | `ChevronDown` |
| `src/domain/format.ts` `formatWon`의 `-` | `−`(U+2212) + 금액 컴포넌트에서 화면낭독 "마이너스" |
| `index.html` `theme-color #ffffff` | 라이트 `#FFFFFF` / 다크 `#221E1B` 두 개 |

## 10. 범위·다음 단계

- 이 문서는 기준만 정한다. 화면별 시안(시작·홈·가계부·입력·자산·설정)은 **BANB-19**.
- 다음 단계로 미룬 것: 앱 안 다크 모드 토글, 가계부별 색/이모지(데이터 항목 필요), 그래프 다색 팔레트(대분류 5개 이상 색 구분), 일러스트.
- 바꾸는 법: 토큰 값·이름 변경은 이 문서를 먼저 고치는 PR → 디자인 리뷰 → 코드 반영.
