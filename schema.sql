-- ============================================================
--  e-Prusy — schemat bazy danych (Supabase / PostgreSQL)
--  Wklej CAŁY plik do: Supabase Studio → SQL Editor → Run.
--  Działa tak samo na Supabase w chmurze i na self-hosted.
--
--  Plik można wykonać ponownie na działającej bazie — nie kasuje
--  danych, dokłada tylko to, czego jeszcze nie ma.
-- ============================================================

-- ---------- 1. Typy ----------
do $$ begin
  create type public.sad as enum
    ('rejonowy', 'okregowy', 'apelacyjny', 'wojskowy', 'najwyzszy', 'tk', 'ts');
exception when duplicate_object then null; end $$;

-- ---------- 2. Profil ----------
-- admin_serwisu  — pełny administrator (System Administratora, nadaje uprawnienia)
-- pseo_admin     — administrator Egzaminów Obywatelskich
-- sad            — jeśli ustawione, użytkownik jest sędzią danego sądu
create table if not exists public.profil (
  id            uuid primary key references auth.users on delete cascade,
  email         text,
  imie          text,
  pni           text,                       -- publiczny numer identyfikacyjny (nadawany po rejestracji)
  admin_serwisu boolean not null default false,
  pseo_admin    boolean not null default false,
  sad           public.sad,                 -- null = nie jest sędzią
  utworzono     timestamptz not null default now()
);

-- ---------- 3. Klucze rejestracji (PNI) ----------
create table if not exists public.klucz_rejestracji (
  id          uuid primary key default gen_random_uuid(),
  kod         text unique not null,
  uzyty       boolean not null default false,
  uzyty_przez uuid references public.profil(id) on delete set null,
  opis        text,
  autor       uuid references public.profil(id) on delete set null,
  utworzono   timestamptz not null default now()
);

-- ---------- 4. Rejestracja: pierwszy użytkownik = admin, reszta na klucz ----------
-- Klucz przekazujemy w metadanych konta (pole 'pni'). Trigger sprawdza go
-- i „zużywa”. Klient dodatkowo waliduje klucz przed rejestracją (funkcja
-- sprawdz_klucz), więc to tu jest już tylko domknięciem po stronie bazy.
create or replace function public.obsluz_nowego_uzytkownika()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  pierwszy boolean;
  podany   text;
  rekord   public.klucz_rejestracji%rowtype;
begin
  select count(*) = 0 into pierwszy from public.profil;
  podany := nullif(new.raw_user_meta_data->>'pni', '');

  insert into public.profil (id, email, imie, admin_serwisu)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'imie', split_part(new.email, '@', 1)),
    pierwszy                                   -- pierwszy z automatu adminem
  )
  on conflict (id) do nothing;

  -- nadaj PNI: dla pierwszego generujemy, dla reszty bierzemy z klucza
  if pierwszy then
    update public.profil set pni = 'PNI-' || upper(substr(replace(new.id::text,'-',''),1,8))
     where id = new.id;
  elsif podany is not null then
    select * into rekord from public.klucz_rejestracji
      where kod = podany and uzyty = false limit 1;
    if found then
      update public.klucz_rejestracji
         set uzyty = true, uzyty_przez = new.id
       where id = rekord.id;
      update public.profil set pni = rekord.kod where id = new.id;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_nowy_uzytkownik on auth.users;
create trigger trg_nowy_uzytkownik
  after insert on auth.users
  for each row execute function public.obsluz_nowego_uzytkownika();

-- ---------- 5. Funkcje pomocnicze ----------
create or replace function public.jestem_adminem()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select admin_serwisu from public.profil where id = auth.uid()), false) $$;

create or replace function public.jestem_pseo_adminem()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select pseo_admin or admin_serwisu from public.profil where id = auth.uid()), false) $$;

create or replace function public.moj_sad()
returns public.sad language sql stable security definer set search_path = public
as $$ select sad from public.profil where id = auth.uid() $$;

-- Walidacja klucza rejestracji BEZ ujawniania listy kluczy.
-- Zwraca: 'pierwszy' | 'ok' | 'zajety' | 'zly'
create or replace function public.sprawdz_klucz(kod_in text)
returns text language plpgsql stable security definer set search_path = public
as $$
declare r public.klucz_rejestracji%rowtype;
begin
  if (select count(*) from public.profil) = 0 then return 'pierwszy'; end if;
  select * into r from public.klucz_rejestracji where kod = kod_in limit 1;
  if not found then return 'zly'; end if;
  if r.uzyty then return 'zajety'; end if;
  return 'ok';
end $$;

-- ---------- 6. PSEO: pytania, klucze egzaminu, egzaminy ----------
create table if not exists public.pseo_pytanie (
  id         uuid primary key default gen_random_uuid(),
  tresc      text not null,
  odpowiedzi jsonb not null default '[]'::jsonb,   -- ["A","B","C","D"]
  poprawna   integer not null default 0,           -- indeks poprawnej odpowiedzi
  autor      uuid references public.profil(id) on delete set null,
  utworzono  timestamptz not null default now()
);

create table if not exists public.pseo_klucz (
  id          uuid primary key default gen_random_uuid(),
  kod         text unique not null,
  uzyty       boolean not null default false,
  uzyty_przez uuid references public.profil(id) on delete set null,
  autor       uuid references public.profil(id) on delete set null,
  utworzono   timestamptz not null default now()
);

create table if not exists public.pseo_egzamin (
  id                uuid primary key default gen_random_uuid(),
  uzytkownik        uuid references public.profil(id) on delete cascade,
  pytania           jsonb not null default '[]'::jsonb,   -- lista id pytań
  odpowiedzi        jsonb not null default '[]'::jsonb,   -- wybory zdającego
  wynik_pisemny     numeric,                              -- % (auto)
  wynik_ustny       numeric,                              -- % (wpisuje admin)
  wynik_ustawodawczy numeric,                             -- % (wpisuje admin)
  ujawniony         boolean not null default false,
  zdany             boolean,
  utworzono         timestamptz not null default now()
);

-- Losowanie 30 pytań BEZ pola „poprawna”. Zużywa klucz egzaminu.
create or replace function public.pseo_rozpocznij(kod_in text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare k public.pseo_klucz%rowtype; wynik jsonb;
begin
  if auth.uid() is null then raise exception 'Brak zalogowania'; end if;
  select * into k from public.pseo_klucz where kod = kod_in and uzyty = false limit 1;
  if not found then return jsonb_build_object('ok', false, 'blad', 'Nieprawidłowy lub zużyty klucz egzaminu.'); end if;

  select coalesce(jsonb_agg(row_to_json(p)), '[]'::jsonb) into wynik from (
    select id, tresc, odpowiedzi from public.pseo_pytanie order by random() limit 30
  ) p;

  if jsonb_array_length(wynik) < 1 then
    return jsonb_build_object('ok', false, 'blad', 'Baza pytań jest pusta — zgłoś się do administratora PSEO.');
  end if;

  update public.pseo_klucz set uzyty = true, uzyty_przez = auth.uid() where id = k.id;
  return jsonb_build_object('ok', true, 'pytania', wynik);
end $$;

-- Ocena części pisemnej po stronie bazy (poprawne odpowiedzi nie wychodzą na klienta).
-- odp_in: [{"id":"...","wybor":2}, ...]
create or replace function public.pseo_zloz(odp_in jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  dobre int := 0; wszystkie int := 0; procent numeric; nowe uuid;
  el jsonb;
begin
  if uid is null then raise exception 'Brak zalogowania'; end if;
  for el in select * from jsonb_array_elements(odp_in) loop
    wszystkie := wszystkie + 1;
    if exists (select 1 from public.pseo_pytanie
                where id = (el->>'id')::uuid and poprawna = (el->>'wybor')::int) then
      dobre := dobre + 1;
    end if;
  end loop;
  procent := case when wszystkie > 0 then round(dobre::numeric * 100 / wszystkie, 2) else 0 end;

  insert into public.pseo_egzamin (uzytkownik, pytania, odpowiedzi, wynik_pisemny)
  values (uid,
          (select coalesce(jsonb_agg(e->>'id'), '[]'::jsonb) from jsonb_array_elements(odp_in) e),
          odp_in, procent)
  returning id into nowe;

  return jsonb_build_object('ok', true, 'id', nowe, 'dobre', dobre, 'wszystkie', wszystkie, 'procent', procent);
end $$;

-- ---------- 7. ESS: wyroki ----------
create table if not exists public.ess_wyrok (
  id         uuid primary key default gen_random_uuid(),
  sad        public.sad not null,
  sygnatura  text,
  tytul      text not null,
  tresc      text not null default '',
  strony     text,
  sedzia     uuid references public.profil(id) on delete set null,
  sedzia_imie text,
  data_wyroku text,
  utworzono  timestamptz not null default now()
);
create index if not exists idx_wyrok_sad on public.ess_wyrok (sad, utworzono desc);

-- ============================================================
--  8. Ochrona wierszy (RLS)
-- ============================================================
alter table public.profil            enable row level security;
alter table public.klucz_rejestracji enable row level security;
alter table public.pseo_pytanie      enable row level security;
alter table public.pseo_klucz        enable row level security;
alter table public.pseo_egzamin      enable row level security;
alter table public.ess_wyrok         enable row level security;

-- Profil: każdy zalogowany widzi listę (potrzebne panelom). Sam zmienia imię,
-- uprawnienia zmienia wyłącznie admin serwisu.
drop policy if exists profil_odczyt on public.profil;
create policy profil_odczyt on public.profil for select to authenticated using (true);

drop policy if exists profil_ja on public.profil;
create policy profil_ja on public.profil for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid()
    and admin_serwisu = (select admin_serwisu from public.profil where id = auth.uid())
    and pseo_admin   = (select pseo_admin   from public.profil where id = auth.uid())
    and sad is not distinct from (select sad from public.profil where id = auth.uid()));

drop policy if exists profil_admin on public.profil;
create policy profil_admin on public.profil for update to authenticated
  using (public.jestem_adminem()) with check (public.jestem_adminem());

-- Klucze rejestracji: tylko admin serwisu. (Walidację przy rejestracji robi
-- funkcja sprawdz_klucz jako security definer, więc anon nie czyta tabeli.)
drop policy if exists klucz_rej_admin on public.klucz_rejestracji;
create policy klucz_rej_admin on public.klucz_rejestracji for all to authenticated
  using (public.jestem_adminem()) with check (public.jestem_adminem());

-- Pytania PSEO: pełny dostęp tylko admin PSEO. Zdający dostają pytania przez
-- funkcję pseo_rozpocznij (bez pola „poprawna”).
drop policy if exists pytanie_admin on public.pseo_pytanie;
create policy pytanie_admin on public.pseo_pytanie for all to authenticated
  using (public.jestem_pseo_adminem()) with check (public.jestem_pseo_adminem());

-- Klucze egzaminu: widzi/tworzy admin PSEO. Zużycie przez pseo_rozpocznij.
drop policy if exists pklucz_admin on public.pseo_klucz;
create policy pklucz_admin on public.pseo_klucz for all to authenticated
  using (public.jestem_pseo_adminem()) with check (public.jestem_pseo_adminem());

-- Egzaminy: zdający widzi tylko swoje i tylko po ujawnieniu wyniku.
-- Admin PSEO widzi i edytuje wszystkie (wpisuje część ustną/ustawodawczą, ujawnia).
drop policy if exists egz_odczyt on public.pseo_egzamin;
create policy egz_odczyt on public.pseo_egzamin for select to authenticated
  using (public.jestem_pseo_adminem() or (uzytkownik = auth.uid() and ujawniony));

drop policy if exists egz_admin on public.pseo_egzamin;
create policy egz_admin on public.pseo_egzamin for update to authenticated
  using (public.jestem_pseo_adminem()) with check (public.jestem_pseo_adminem());

drop policy if exists egz_usun on public.pseo_egzamin;
create policy egz_usun on public.pseo_egzamin for delete to authenticated
  using (public.jestem_pseo_adminem());

-- Wyroki: czyta każdy (również gość). Publikuje sędzia właściwego sądu; admin
-- serwisu może wszystko.
drop policy if exists wyrok_odczyt on public.ess_wyrok;
create policy wyrok_odczyt on public.ess_wyrok for select to anon, authenticated using (true);

drop policy if exists wyrok_sedzia on public.ess_wyrok;
create policy wyrok_sedzia on public.ess_wyrok for insert to authenticated
  with check (public.jestem_adminem() or public.moj_sad() = sad);

drop policy if exists wyrok_edycja on public.ess_wyrok;
create policy wyrok_edycja on public.ess_wyrok for update to authenticated
  using (public.jestem_adminem() or sedzia = auth.uid())
  with check (public.jestem_adminem() or sedzia = auth.uid());

drop policy if exists wyrok_usun on public.ess_wyrok;
create policy wyrok_usun on public.ess_wyrok for delete to authenticated
  using (public.jestem_adminem() or sedzia = auth.uid());

-- ============================================================
--  Gdyby trzeba było ręcznie nadać sobie administratora:
--  update public.profil set admin_serwisu = true where email = 'twoj@email.pl';
-- ============================================================
