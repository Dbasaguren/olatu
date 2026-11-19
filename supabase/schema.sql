-- Olatu : tables des comptes utilisateurs.
-- À exécuter une fois dans Supabase : SQL Editor > New query > coller > Run.
-- Sécurité : chaque utilisateur ne peut lire et modifier QUE ses propres lignes (Row Level Security).

-- Réglages de chaque compte (lignes affichées, spot, thème...)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Sessions notées
create table if not exists public.sessions (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  spot text not null,
  date date not null,
  h0 smallint not null check (h0 between 0 and 23),
  h1 smallint not null check (h1 between 0 and 23),
  rating smallint not null check (rating between 0 and 10),
  note text check (char_length(note) <= 200),
  f jsonb,
  saved_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on public.sessions(user_id);

alter table public.profiles enable row level security;
alter table public.sessions enable row level security;

drop policy if exists "Chacun gere son profil" on public.profiles;
create policy "Chacun gere son profil" on public.profiles
  for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "Chacun gere ses sessions" on public.sessions;
create policy "Chacun gere ses sessions" on public.sessions
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Accès uniquement pour les utilisateurs connectés (aucun accès anonyme)
revoke all on public.profiles, public.sessions from anon;
grant select, insert, update, delete on public.profiles, public.sessions to authenticated;

-- Suppression de son propre compte depuis l'appli (exigé par l'App Store)
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Ajout 2026-10 : date de dernière visite de chaque compte (lue uniquement dans le tableau de bord)
alter table public.profiles add column if not exists last_seen timestamptz;

-- Ajout 2026-10 : réglages globaux de l'appli, modifiables uniquement par l'administrateur
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;
drop policy if exists "Un admin voit sa ligne" on public.admins;
create policy "Un admin voit sa ligne" on public.admins for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.admins from anon;
grant select on public.admins to authenticated;

create table if not exists public.app_config (
  key text primary key,
  value jsonb not null
);
alter table public.app_config enable row level security;
drop policy if exists "Tout le monde lit la config" on public.app_config;
create policy "Tout le monde lit la config" on public.app_config for select to anon, authenticated using (true);
drop policy if exists "Seul l'admin modifie la config" on public.app_config;
create policy "Seul l'admin modifie la config" on public.app_config for all to authenticated
  using (exists (select 1 from public.admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admins a where a.user_id = (select auth.uid())));
grant select on public.app_config to anon, authenticated;
grant insert, update on public.app_config to authenticated;
insert into public.app_config (key, value) values ('bicho_enabled', 'true') on conflict (key) do nothing;

-- Ajout 2026-11 : visites (date, durée, appareil) des comptes, lisibles uniquement par l'admin
create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  seconds integer not null default 0,
  device text
);
create index if not exists visits_user_idx on public.visits(user_id);
alter table public.visits enable row level security;
drop policy if exists "Chacun crée ses visites" on public.visits;
create policy "Chacun crée ses visites" on public.visits for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "Chacun met à jour ses visites" on public.visits;
create policy "Chacun met à jour ses visites" on public.visits for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Lecture : soi-même ou admin" on public.visits;
create policy "Lecture : soi-même ou admin" on public.visits for select to authenticated
  using (user_id = (select auth.uid()) or exists (select 1 from public.admins a where a.user_id = (select auth.uid())));
revoke all on public.visits from anon;
grant select, insert, update on public.visits to authenticated;

create or replace function public.admin_user_stats()
returns table(email text, created_at timestamptz, last_visit timestamptz, visits bigint, minutes numeric, device text)
language sql security definer set search_path = ''
as $$
  select u.email::text, u.created_at, max(v.last_seen), count(v.id), round(coalesce(sum(v.seconds), 0) / 60.0, 1),
         (select v2.device from public.visits v2 where v2.user_id = u.id order by v2.last_seen desc limit 1)
  from auth.users u left join public.visits v on v.user_id = u.id
  where exists (select 1 from public.admins a where a.user_id = auth.uid())
  group by u.id
  order by max(v.last_seen) desc nulls last;
$$;
revoke execute on function public.admin_user_stats() from public, anon;
grant execute on function public.admin_user_stats() to authenticated;

-- Ajout 2026-11 : compte facultatif, visites anonymes comptées aussi.
-- Chaque navigateur a un identifiant tiré au hasard (visitor). Le serveur note l'adresse IP
-- tronquée (dernier bloc effacé : 81.250.12.0) et le pays si disponible. Visites gardées 13 mois.
alter table public.visits alter column user_id drop not null;
alter table public.visits add column if not exists visitor text;
alter table public.visits add column if not exists ip text;
alter table public.visits add column if not exists country text;
create index if not exists visits_visitor_idx on public.visits(visitor);
create index if not exists visits_last_seen_idx on public.visits(last_seen);

create or replace function public.visit_start(p_visitor text, p_device text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  h json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  raw text := trim(split_part(coalesce(h->>'cf-connecting-ip', h->>'x-forwarded-for', h->>'x-real-ip', ''), ',', 1));
  tip text;
  vid uuid;
begin
  if p_visitor is null or char_length(p_visitor) > 64 then raise exception 'visiteur invalide'; end if;
  tip := case
    when raw ~ '^\d+\.\d+\.\d+\.\d+$' then regexp_replace(raw, '\.\d+$', '.0')
    when raw like '%:%' then array_to_string((string_to_array(raw, ':'))[1:3], ':') || '::'
    else null end;
  delete from public.visits where last_seen < now() - interval '13 months';
  insert into public.visits (user_id, visitor, device, ip, country)
  values (auth.uid(), p_visitor, left(p_device, 40), tip, left(h->>'cf-ipcountry', 2))
  returning id into vid;
  return vid;
end;
$$;

create or replace function public.visit_ping(p_id uuid, p_seconds integer)
returns void
language sql security definer set search_path = ''
as $$
  update public.visits
     set last_seen = now(),
         seconds = least(greatest(coalesce(p_seconds, 0), 0), 86400),
         user_id = coalesce(user_id, auth.uid())
   where id = p_id and (user_id is null or user_id = auth.uid());
$$;

revoke execute on function public.visit_start(text, text), public.visit_ping(uuid, integer) from public;
grant execute on function public.visit_start(text, text), public.visit_ping(uuid, integer) to anon, authenticated;

create or replace function public.admin_visitor_stats()
returns table(visitor text, email text, first_visit timestamptz, last_visit timestamptz, visits bigint, minutes numeric, device text, ip text, country text)
language sql security definer set search_path = ''
as $$
  with g as (
    select coalesce(v.visitor, v.user_id::text) as visitor,
           (array_agg(v.user_id order by v.last_seen desc) filter (where v.user_id is not null))[1] as uid,
           min(v.started_at) as first_visit, max(v.last_seen) as last_visit, count(*) as visits,
           round(sum(v.seconds) / 60.0, 1) as minutes,
           (array_agg(v.device order by v.last_seen desc))[1] as device,
           (array_agg(v.ip order by v.last_seen desc) filter (where v.ip is not null))[1] as ip,
           (array_agg(v.country order by v.last_seen desc) filter (where v.country is not null))[1] as country
    from public.visits v
    where exists (select 1 from public.admins a where a.user_id = auth.uid())
    group by 1
  )
  select g.visitor, u.email::text, g.first_visit, g.last_visit, g.visits, g.minutes, g.device, g.ip, g.country
  from g left join auth.users u on u.id = g.uid
  order by g.last_visit desc
  limit 1000;
$$;
revoke execute on function public.admin_visitor_stats() from public, anon;
grant execute on function public.admin_visitor_stats() to authenticated;
