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

-- Latest receipt per station, without transferring the complete history.
create index if not exists telemetry_station_latest
  on public.telemetry(site_id, station_id, received_at desc);
create or replace function public.telemetry_station_status(requested_site text)
returns table(station_id text, received_at timestamptz)
language sql stable security invoker set search_path = public
as $$
  select distinct on (t.station_id) t.station_id, t.received_at
  from public.telemetry t where t.site_id = requested_site
  order by t.station_id, t.received_at desc;
$$;
revoke all on function public.telemetry_station_status(text) from public, anon, authenticated;
grant execute on function public.telemetry_station_status(text) to service_role;
