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
