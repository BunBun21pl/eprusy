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
-- sady           — lista sądów, w których użytkownik może wydawać wyroki (pusta = nie jest sędzią)
create table if not exists public.profil (
  id            uuid primary key references auth.users on delete cascade,
  email         text,
  imie          text,
  pni           text,                       -- publiczny numer identyfikacyjny (nadawany po rejestracji)
  admin_serwisu boolean not null default false,
  pseo_admin    boolean not null default false,
  prokurator    boolean not null default false,      -- może wnosić akty oskarżenia
  sad           public.sad,                 -- (dawne, pojedyncze — pozostawione dla zgodności)
  sady          public.sad[] not null default '{}',   -- sądy, w których może orzekać
  utworzono     timestamptz not null default now()
);

-- Gdyby tabela istniała bez kolumny sady — dołóż ją i przenieś stare uprawnienie.
alter table public.profil add column if not exists sady public.sad[] not null default '{}';
alter table public.profil add column if not exists prokurator boolean not null default false;
update public.profil set sady = array[sad]
  where sad is not null and (sady is null or sady = '{}');

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

create or replace function public.moje_sady()
returns public.sad[] language sql stable security definer set search_path = public
as $$ select coalesce((select sady from public.profil where id = auth.uid()), '{}') $$;

create or replace function public.czy_sedzia_sadu(s public.sad)
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select s = any(sady) from public.profil where id = auth.uid()), false) $$;

create or replace function public.czy_prokuratorem()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select prokurator or admin_serwisu from public.profil where id = auth.uid()), false) $$;

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
-- Każdy wyrok wydawany jest „w imieniu Republiki Pruskiej”.
create table if not exists public.ess_wyrok (
  id           uuid primary key default gen_random_uuid(),
  sad          public.sad not null,          -- kategoria sądu (do grupowania)
  nazwa_sadu   text,                          -- pełna nazwa, np. „Sąd Okręgowy w Królewcu”
  miejscowosc  text,
  sygnatura    text,
  przedmiot    text,                          -- przedmiot sprawy (tytuł)
  strony       text,                          -- strony / uczestnicy
  status       text not null default 'prawomocny',
  sklad        text,                          -- skład orzekający
  sentencja    jsonb not null default '[]'::jsonb,  -- lista punktów rozstrzygnięcia
  uzasadnienie text,
  tytul        text,                          -- (dawne pole — pozostawione dla zgodności)
  tresc        text,                          -- (dawne pole — pozostawione dla zgodności)
  sedzia       uuid references public.profil(id) on delete set null,
  sedzia_imie  text,
  data_wyroku  text,
  utworzono    timestamptz not null default now()
);
create index if not exists idx_wyrok_sad on public.ess_wyrok (sad, utworzono desc);

-- Dołożenie kolumn, gdyby tabela istniała w starszej wersji.
alter table public.ess_wyrok add column if not exists nazwa_sadu   text;
alter table public.ess_wyrok add column if not exists miejscowosc  text;
alter table public.ess_wyrok add column if not exists przedmiot    text;
alter table public.ess_wyrok add column if not exists status       text not null default 'prawomocny';
alter table public.ess_wyrok add column if not exists sklad        text;
alter table public.ess_wyrok add column if not exists sentencja    jsonb not null default '[]'::jsonb;
alter table public.ess_wyrok add column if not exists uzasadnienie text;
alter table public.ess_wyrok alter column tytul drop not null;
alter table public.ess_wyrok alter column tresc set default '';

-- ---------- 7b. ESS: akty oskarżenia (prokuratura) ----------
create table if not exists public.ess_akt (
  id             uuid primary key default gen_random_uuid(),
  sad            public.sad not null,          -- sąd, do którego kierowany akt (grupowanie)
  prokuratura    text,                          -- np. „Prokuratura Rejonowa w Królewcu”
  miejscowosc    text,
  data_aktu      text,
  sygnatura      text,
  oskarzony      text,                          -- oskarżony/oskarżeni
  pokrzywdzony   text,
  zarzuty        jsonb not null default '[]'::jsonb,  -- lista zarzutów (punkty)
  uzasadnienie   text,
  wnioski        text,                          -- wnioski końcowe (dowodowe, o karę)
  prokurator     uuid references public.profil(id) on delete set null,
  prokurator_imie text,
  utworzono      timestamptz not null default now()
);
create index if not exists idx_akt_sad on public.ess_akt (sad, utworzono desc);

-- ============================================================
--  8. Ochrona wierszy (RLS)
-- ============================================================
alter table public.profil            enable row level security;
alter table public.klucz_rejestracji enable row level security;
alter table public.pseo_pytanie      enable row level security;
alter table public.pseo_klucz        enable row level security;
alter table public.pseo_egzamin      enable row level security;
alter table public.ess_wyrok         enable row level security;
alter table public.ess_akt           enable row level security;

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
    and prokurator   = (select prokurator   from public.profil where id = auth.uid())
    and sady is not distinct from (select sady from public.profil where id = auth.uid()));

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
  with check (public.jestem_adminem() or public.czy_sedzia_sadu(sad));

drop policy if exists wyrok_edycja on public.ess_wyrok;
create policy wyrok_edycja on public.ess_wyrok for update to authenticated
  using (public.jestem_adminem() or sedzia = auth.uid())
  with check (public.jestem_adminem() or sedzia = auth.uid());

drop policy if exists wyrok_usun on public.ess_wyrok;
create policy wyrok_usun on public.ess_wyrok for delete to authenticated
  using (public.jestem_adminem() or sedzia = auth.uid());

-- Akty oskarżenia: czyta każdy. Wnosi prokurator (lub admin). Autor/admin edytuje i usuwa.
drop policy if exists akt_odczyt on public.ess_akt;
create policy akt_odczyt on public.ess_akt for select to anon, authenticated using (true);

drop policy if exists akt_prok on public.ess_akt;
create policy akt_prok on public.ess_akt for insert to authenticated
  with check (public.czy_prokuratorem());

drop policy if exists akt_edycja on public.ess_akt;
create policy akt_edycja on public.ess_akt for update to authenticated
  using (public.jestem_adminem() or prokurator = auth.uid())
  with check (public.jestem_adminem() or prokurator = auth.uid());

drop policy if exists akt_usun on public.ess_akt;
create policy akt_usun on public.ess_akt for delete to authenticated
  using (public.jestem_adminem() or prokurator = auth.uid());

-- ============================================================
--  9. Elektroniczny Portal Wyborczy
-- ============================================================
do $$ begin
  create type public.typ_wyborow as enum ('referendum', 'prezydenckie', 'samorzadowe', 'parlamentarne');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.status_wyborow as enum ('przygotowanie', 'trwa', 'zakonczone');
exception when duplicate_object then null; end $$;

create table if not exists public.wybory (
  id        uuid primary key default gen_random_uuid(),
  tytul     text not null,
  typ       public.typ_wyborow not null,
  miasto    text,                         -- dla wyborów samorządowych
  opcje     jsonb not null default '{}'::jsonb,  -- pytania/kandydaci/komitety (zależnie od typu)
  status    public.status_wyborow not null default 'przygotowanie',
  autor     uuid references public.profil(id) on delete set null,
  utworzono timestamptz not null default now()
);

-- Fakt oddania głosu (zapobiega podwójnemu głosowaniu). Nie zawiera treści głosu.
create table if not exists public.wybory_udzial (
  wybory    uuid not null references public.wybory(id) on delete cascade,
  wyborca   uuid not null references public.profil(id) on delete cascade,
  utworzono timestamptz not null default now(),
  primary key (wybory, wyborca)
);

-- Anonimowy głos. Nie zawiera informacji, kto go oddał.
create table if not exists public.wybory_glos (
  id        uuid primary key default gen_random_uuid(),
  wybory    uuid not null references public.wybory(id) on delete cascade,
  wybor     jsonb not null,
  utworzono timestamptz not null default now()
);
create index if not exists idx_glos_wybory on public.wybory_glos (wybory);

-- Oddanie głosu: atomowo zapisuje udział (kto) i anonimowy głos (co), bez ich łączenia.
create or replace function public.oddaj_glos(wybory_id uuid, wybor_in jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare uid uuid := auth.uid(); w public.wybory%rowtype;
begin
  if uid is null then return jsonb_build_object('ok', false, 'blad', 'Brak zalogowania.'); end if;
  select * into w from public.wybory where id = wybory_id;
  if not found then return jsonb_build_object('ok', false, 'blad', 'Nie znaleziono wyborów.'); end if;
  if w.status <> 'trwa' then return jsonb_build_object('ok', false, 'blad', 'Głosowanie nie jest aktywne.'); end if;
  if exists (select 1 from public.wybory_udzial where wybory = wybory_id and wyborca = uid) then
    return jsonb_build_object('ok', false, 'blad', 'Głos w tych wyborach został już przez Ciebie oddany.');
  end if;
  insert into public.wybory_udzial (wybory, wyborca) values (wybory_id, uid);
  insert into public.wybory_glos (wybory, wybor) values (wybory_id, wybor_in);
  return jsonb_build_object('ok', true);
end $$;

alter table public.wybory        enable row level security;
alter table public.wybory_udzial enable row level security;
alter table public.wybory_glos   enable row level security;

-- Wybory: widzi każdy zalogowany; zarządza wyłącznie administrator.
drop policy if exists wybory_odczyt on public.wybory;
create policy wybory_odczyt on public.wybory for select to authenticated using (true);
drop policy if exists wybory_admin on public.wybory;
create policy wybory_admin on public.wybory for all to authenticated
  using (public.jestem_adminem()) with check (public.jestem_adminem());

-- Udział: użytkownik widzi tylko własny (by wiedzieć, że już głosował); admin widzi frekwencję.
drop policy if exists udzial_ja on public.wybory_udzial;
create policy udzial_ja on public.wybory_udzial for select to authenticated
  using (wyborca = auth.uid() or public.jestem_adminem());

-- Głosy: czyta wyłącznie administrator (wyniki). Zapis tylko przez funkcję oddaj_glos.
drop policy if exists glos_admin on public.wybory_glos;
create policy glos_admin on public.wybory_glos for select to authenticated
  using (public.jestem_adminem());

-- ============================================================
--  10. Symulator sądowy (AI)
-- ============================================================
-- Źródło prawa dla generatora spraw (zasilane przez seed-prawo.sql).
create table if not exists public.sim_prawo (
  id        uuid primary key default gen_random_uuid(),
  kodeks    text not null,
  dziedzina text not null default 'karny',   -- 'karny' | 'cywilny'
  kolejnosc int  not null default 0,
  tresc     text not null
);

do $$ begin create type public.sim_status as enum ('rozprawa', 'zakonczona'); exception when duplicate_object then null; end $$;

-- Sprawa (część jawna — widoczna dla sędziego prowadzącego).
create table if not exists public.sim_sprawa (
  id         uuid primary key default gen_random_uuid(),
  sedzia     uuid references public.profil(id) on delete cascade,
  sad        public.sad,
  tytul      text,
  sygnatura  text,
  opis       text,                          -- stan faktyczny (jawny)
  oskarzony  text,
  zarzuty    jsonb not null default '[]'::jsonb,   -- [{czyn, kwalifikacja}]
  swiadkowie jsonb not null default '[]'::jsonb,   -- [{imie, rola}]
  dowody     jsonb not null default '[]'::jsonb,   -- [tekst]
  status     public.sim_status not null default 'rozprawa',
  wyrok      jsonb,                         -- {rozstrzygniecie, uzasadnienie, ocena}
  utworzono  timestamptz not null default now()
);
create index if not exists idx_sim_sprawa_sedzia on public.sim_sprawa (sedzia, utworzono desc);

-- Sekret sprawy: „co się naprawdę wydarzyło” + wiedza świadków. Czyta go WYŁĄCZNIE
-- funkcja serwerowa (service role). Brak polityk RLS = niedostępne dla klienta.
create table if not exists public.sim_sekret (
  sprawa uuid primary key references public.sim_sprawa(id) on delete cascade,
  tresc  jsonb not null
);

-- Transkrypt rozprawy.
create table if not exists public.sim_wpis (
  id        uuid primary key default gen_random_uuid(),
  sprawa    uuid not null references public.sim_sprawa(id) on delete cascade,
  rola      text not null,                  -- 'sedzia' | 'swiadek' | 'oskarzony' | 'system'
  mowca     text,
  tresc     text not null,
  utworzono timestamptz not null default now()
);
create index if not exists idx_sim_wpis_sprawa on public.sim_wpis (sprawa, utworzono);

-- Dzienny licznik spraw sędziego (limit egzekwowany przez funkcję serwerową).
create table if not exists public.sim_licznik (
  sedzia uuid not null references public.profil(id) on delete cascade,
  dzien  date not null,
  liczba int  not null default 0,
  primary key (sedzia, dzien)
);

alter table public.sim_prawo   enable row level security;
alter table public.sim_sprawa  enable row level security;
alter table public.sim_sekret  enable row level security;   -- brak polityk = tylko service role
alter table public.sim_wpis    enable row level security;
alter table public.sim_licznik enable row level security;

-- Prawo: czyta każdy zalogowany; edytuje administrator.
drop policy if exists prawo_odczyt on public.sim_prawo;
create policy prawo_odczyt on public.sim_prawo for select to authenticated using (true);
drop policy if exists prawo_admin on public.sim_prawo;
create policy prawo_admin on public.sim_prawo for all to authenticated
  using (public.jestem_adminem()) with check (public.jestem_adminem());

-- Sprawy: sędzia widzi i zarządza wyłącznie swoimi (zapisuje je funkcja serwerowa).
drop policy if exists sprawa_ja on public.sim_sprawa;
create policy sprawa_ja on public.sim_sprawa for select to authenticated
  using (sedzia = auth.uid() or public.jestem_adminem());
drop policy if exists sprawa_usun on public.sim_sprawa;
create policy sprawa_usun on public.sim_sprawa for delete to authenticated
  using (sedzia = auth.uid() or public.jestem_adminem());

-- Transkrypt: widoczny dla sędziego prowadzącego sprawę.
drop policy if exists wpis_ja on public.sim_wpis;
create policy wpis_ja on public.sim_wpis for select to authenticated
  using (exists (select 1 from public.sim_sprawa s where s.id = sprawa and (s.sedzia = auth.uid() or public.jestem_adminem())));

-- Licznik: sędzia widzi własny (by znać pozostały limit).
drop policy if exists licznik_ja on public.sim_licznik;
create policy licznik_ja on public.sim_licznik for select to authenticated
  using (sedzia = auth.uid() or public.jestem_adminem());

-- ============================================================
--  Gdyby trzeba było ręcznie nadać sobie administratora:
--  update public.profil set admin_serwisu = true where email = 'twoj@email.pl';
-- ============================================================
