# PROJECT_STATE.md — Homo Ruens

> Claude와 Codex가 함께 보는 작업 상태 문서입니다.  
> 새 라운드를 시작하기 전 이 파일을 먼저 읽고, 라운드가 끝나면 이 파일을 갱신하세요.

마지막 갱신: 2026-06-30 / 작성: Codex

---

## 1. 현재 기준

- 작업 폴더: `C:\Users\HP\Desktop\새 폴더`
- 배포 방향: Render 제거, Vercel 중심
- 운영 도메인 목표: `https://kimsung-won.com`
- 데이터/파일 저장: Supabase DB + Supabase Storage
- 주요 파일:
  - `index.html`, `styles.css`, `app.js`
  - `admin.html`, `admin.css`, `admin.js`
  - `api/index.js`
  - `supabase-schema.sql`
  - `data.js`, `content-data/projects.json`

---

## 2. 이번 라운드 변경 요약




### M. archiving Portfolio 완료시점 기준 정렬 (Claude, 2026-06-30)
- 요청: archiving Portfolio 블록의 연도 배치/정렬을 완료(종료) 시점 기준으로.
- 변경: periodSortKey/projectYear의 우선순위를 periodEnd → periodStart → period 순으로 변경(기존은 periodStart 우선).
  parseStartYear도 마지막 연도 추출(예 2017~2018→2018). 종료없으면 시작, 그것도 없으면 period 폴백(누락방지).
- 검증: 시작2017/종료2018 프로젝트가 2018그룹 배치, 38개 누락없음.
- 캐시 app.js 20260630-endsort-1.

### L. archiving Portfolio 프로젝트 누락 수정 (Claude, 2026-06-30)
- 증상: union-integration 등 원래 있던 프로젝트가 archiving Portfolio에 안 보임.
- 원인: hydrateProjectCache의 PROJECTS 머지 객체(merged)에 periodStart/periodEnd가 빠져있었음.
  → Supabase에서 온 프로젝트(admin에서 기간 입력한 것)는 머지 시 periodStart 유실 → 연도 못 구해 그룹핑에서 누락.
- 수정:
  - merged에 periodStart(sp.periodStart||sp.period_start), periodEnd, workDuration 추가.
  - archiving projectYear/periodSortKey에 폴백 추가: periodStart 없으면 periodEnd로 폴백(안 잡히던 것 구제). 기존 동작은 유지.
- 검증: Playwright — union-integration에 periodStart 주입 후 머지/재렌더 → 2023년에 정상 표시.
- 캐시 app.js 20260630-archfix-2.

### K. CV Leadership 버튼 오배치 수정 (Claude, 2026-06-30)
- 경기도경제과학진흥원·과장 행에 잘못 붙어있던 performance-eval(성과평가) 버튼 삭제(원래 G-FAIR 3개만 있어야 함, archiving은 정상이었음).
- G-FAIR KOREA PM 연도 역순 수정: 과장 행 슬롯이 위→아래로 2024/2023/2022/2021인데 G-FAIR이 2021(위)~2023(아래)로 거꾸로 박혀있던 것을 2023(위)→2022→2021(아래)로 정정. Playwright로 각 PM 버튼 y좌표가 해당 연도 라벨과 일치 확인.
- 캐시 app.js 20260630-split-2.

### J. 노동/실태조사 프로젝트 11개 분할 (Claude, 2026-06-30)

G-FAIR(21/22/23) 분할과 동일 방식으로, 4개 프로젝트를 연도별로 분할(기존 유지 + 신규 7개 추가 = 11개).

분할 결과:
- 단체협상: collective-agreement(2020·기존) + collective-agreement-2017(2017-18) + collective-agreement-2022
- 경기도 갑질: harassment-survey(2018·기존) + harassment-survey-2020 + harassment-survey-2022
- 경과원 갑질: gbsa-harassment-survey(2020·기존) + gbsa-harassment-survey-2018 + gbsa-harassment-survey-2022
- 성과평가: performance-eval(2021·기존) + performance-eval-2020

처리한 곳:
- `data.js`, `content-data/projects.json`: 기존4개 period/period_start/end 확정 + 신규7개 추가.
- `split-labor-projects.sql`: 기존4 update + 신규7 insert(tags/skill_tags 제외=타입회피, on conflict do update).
- `index.html` CV Leadership & Passion: 11개 lead-dot 버튼 배치.
  - 소속 정정: 경과원갑질(gbsa)→경과원노조 컬럼4, 경기도갑질(harassment)→총연합 컬럼5 (기존에 반대로 박혀있던 것 수정).
  - 경과원 노조위원장 행을 2022(span제거)로 줄이고, **2021행 신설**해 performance-eval(2021) 배치.
  - 위원장(2022): collective-2022+gbsa-2022 / 위원장대행(2020): collective+gbsa+performance-eval-2020 / 사무국장(2017-): collective-2017+gbsa-2018
  - 총연합 부위원장(2022): harassment-2022 / 감사(2020): harassment-2020 / 사무국장(2018): harassment
- archiving Portfolio는 PROJECTS 자동 read → 11개가 연도별 자동 배치(검증완료).
- 캐시: app.js `20260630-split-1`.

검증: Playwright — CV 신규버튼 4종 모달 정상, archiving 11개 연도배치 정확(2017/2018/2020/2021/2022), node--check 통과.

사용자 액션: index.html+data.js+projects.json 교체 push + split-labor-projects.sql 1회 실행.

미결정(2): portfolio 탭 s1/s2/s3 타임라인에 11개를 넣을지 → 공간 과다 우려로 사용자가 의견 요청. 아래 Claude 의견 참고.

---


### H. Essay 에디터 개선

관리자 `Essays` 에디터를 실사용 가능한 글쓰기 도구에 가깝게 개선.

변경 내용:

- 툴바 정리 및 확장
  - `P`, `H2`, `H3`
  - `B`, `I`, `U`
  - `Quote`
  - `UL`, `OL`
  - `Link`
  - `Image`
  - `Line`
  - `Clear`
- 기존 이모지/기호 중심 버튼을 일반 텍스트 버튼으로 정리.
- 에디터 글꼴을 관리자 굵은 폰트 느낌에서 일반 웹 기본 산세리프 계열로 조정.
- 에디터 기본 글자 굵기를 낮추고, 제목/강조도 과하게 보이지 않도록 조정.
- 붙여넣기 이미지 처리 개선.
  - 네이버/브런치에서 HTML로 복사된 `<img>`는 정리 후 보존.
  - 클립보드에 이미지 파일이 들어오는 경우 Data URL로 본문에 직접 삽입.
  - `Image` 버튼으로 로컬 이미지 파일을 선택해 본문에 삽입 가능.
- `<figure>`, `<figcaption>` 구조 허용.
- 링크 붙여넣기/삽입 시 `http/https`만 허용하고 `target="_blank"`, `rel="noopener"` 부여.
- 에세이 미리보기 모달 추가.
  - 현재 입력 중인 제목/카테고리/날짜/태그/본문을 사이트 모달에 가까운 형태로 확인 가능.
- 에세이 저장 API 요청 크기 제한을 `1MB`에서 `10MB`로 확대.
  - 이유: 본문에 이미지가 Data URL로 들어갈 경우 저장 요청이 커질 수 있음.
- 2026-06-30 추가 보강:
  - 선택 텍스트에 적용하는 `Weight` 선택 기능 추가.
    - Light 300 / Regular 400 / Medium 500 / SemiBold 600 / Bold 700
  - 글자 색상 선택 기능 추가.
  - 기존 `B`(볼드), `I`(기울임), `U`(밑줄) 버튼 유지.
  - 툴바 선택 시 본문 선택 영역이 풀리지 않도록 selection range 보존 로직 추가.
- 2026-06-30 추가 보강 2:
  - 다른 앱/브라우저에서 복사한 이미지 파일 붙여넣기 처리 확장.
  - MIME 타입이 비어 있어도 파일명이 이미지 확장자이면 이미지로 처리.
  - 이미지 URL 텍스트를 붙여넣으면 자동으로 이미지 삽입.
  - 에디터에 이미지 파일을 드래그앤드롭해도 본문에 삽입.

수정 파일:

- `admin.html`
- `admin.js`
- `admin.css`
- `api/index.js`

검증:

```powershell
node --check "C:\Users\HP\Desktop\새 폴더\admin.js"
node --check "C:\Users\HP\Desktop\새 폴더\api\index.js"
```

주의:

- 현재 에세이 이미지는 별도 Storage 업로드가 아니라 본문 HTML 안에 Data URL로 들어갈 수 있음.
- 큰 이미지를 많이 붙이면 Supabase row 또는 Vercel 요청 제한에 걸릴 수 있음.
- 장기적으로는 `essay_images` 테이블 + Storage 업로드 방식의 별도 이미지 관리 모달을 만드는 것이 더 안정적.

### I. Essay 모달 이미지 깨짐 수정

사용자가 `20220409/우리의 젊음들` 에세이에 이미지를 붙여 테스트한 결과,
관리자 에디터에서는 이미지가 보이나 실제 사이트 에세이 모달에서는 깨진 이미지와 파일명만 보이는 문제가 확인됨.

원인:

- 관리자 에디터는 붙여넣은 이미지를 `data:image/jpeg;base64,...` 형태로 본문에 저장할 수 있음.
- 프론트 `app.js`의 `sanitizeEssayHtml()`가 기존에 `data:` 스킴 전체를 위험하다고 판단해 `img src`를 제거함.
- 결과적으로 모달에서는 `<img alt="KakaoTalk_...jpg">`만 남아 깨진 이미지처럼 표시됨.

수정:

- `app.js`
  - 에세이 HTML 새니타이저에서 이미지 `src`는 `https://`, `http://`, `data:image/`만 허용.
  - 링크 `href`는 `http/https`만 허용.
  - 에디터에서 추가한 색상/굵기용 `<span style="">` 중 안전한 스타일만 통과.
    - `color`
    - `font-weight`
    - `font-style`
    - `text-decoration`
- `styles.css`
  - 에세이 모달 내 `figure`, `figcaption`, figure 이미지 정렬 스타일 추가.
- `index.html`
  - `app.js`, `styles.css` 캐시 버전 갱신: `20260630-essay-image-1`

검증:

```powershell
node --check "C:\Users\HP\Desktop\새 폴더\app.js"
```

### A. Google Analytics 태그 추가

`index.html`의 `<head>`에 Google tag 삽입.

- 측정 ID: `G-0YRE7D04ZF`
- 관리자 페이지 `admin.html`에는 삽입하지 않음.

### B. 푸터 이메일 수정

푸터 영문 문구의 분쟁 접수 이메일 수정.

- 기존: `help@email.com`
- 변경: `band17dal@gmail.com`

### C. 관리자 Dashboard 추가

관리자 로그인 후 첫 화면을 `Dashboard`로 변경.

대시보드에 표시되는 항목:

- 전체 Project 수
- 전체 Essay 수
- 전체 Memo 수
- 전체 Comment 수
- 방문자수
- 조회 포스트 수
- 최신 Memo
- 최신 Comment
- 조회 포스트 목록

연결:

- `보기` 버튼 → `Memos`, `Comments`
- `분석 보기` 버튼 → `Analytics`

수정 파일:

- `admin.html`
- `admin.js`
- `admin.css`

### D. Projects / Essays 관리자 목록 구조 변경

기존 좌측 고정 목록을 상단 게시판형 목록으로 변경.

현재 구조:

- 상단: 게시판 프레임
- 게시판 내부: 자체 스크롤
- 하단: 에디터

목록 컬럼:

- 게시일자
- 제목
- 태그
- 작성 시간
- 상태

정렬 기능:

- Projects:
  - 기본 순서
  - 게시일자 최신순
  - 게시일자 오래된순
  - 제목 가나다순
  - 태그 가나다순
  - 작성 시간 최신순
- Essays:
  - 게시일자 최신순
  - 게시일자 오래된순
  - 제목 가나다순
  - 태그 가나다순
  - 작성 시간 최신순

### E. 저장하기 / 수정하기 분리

관리자에서 의도치 않은 복제를 줄이기 위해 버튼 의미를 분리.

- `저장하기`: 새 프로젝트/새 에세이 생성용
- `수정하기`: 기존 항목 수정용

현재 동작:

- 기존 ID가 있는 항목을 `저장하기`로 저장하려 하면 차단
- 기존 항목을 수정하려면 `수정하기` 사용

### F. Portfolio 관리번호 추가

프로젝트별 포트폴리오 관리번호 필드 추가.

- 형식: `p0001`, `p0002`, ...
- 관리자 게시판에 `No.` 열로 표시
- 프로젝트 에디터에 `포트폴리오 번호` 입력칸 추가
- API 매핑 추가
- DB 컬럼 추가

수정 위치:

- `supabase-schema.sql`
  - `projects.portfolio_no text default ''`
  - 기존 row에 `p0001` 형식 자동 부여 쿼리 추가
- `api/index.js`
  - `portfolioNo` ↔ `portfolio_no` 매핑
- `admin.html`
  - 포트폴리오 번호 입력 필드
- `admin.js`
  - 목록 표시, 폼 read/write

주의:

- Supabase SQL Editor에서 `supabase-schema.sql` 변경분을 실행해야 `portfolio_no` 저장 가능.

### G. 이미지 업로드/관리 모달 분리

프로젝트 에디터 안에 있던 이미지 업로드 UI를 분리.

현재 구조:

- 에디터 안에는 `Images` 요약 + `이미지 관리` 버튼만 표시
- 버튼 클릭 시 이미지 관리 모달 오픈
- 모달 안에서 이미지 업로드/썸네일 확인/삭제/순서 변경

모달 기능:

- 다중 이미지 업로드
- 썸네일 표시
- 다중 선택 삭제
- 드래그로 순서 변경
- `이미지 관리 확정` 버튼

첨부파일 업로드:

- 기존 기능 유지
- 이미지 영역이 빠진 만큼 에디터 영역을 더 넓게 사용

수정 파일:

- `admin.html`
- `admin.js`
- `admin.css`

---

## 3. 검증 완료

아래 문법 검사를 통과함.

```powershell
node --check "C:\Users\HP\Desktop\새 폴더\admin.js"
node --check "C:\Users\HP\Desktop\새 폴더\api\index.js"
```

---

## 4. 다음 작업자가 바로 확인할 것

1. Supabase SQL Editor에서 `supabase-schema.sql`의 `portfolio_no` 추가 쿼리 실행 필요.
2. 관리자 `Projects`에서 기존 프로젝트 선택 후:
   - `p0001` 형식 번호가 뜨는지 확인
   - `수정하기`로 저장되는지 확인
   - `저장하기`로 기존 항목 저장 시 차단되는지 확인
3. 이미지 관리 모달에서:
   - 이미지 업로드
   - 썸네일 표시
   - 드래그 순서변경
   - 선택 삭제
   - 확정 버튼
   확인 필요.
4. `portfolio_no`는 아직 프론트의 Portfolio/News 노출 순서 제어에 직접 연결하지 않았음. 다음 라운드에서 연결 가능.
5. 에세이도 현재 `저장하기/수정하기`는 프론트에서만 의미 분리됨. 서버 API는 기존 `POST /api/admin/essays` upsert 구조 유지.

---

## 5. 현재 남은 큰 설계 메모

- 방문자 분석은 자체 `analytics_events` 테이블 + Google Analytics 병행 구조.
- 관리자 Dashboard는 자체 API들을 모아 보여주는 프론트 집계 방식.
- Portfolio 노출 순서 제어는 앞으로 `portfolioNo`, `sortOrder`, `dashboardFeatured` 중 무엇을 최종 기준으로 삼을지 결정 필요.
- 이미지 업로드는 업로드 즉시 저장됨. `이미지 관리 확정`은 UX상 확인 버튼이며 DB commit 버튼은 아님.
- 프로젝트 본문 저장/수정과 이미지 업로드 저장은 아직 별도 흐름임.

---

## 6. 최근 수정 파일 목록

- `index.html`
- `admin.html`
- `admin.js`
- `admin.css`
- `api/index.js`
- `supabase-schema.sql`
- `PROJECT_STATE.md`

---

## 7. 2026-07-02: Analytics 개편

**목표**: 순방문자/뷰 분리, 일자별 집계, 게시글별 유입 경로, 관리자 트래픽 제외.

- `api/index.js`
  - `isOwnerRequest()`: admin 세션 쿠키 유효 또는 `OWNER_IPS` env(쉼표 구분 IP) 매칭 시 `/api/analytics/track`에서 기록 스킵.
  - `classifyReferrer()`: referrer를 소스 그룹(직접 유입/내부 이동/Google/Naver/Brunch/LinkedIn/…)으로 정규화.
  - `handleAdminAnalytics()` 전면 개편: summary에 todayUnique/last7Unique/todayContentViews 추가, daily 30일(UV/PV/게시글뷰), content에 uniqueReaders + referrers[] 추가, 사이트 전체 referrers[] 추가, FETCH_LIMIT 10000 + truncated 플래그.
- `app.js`: `hr-owner` localStorage 플래그 있으면 trackAnalytics 전체 스킵. `?notrack=1`로 플래그 세팅, `?track=1`로 해제.
- `admin.js`: 로그인/세션 확인 성공 시 `markOwnerBrowser()`로 `hr-owner` 자동 세팅. 요약 카드 7종, 일자별 3열(UV/PV/글조회), 게시글 행 클릭 시 유입 경로 펼침(details), 전체 유입 경로 목록(비중 %).
- `admin.html`: Analytics 패널 구조 갱신(유입 경로 섹션, 안내 문구).
- `admin.css`: `.analytics-row--expandable`, `.analytics-ref-list`, `.analytics-daily-cols`(주의: `.analytics-row span`의 display:block보다 특이도 높여야 함 → `span.analytics-daily-cols`).

**주의사항**
- visitor_hash가 `일자|IP|UA|salt` 해시라 UV는 "일 단위 순방문"임. 90일 uniqueVisitors는 일별 순방문의 합산 성격(같은 사람이 이틀 오면 2로 집계). 진짜 기간 UV가 필요하면 해시에서 day 제거 필요(프라이버시 트레이드오프).
- 관리자 제외는 (1) admin 로그인한 브라우저의 localStorage 플래그 (2) 서버측 admin 세션 쿠키 (3) OWNER_IPS env 3중. 새 기기는 admin 로그인 한 번 또는 `?notrack=1` 접속으로 제외 등록.
- 스키마 변경 없음 (`analytics_events` 기존 컬럼 그대로 사용).
