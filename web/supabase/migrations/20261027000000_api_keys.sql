-- Hundredfoldz accounts: a visitor's own Claude API key, saved to their account so they don't
-- have to paste it on every device. Apply after 20261026000000_accounts.sql (SQL editor or
-- supabase db push).
--
-- The key is never stored in plain text: the server encrypts it (AES-256-GCM) with
-- KEY_ENCRYPTION_SECRET, a secret that lives only in the server's environment, bound to the
-- user's id. The database alone (a dump, a backup) can't reveal a key. The browser never gets
-- the key back, only its last four characters.

create table if not exists public.api_keys (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- base64url of iv (12 bytes) + ciphertext + tag, written by lib/server/key-vault.ts
  sealed text not null check (char_length(sealed) between 40 and 1200 and sealed ~ '^[A-Za-z0-9_-]+$'),
  last4 text not null check (last4 ~ '^[A-Za-z0-9_-]{4}$'),
  model text check (model is null or char_length(model) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.api_keys enable row level security;

drop policy if exists "api_keys: read own" on public.api_keys;
drop policy if exists "api_keys: add own" on public.api_keys;
drop policy if exists "api_keys: change own" on public.api_keys;
drop policy if exists "api_keys: delete own" on public.api_keys;
create policy "api_keys: read own" on public.api_keys for select to authenticated using ((select auth.uid()) = user_id);
create policy "api_keys: add own" on public.api_keys for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "api_keys: change own" on public.api_keys for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "api_keys: delete own" on public.api_keys for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.api_keys from anon, authenticated;
grant select, insert, delete on public.api_keys to authenticated;
grant update (sealed, last4, model, updated_at) on public.api_keys to authenticated;

create or replace function public.api_keys_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists api_keys_touch on public.api_keys;
create trigger api_keys_touch before update on public.api_keys
for each row execute function public.api_keys_touch();
