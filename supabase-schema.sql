insert into storage.buckets (id, name, public)
values ('portfolio-assets', 'portfolio-assets', true)
on conflict (id) do update set public = true;

create table if not exists public.projects (
  id text primary key,
  slug text unique not null,
  category text not null default 'Plan',
  metric text default '',
  title text not null,
  period text default '',
  short text default '',
  description text default '',
  role text default '',
  outcome text default '',
  tags jsonb not null default '[]'::jsonb,
  skill_tags jsonb not null default '[]'::jsonb,
  gallery jsonb not null default '[]'::jsonb,
  status text not null default 'draft',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects add column if not exists slug text;
alter table public.projects add column if not exists category text not null default 'Plan';
alter table public.projects add column if not exists metric text default '';
alter table public.projects add column if not exists title text;
alter table public.projects add column if not exists period text default '';
alter table public.projects add column if not exists short text default '';
alter table public.projects add column if not exists description text default '';
alter table public.projects add column if not exists role text default '';
alter table public.projects add column if not exists outcome text default '';
alter table public.projects add column if not exists tags jsonb not null default '[]'::jsonb;
alter table public.projects add column if not exists skill_tags jsonb not null default '[]'::jsonb;
alter table public.projects add column if not exists gallery jsonb not null default '[]'::jsonb;
alter table public.projects add column if not exists status text not null default 'draft';
alter table public.projects add column if not exists sort_order integer not null default 0;
alter table public.projects add column if not exists created_at timestamptz not null default now();
alter table public.projects add column if not exists updated_at timestamptz not null default now();

update public.projects set slug = id where slug is null or slug = '';
update public.projects set title = id where title is null or title = '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_slug_key'
    and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects add constraint projects_slug_key unique (slug);
  end if;
end $$;

create table if not exists public.project_images (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  title text default '',
  description text default '',
  caption text default '',
  alt text default '',
  original_filename text default '',
  path text not null,
  public_url text default '',
  storage_path text default '',
  file_type text default 'image',
  mime_type text default '',
  file_size bigint default 0,
  visibility text not null default 'public',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.project_images add column if not exists project_id text;
alter table public.project_images add column if not exists title text default '';
alter table public.project_images add column if not exists description text default '';
alter table public.project_images add column if not exists caption text default '';
alter table public.project_images add column if not exists alt text default '';
alter table public.project_images add column if not exists original_filename text default '';
alter table public.project_images add column if not exists path text;
alter table public.project_images add column if not exists public_url text default '';
alter table public.project_images add column if not exists storage_path text default '';
alter table public.project_images add column if not exists file_type text default 'image';
alter table public.project_images add column if not exists mime_type text default '';
alter table public.project_images add column if not exists file_size bigint default 0;
alter table public.project_images add column if not exists visibility text not null default 'public';
alter table public.project_images add column if not exists sort_order integer not null default 0;
alter table public.project_images add column if not exists created_at timestamptz not null default now();

create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  title text default '',
  description text default '',
  caption text default '',
  alt text default '',
  original_filename text default '',
  path text not null,
  public_url text default '',
  storage_path text default '',
  file_type text default 'file',
  mime_type text default '',
  file_size bigint default 0,
  visibility text not null default 'request',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.project_files add column if not exists project_id text;
alter table public.project_files add column if not exists title text default '';
alter table public.project_files add column if not exists description text default '';
alter table public.project_files add column if not exists caption text default '';
alter table public.project_files add column if not exists alt text default '';
alter table public.project_files add column if not exists original_filename text default '';
alter table public.project_files add column if not exists path text;
alter table public.project_files add column if not exists public_url text default '';
alter table public.project_files add column if not exists storage_path text default '';
alter table public.project_files add column if not exists file_type text default 'file';
alter table public.project_files add column if not exists mime_type text default '';
alter table public.project_files add column if not exists file_size bigint default 0;
alter table public.project_files add column if not exists visibility text not null default 'request';
alter table public.project_files add column if not exists sort_order integer not null default 0;
alter table public.project_files add column if not exists created_at timestamptz not null default now();

create index if not exists projects_status_sort_idx on public.projects(status, sort_order);
create index if not exists project_images_project_idx on public.project_images(project_id, sort_order);
create index if not exists project_files_project_idx on public.project_files(project_id, sort_order);

alter table public.projects enable row level security;
alter table public.project_images enable row level security;
alter table public.project_files enable row level security;

drop policy if exists "public read published projects" on public.projects;
drop policy if exists "public read project images" on public.project_images;
drop policy if exists "public read public project files" on public.project_files;

create policy "public read published projects"
on public.projects for select
using (status <> 'private');

create policy "public read project images"
on public.project_images for select
using (
  exists (
    select 1 from public.projects
    where projects.id = project_images.project_id
    and projects.status <> 'private'
  )
);

create policy "public read public project files"
on public.project_files for select
using (
  visibility <> 'private'
  and exists (
    select 1 from public.projects
    where projects.id = project_files.project_id
    and projects.status <> 'private'
  )
);
