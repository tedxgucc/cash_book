-- TEDxGUC Cashbook — Supabase schema
-- Run this once in Supabase: SQL Editor → New query → paste → Run.
-- Safe to re-run: everything uses "if not exists" / "or replace".

-- ───────────────────────── Team access list ─────────────────────────
-- Only people listed here can see or change anything.
create table if not exists public.team_members (
  email      text primary key check (email = lower(email)),
  name       text not null,
  role       text,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members where email = lower(auth.jwt() ->> 'email'));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members where email = lower(auth.jwt() ->> 'email') and is_admin);
$$;

grant execute on function public.is_team()  to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ───────────────────────── App data ─────────────────────────
-- Each row is one record the app keeps as JSON (same shape the app uses).
create table if not exists public.entries  (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.settings (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.sponsors (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.activity (id text primary key, data jsonb not null, at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists activity_at_idx on public.activity (at desc);

alter table public.team_members enable row level security;
alter table public.entries      enable row level security;
alter table public.settings     enable row level security;
alter table public.sponsors     enable row level security;
alter table public.activity     enable row level security;

-- Team members read and write the ledger, settings and sponsors.
do $$
declare t text;
begin
  foreach t in array array['entries','settings','sponsors'] loop
    execute format('drop policy if exists "team read" on public.%I', t);
    execute format('drop policy if exists "team write" on public.%I', t);
    execute format('create policy "team read" on public.%I for select to authenticated using (public.is_team())', t);
    execute format('create policy "team write" on public.%I for all to authenticated using (public.is_team()) with check (public.is_team())', t);
  end loop;
end $$;

-- Activity log: team reads and adds; nobody edits or deletes history from the app.
drop policy if exists "team read"   on public.activity;
drop policy if exists "team insert" on public.activity;
create policy "team read"   on public.activity for select to authenticated using (public.is_team());
create policy "team insert" on public.activity for insert to authenticated with check (public.is_team());

-- Team list: team reads it (for names); only admins change it.
drop policy if exists "team read"    on public.team_members;
drop policy if exists "admins write" on public.team_members;
create policy "team read"    on public.team_members for select to authenticated using (public.is_team());
create policy "admins write" on public.team_members for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ───────────────────────── Receipts (private files) ─────────────────────────
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists "team reads receipts"   on storage.objects;
drop policy if exists "team uploads receipts" on storage.objects;
drop policy if exists "team deletes receipts" on storage.objects;
create policy "team reads receipts"   on storage.objects for select to authenticated using (bucket_id = 'receipts' and public.is_team());
create policy "team uploads receipts" on storage.objects for insert to authenticated with check (bucket_id = 'receipts' and public.is_team());
create policy "team deletes receipts" on storage.objects for delete to authenticated using (bucket_id = 'receipts' and public.is_team());

-- ───────────────────────── Live updates ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['entries','settings','sponsors','activity'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ───────────────────────── Reporting views ─────────────────────────
-- Query these in the SQL editor or connect them to Google Sheets / Looker Studio.
create or replace view public.ledger with (security_invoker = true) as
select
  id,
  (data ->> 'year')::int                         as season,
  data ->> 'kind'                                as kind,
  data ->> 'status'                              as status,
  (data ->> 'amount')::numeric                   as amount,
  case when data ->> 'kind' = 'bankIn' and coalesce((data ->> 'taxable')::boolean, true)
       then (data ->> 'amount')::numeric * coalesce((data ->> 'vatRate')::numeric, 14) / 100 else 0 end as vat,
  data ->> 'desc'                                as description,
  data ->> 'member'                              as member,
  data ->> 'counterparty'                        as counterparty,
  data ->> 'phase'                               as phase,
  nullif(data ->> 'fatora', '')                  as fatora,
  data ->> 'category'                            as category,
  nullif(data ->> 'sponsor', '')                 as sponsor,
  data ->> 'paidFrom'                            as paid_from,
  updated_at
from public.entries;

create or replace view public.season_summary with (security_invoker = true) as
select
  season,
  sum(amount) filter (where kind = 'cashIn'  and status <> 'planned')                     as cash_in,
  sum(amount) filter (where kind = 'cashOut' and status <> 'planned')                     as cash_out,
  sum(amount) filter (where kind = 'bankIn'  and status <> 'planned')                     as bank_in_gross,
  sum(vat)    filter (where kind = 'bankIn'  and status <> 'planned')                     as vat_removed,
  sum(amount) filter (where kind = 'bankOut' and status <> 'planned')                     as bank_out,
  count(distinct lower(sponsor)) filter (where category = 'sponsor' and status <> 'planned') as paying_sponsors
from public.ledger
group by season
order by season;

-- ───────────────────────── First admin ─────────────────────────
-- Change the email/name below to yours before running, then add the rest of the
-- team in Table Editor → team_members (emails in lowercase).
insert into public.team_members (email, name, role, is_admin)
values ('kareemmroshdy@gmail.com', 'Kareem Roshdy', 'Admin', true),
       ('tedxguc.ops26@gmail.com', 'TEDxGUC Operations', 'Admin', true)
on conflict (email) do nothing;
