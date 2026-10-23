-- Ejecutar en el editor SQL del proyecto Supabase.
create table if not exists public.telemetry (
  id bigint generated always as identity primary key,
  station_id text not null,
  site_id text not null,
  temperature_c double precision not null check (temperature_c between -40 and 80),
  humidity_pct double precision not null check (humidity_pct between 0 and 100),
  simulated boolean not null default true check (simulated = true),
  received_at timestamptz not null default now()
);
create index if not exists telemetry_site_time on public.telemetry(site_id, received_at desc);
alter table public.telemetry enable row level security;
-- Sin políticas públicas. Solo el servidor utiliza la clave service_role.
revoke all on public.telemetry from anon, authenticated;
grant select, insert on public.telemetry to service_role;
grant usage, select on sequence public.telemetry_id_seq to service_role;
