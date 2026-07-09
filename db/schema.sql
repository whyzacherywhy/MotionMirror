create extension if not exists pgcrypto;

create table if not exists coaches (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  display_name text not null default 'Coach',
  password_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists runner_profiles (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references coaches(id) on delete cascade,
  name text not null,
  age text not null default '',
  location text not null default '',
  goals text not null default '',
  coach_notes text not null default '',
  photo_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists run_entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references runner_profiles(id) on delete cascade,
  title text not null,
  date_label text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  distance_miles numeric(8, 3) not null default 0,
  elapsed_seconds integer not null default 0,
  average_pace numeric(8, 3) not null default 0,
  elevation_gain_feet integer not null default 0,
  elevation_loss_feet integer not null default 0,
  weather jsonb not null default '{}'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists run_route_points (
  id bigserial primary key,
  run_id uuid not null references run_entries(id) on delete cascade,
  point_index integer not null,
  lat double precision not null,
  lng double precision not null,
  altitude double precision,
  recorded_at timestamptz,
  unique (run_id, point_index)
);

create table if not exists run_mile_splits (
  id bigserial primary key,
  run_id uuid not null references run_entries(id) on delete cascade,
  mile_number integer not null,
  label text not null default '',
  distance_miles numeric(8, 3) not null default 1,
  is_partial boolean not null default false,
  ended_at timestamptz,
  seconds integer not null default 0,
  pace numeric(8, 3) not null default 0,
  elevation_feet integer,
  unique (run_id, mile_number)
);

create table if not exists run_coach_splits (
  id bigserial primary key,
  run_id uuid not null references run_entries(id) on delete cascade,
  split_number integer not null,
  started_at timestamptz,
  ended_at timestamptz,
  elapsed_seconds integer not null default 0,
  distance_meters numeric(10, 2) not null default 0,
  distance_miles numeric(8, 3) not null default 0,
  pace numeric(8, 3) not null default 0,
  elevation_feet integer,
  unique (run_id, split_number)
);

create table if not exists run_history_items (
  id bigserial primary key,
  run_id uuid not null references run_entries(id) on delete cascade,
  happened_at timestamptz,
  item_type text not null default 'note',
  text text not null
);

create table if not exists live_sessions (
  id text primary key,
  coach_id uuid references coaches(id) on delete set null,
  runner_name text not null default 'Runner',
  status text not null default 'idle',
  started_at timestamptz,
  elapsed_ms integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists runner_profiles_coach_id_idx on runner_profiles(coach_id);
create index if not exists run_entries_profile_id_started_at_idx on run_entries(profile_id, started_at desc);
create index if not exists run_route_points_run_id_idx on run_route_points(run_id, point_index);
create index if not exists run_history_items_run_id_idx on run_history_items(run_id, happened_at);

alter table run_mile_splits add column if not exists label text not null default '';
alter table run_mile_splits add column if not exists distance_miles numeric(8, 3) not null default 1;
alter table run_mile_splits add column if not exists is_partial boolean not null default false;
alter table run_coach_splits add column if not exists distance_meters numeric(10, 2) not null default 0;
alter table coaches add column if not exists password_hash text;
