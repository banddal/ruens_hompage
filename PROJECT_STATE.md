# PROJECT_STATE.md — Homo Ruens 포트폴리오

> **이 문서는 Claude와 Codex가 공유하는 단일 진실 문서(single source of truth)입니다.**
> 작업을 시작하기 전에 반드시 이 문서를 먼저 읽으세요.
> 설계·구조·환경변수·협업 흐름이 바뀌면 코드보다 **이 문서를 먼저 갱신**합니다.
> 사람의 기억이 아니라 이 파일이 두 AI 도구의 공유 메모리입니다.

마지막 갱신: 2026-06-28 (전체 점검 + Vercel 통합 설계 확정)

---

## ★ 이번 라운드에 한 일 (가장 최근 1회분 — 검증 시 여기부터)

> 이 블록은 **직전 작업 라운드의 변경분만** 펼쳐 보여줍니다.
> 받는 도구는 이걸 먼저 읽으면 무엇을 검증해야 하는지 바로 알 수 있습니다.
> 새 라운드가 시작되면, 여기 내용은 9번 작업 로그로 내려가고 이 블록은 최신으로 교체합니다.

- **라운드:** 2026-06-28 / 작성: Claude
- **한 줄:** Vercel 통합을 위한 백엔드 서버리스화 + 배포 설정 + 협업 문서 정비.
- **바뀐 파일과 이유:**
  - `api/index.js` (신규) — `server.js`를 Vercel 서버리스 핸들러로 개조.
    `http.listen()` 제거 → `module.exports=(req,res)=>...`. 로컬 FS 쓰기 차단(Supabase 전용).
    passwordRecord를 `ADMIN_PASSWORD` 환경변수 전용으로 단순화.
    getProjectsStore fallback을 content 시드로 변경(연결 끊겨도 빈 화면 방지).
  - `app.js` — `DEFAULT_API_ORIGIN`(Render 하드코딩) 제거, `API_BASE` 기본값을 상대경로("")로.
    (`TEAM_POSITION_LABELS` 보존 확인)
  - `vercel.json` (신규) — `/api/(.*)` → `api/index.js` rewrite, 함수 maxDuration 30s, html no-store.
  - `.gitignore` (신규) — `.env*`, node_modules, uploads/, backend-data/*.json 제외.
  - `.env.example` (신규) — 환경변수 양식(실제 키 없음, 커밋 안전).
  - `DEPLOY_VERCEL.md` (신규) — Vercel 배포 절차/체크리스트.
  - `PROJECT_STATE.md` — 협업 모델을 교차검증·붙여넣기 방식으로 재정의(역할 고정 제거).
- **검증 포인트(받는 쪽이 봐줄 것):**
  ① api/index.js의 죽은 로컬 분기에서 ReferenceError 가능성,
  ② 멀티파트 업로드가 Vercel 실환경에서 동작하는지(미검증),
  ③ 키 하드코딩 없는지(스캔상 없음),
  ④ app.js에서 의도치 않게 빠진 상수 없는지.
- **미반영/주의:** 멀티파트 업로드는 **실배포 검증 전**. 환경변수는 코드 아닌 Vercel 대시보드에 등록 필요.

---

## 0. 한 줄 요약

김성원(Kim Sung Won)의 개인 포트폴리오 사이트 "Homo Ruens".
정적 프론트엔드 + 서버리스 API + Supabase(DB·Storage) 구조로,
**단일 도메인(Vercel)으로 통합**하는 것이 현재 목표.

---

## 1. 배포 타깃 (확정)

| 항목 | 값 |
| --- | --- |
| 통합 호스팅 | **Vercel** (프론트 + API 한 도메인) |
| 운영 URL | https://ruens-hompage.vercel.app/ |
| GitHub | https://github.com/banddal/ruens_hompage |
| Supabase URL | https://lzwkhsbfpachkaudszjo.supabase.co |
| Supabase Storage 버킷 | `portfolio-assets` |

> ⚠️ 과거 흔적: 코드 곳곳에 **Render**(`ruens-hompage.onrender.com`) 기준 설정이
> 남아 있음. Vercel 통합 과정에서 모두 정리 대상. (아래 4-3 참조)

---

## 2. 아키텍처

```
방문자 브라우저
   │
   ├─ 정적 파일 (Vercel가 직접 서빙)
   │     index.html / app.js / styles.css / data.js / admin.html / admin.js / admin.css
   │     homo_ruens_assets/** (배경·교육·제주·지도 이미지)
   │
   └─ /api/*  →  Vercel 서버리스 함수 (api/index.js, 개조 예정)
          │
          ├─ Supabase REST  (projects / project_images / project_files 테이블)
          └─ Supabase Storage (portfolio-assets 버킷, 업로드 파일)
```

### 데이터 소스 (현재 이원화 — 정리 필요)

- **`data.js`** : 프론트에 하드코딩된 31개 프로젝트 + 에세이/스킬 라벨.
  백엔드 없이도 기본 렌더링이 되게 하는 fallback 겸 초기 시드.
- **Supabase `projects` 테이블** : 관리자 페이지(admin)로 추가/수정하는 실데이터.
- 서버는 Supabase가 비어 있으면 `backend-data/projects.json` →
  `content-data/projects.json` 순으로 시드를 자동 주입(server.js의 seed 로직).

> ❗ **결정 필요 항목**: "진짜 소스(source of truth)"를 Supabase로 단일화할지,
> data.js를 계속 fallback으로 둘지. → 5번 미결정 항목 참조.

---

## 3. 파일 지도 (무엇이 어디에)

> 파일별 "담당자"는 두지 않습니다. Claude와 Codex는 같은 파일을 번갈아 보며
> 교차검증하는 관계이기 때문입니다. 대신 파일의 **성격(자주 바뀌는지)** 을 표시해
> 충돌 위험이 큰 파일을 인지하는 용도로만 씁니다.

| 파일 / 폴더 | 역할 | 성격 |
| --- | --- | --- |
| `index.html` | 메인 페이지 마크업. 끝에서 data.js, app.js 로드 | 자주 변경 |
| `app.js` | 프론트 전체 로직, API 호출, 갤러리/탭/렌더 | 자주 변경 |
| `styles.css` | 메인 스타일 (히어로 등 디자인 작업 중) | 자주 변경 |
| `data.js` | 하드코딩 프로젝트/에세이 데이터 | 가끔 변경 |
| `admin.html` / `admin.js` / `admin.css` | 관리자 페이지 (로그인·프로젝트 CRUD·업로드) | 가끔 변경 |
| `server.js` | **(레거시)** 상시 실행 Node http 서버. Vercel 부적합 | 동결(삭제 후보) |
| `api/index.js` | 서버리스 API 핸들러 | 핵심·신중히 |
| `vercel.json` | 라우팅/리라이트 설정 | 거의 고정 |
| `supabase-schema.sql` | DB 스키마 (테이블·버킷·RLS). 재실행 안전 | 거의 고정 |
| `DEPLOY_VERCEL.md` | Vercel 배포 가이드 | 거의 고정 |
| `backend-data/*.json` | 서버 로컬 저장본 (Vercel에선 안 씀) | 미사용 |
| `content-data/*.json` | 시드 데이터 원본 (projects/essays 등) | 가끔 변경 |
| `homo_ruens_assets/**` | 이미지 자산 | 가끔 변경 |
| `uploads/**` | (레거시) 로컬 업로드 저장 폴더. Vercel에선 사용 불가 | 미사용 |

---

## 4. Vercel 통합을 위한 작업 보드

상태 표기: ☐ 할 일 / ◐ 진행 중 / ☑ 완료

### 4-1. 백엔드 서버리스 개조  ☑ (Claude 완료 2026-06-28)
- ☑ `server.js`의 핵심 로직을 `api/index.js` 단일 서버리스 핸들러로 이전
- ☑ 의존성 0 유지 (외부 npm 패키지 추가하지 않음 → lockfile 충돌 방지)
- ☑ 로컬 파일 저장(fs.writeFileSync) fallback 제거, **Supabase Storage 경로만** 사용
  - writeJson/ensureDir은 throw/no-op 스텁으로 변경, 로컬 쓰기 차단
  - passwordRecord는 ADMIN_PASSWORD 환경변수 전용으로 단순화
  - getProjectsStore fallback을 content-data 시드로 변경(빈 화면 방지)
- ☐ 멀티파트 업로드 파싱이 Vercel `req` 환경에서 동작하는지 **실배포 검증 필요**
      (스모크 테스트는 통과했으나 실제 multipart 업로드는 Vercel에서 한 번 확인 권장)

> 스모크 테스트 결과(Supabase 미설정 로컬): /api/health 200,
> /api/projects 28건(시드), /api/admin/projects 403(보호 정상).

### 4-2. 라우팅 / 설정  ☑ (Claude 완료 2026-06-28)
- ☑ `vercel.json` 작성: `/api/(.*)` → `api/index.js` rewrite, 함수 maxDuration 30s,
      index.html·admin.html no-store 헤더
- ☑ `.gitignore` 생성: `.env*`, `node_modules`, `uploads/`, `backend-data/*.json` 제외
- ☑ `.env.example` 생성 (커밋 안전, 양식만)

### 4-3. 프론트 주소 정리  ☑ (Claude 완료 2026-06-28)
- ☑ `app.js`: `DEFAULT_API_ORIGIN`(Render 하드코딩) 제거,
      `API_BASE` 기본값을 상대경로("")로 변경. `HOMO_RUENS_API_BASE` override만 유지.
- ☑ `admin.js`: 이미 `/api/...` 상대경로 사용 → 수정 불필요(확인 완료)

### 4-4. Supabase 준비  ☐
- ☐ Supabase SQL Editor에서 `supabase-schema.sql` 실행 (사람이 직접)
- ☐ `content-data/projects.json` 기반 초기 시딩 확인 (`/api/projects` 호출 시 자동)
- ☐ `portfolio-assets` 버킷 public 설정 확인

### 4-5. 문서 갱신  ☐ (Claude)
- ☐ `SUPABASE_DEPLOY.md`를 Render → Vercel 기준으로 갱신

---

## 5. 미결정 / 사람 결정 필요 항목

1. **데이터 단일화**: source of truth를 Supabase로 통일할지, data.js를 계속 둘지.
2. **백엔드 개조 방식**: (확정) A안 — 기존 server.js 로직을 의존성 없이 `api/index.js`로 응집.
   B안(@supabase/supabase-js 도입)은 lockfile 공유 충돌 우려로 보류.
3. **admin 비밀번호 초기 설정**: 최초 1회 admin.html에서 설정 or 환경변수 `ADMIN_PASSWORD`.

---

## 6. 환경변수 (절대 코드/깃에 넣지 말 것)

Vercel 대시보드 → Settings → Environment Variables 에만 등록.
로컬 개발은 `.env.local` (gitignore 처리됨).

| 키 | 설명 | 비고 |
| --- | --- | --- |
| `SUPABASE_URL` | https://lzwkhsbfpachkaudszjo.supabase.co | 공개돼도 무방 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role 키 | 🔴 **절대 노출 금지**. 서버 함수에서만 사용 |
| `SUPABASE_STORAGE_BUCKET` | `portfolio-assets` | |
| `ADMIN_PASSWORD` | 관리자 로그인 비밀번호 | 최소 10자 |
| `ADMIN_SECRET` | 세션 서명용 긴 랜덤 문자열 | 미설정 시 ADMIN_PASSWORD로 대체됨 |

> service_role 키가 프론트 코드나 git에 들어가면 DB 전체가 뚫립니다.
> 이 키는 오직 `api/` 서버 함수의 `process.env`에서만 읽습니다.

---

## 7. Claude ↔ Codex 협업 방식

이 프로젝트에서 Claude와 Codex는 **역할이 갈린 게 아니라, 같은 작업을
번갈아 보며 교차검증(cross-check)하는 두 개의 눈**입니다.
어느 쪽이 무엇을 할지는 그때그때 토큰·맥락 상황에 따라 유동적입니다.
따라서 "이 파일은 누구 담당" 같은 고정 규칙은 두지 않습니다.

### 7-1. 전달 방식: 붙여넣기

한 도구의 결과물을 **다른 도구에 붙여넣어** 넘깁니다
(git 동기화로 주고받지 않음). 그래서 다음이 중요합니다.

- 결과물을 줄 때는 **무엇을·왜 바꿨는지 한두 줄 요약**을 같이 붙인다.
  (받는 쪽이 diff 맥락 없이도 검증할 수 있도록)
- 파일 전체를 통째로 주고받기보다, **바뀐 블록 + 그 파일에서의 위치**를
  명시하면 교차검증이 빨라진다.
- 붙여넣은 코드가 반영된 "현재 진짜 상태"는 항상 **로컬 레포 + 이 문서**가 기준.
  대화창의 과거 버전이 아니라.

### 7-2. 교차검증 루프

1. 한 도구가 변경안을 만든다 (코드 + 변경 요약).
2. 사람이 그것을 다른 도구에 붙여넣고 "검증해줘"라고 한다.
3. 검증 측은 ① 논리 오류 ② 빠진 케이스 ③ 기존 코드와의 충돌 ④ 보안(키 노출 등)
   을 본다. 동의하면 그대로, 이견 있으면 대안 제시.
4. 확정된 내용은 로컬에 반영하고, 문서 맨 위 **"★ 이번 라운드에 한 일"**
   블록을 이번 변경으로 교체한다. (직전 내용은 9번 작업 로그로 한 줄 내려보낸다.)

### 7-3. "작업 중" 태그 (충돌 방지의 핵심)

파일을 누가 맡는다고 미리 정하지 않는 대신, **지금 손대고 있는 대상을
아래 보드에 태그로 표시**합니다. 같은 대상을 양쪽이 동시에 건드려
서로의 결과를 덮어쓰는 사고를 막기 위함입니다.

작업을 시작할 때 8번 "현재 작업 중" 표에 한 줄 추가하고,
끝나면(=결과를 반영하고 로그를 남기면) 그 줄을 지웁니다.

### 7-4. 변하지 않는 규칙 (역할과 무관하게 항상)

- **환경변수·비밀키는 코드에 하드코딩 금지.** 항상 `process.env`.
- **의존성(npm 패키지)을 함부로 추가하지 않는다.** 추가가 불가피하면
  9번 로그에 남기고 상대 도구에 반드시 알린다. (붙여넣기 방식이라
  lockfile이 자동 동기화되지 않으므로 누락 시 한쪽만 깨진다.)
- **확정 = 로컬 반영 + 로그 기록.** 머릿속이나 대화창에만 있는 변경은
  "안 된 것"으로 친다.

---

## 8. 현재 작업 중 (실시간, 끝나면 줄 삭제)

| 대상(파일/기능) | 누가 | 무엇을 | 시작 |
| --- | --- | --- | --- |
| (없음) | | | |

> 예시: `| api/index.js 업로드 | Codex | multipart 파싱 Vercel 대응 | 06-28 |`

---

## 9. 작업 로그 (최근 → 과거)

- 2026-06-28 · Claude · vercel.json·.gitignore·.env.example 생성, app.js API_BASE 상대경로화.
  배포 가능한 최소 형태 완성. Supabase env 등록 + git push 만 하면 배포됨.
- 2026-06-28 · Claude · `server.js` → `api/index.js` 서버리스 개조 완료.
- 2026-06-28 · Claude · 전체 점검 완료, Vercel 통합 설계 확정, 본 문서 생성.
- (이전) · 프론트엔드 히어로 섹션 디자인 작업 (중앙정렬 레이아웃, 타이포, 백라이트 등).
