-- Hundredfoldz accounts, phase 1: decks saved to a user's account.
-- Apply with the Supabase CLI (supabase db push) or paste into the SQL editor once.
-- Every row belongs to one user, and row-level security lets a user see and change only their own.

create table if not exists public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  commander text not null check (char_length(commander) between 1 and 150),
  partner text check (partner is null or char_length(partner) <= 150),
  colors text not null default '' check (colors ~ '^[WUBRG]{0,5}$'),
  bracket smallint check (bracket is null or bracket between 1 and 5),
  -- the deck itself, in the same compressed format as share links (lib/shared/share.ts)
  d text not null check (char_length(d) between 1 and 8000 and d ~ '^[A-Za-z0-9_-]+$'),
  d_hash text generated always as (md5(d)) stored,
  model text check (model is null or char_length(model) <= 80),
  usage jsonb check (usage is null or (jsonb_typeof(usage) = 'object' and pg_column_size(usage) < 1000)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- the same deck saved twice is one row
  unique (user_id, d_hash)
);

create index if not exists decks_user_created on public.decks (user_id, created_at desc);

alter table public.decks enable row level security;

drop policy if exists "decks: read own" on public.decks;
drop policy if exists "decks: add own" on public.decks;
drop policy if exists "decks: change own" on public.decks;
drop policy if exists "decks: delete own" on public.decks;
create policy "decks: read own" on public.decks for select to authenticated using ((select auth.uid()) = user_id);
create policy "decks: add own" on public.decks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "decks: change own" on public.decks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "decks: delete own" on public.decks for delete to authenticated using ((select auth.uid()) = user_id);

-- only the name can change after saving; the rest is the deck as built
-- Supabase's default privileges grant everything on new tables; keep only what the app needs
revoke all on public.decks from anon, authenticated;
grant select, insert, delete on public.decks to authenticated;
grant update (name, updated_at) on public.decks to authenticated;

-- keep updated_at current, and cap each account at 1,000 decks
create or replace function public.decks_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- one insert at a time per user, so parallel saves can't pass the cap together
    perform pg_advisory_xact_lock(hashtext(new.user_id::text));
    if (select count(*) from public.decks where user_id = new.user_id) >= 1000 then
      raise exception 'deck limit reached (1000 per account)' using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists decks_before_write on public.decks;
create trigger decks_before_write before insert or update on public.decks
for each row execute function public.decks_before_write();

-- "Delete my account": removes the user and, through the foreign key, all their decks.
-- Runs with the owner's rights but only ever deletes the caller.
create or replace function public.delete_own_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
