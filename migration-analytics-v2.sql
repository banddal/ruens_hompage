
alter table public.analytics_events enable row level security;
-- 정책 없음 → service_role(백엔드)만 접근 가능. 방문자는 /api/analytics/track API만 사용.

-- =========================================================
-- 2026-07-02 Analytics 심화: 재방문/체류시간/완독률 추적용 컬럼
-- =========================================================
alter table public.analytics_events add column if not exists client_id text default '';   -- 익명 영구 ID(localStorage UUID, IP 아님)
alter table public.analytics_events add column if not exists session_id text default '';  -- 세션 ID(sessionStorage UUID)
alter table public.analytics_events add column if not exists device text default '';      -- mobile / desktop / tablet
alter table public.analytics_events add column if not exists meta jsonb not null default '{}'::jsonb; -- durationMs, scrollDepth 등

create index if not exists analytics_events_client_idx on public.analytics_events (client_id, created_at desc);
create index if not exists analytics_events_session_idx on public.analytics_events (session_id, created_at desc);
