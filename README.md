# e-Prusy

Portal obywatela i gracza Republiki Pruskiej. Statyczna strona (GitHub Pages)
połączona z bazą **Supabase uruchomioną na Twoim komputerze**. Cztery moduły:

- **index.html** — logowanie/rejestracja, wybór trybu gracza lub obywatela,
  usługi „mObywatel” oraz wejścia do pozostałych modułów.
- **pseo.html** — Pruski System Egzaminów Obywatelskich (egzamin + panel admina).
- **ess.html** — Elektroniczny System Sądownictwa (wyroki + panel sędziego).
- **admin.html** — System Administratora (klucze rejestracji + uprawnienia).

---

## Jak to jest zbudowane

Strona to czyste pliki HTML/CSS/JS — hostuje ją GitHub Pages. Dane (konta,
egzaminy, wyroki, uprawnienia) trzyma **Supabase**, który uruchamiasz u siebie w
Dockerze. Dzięki temu baza stoi na Twoim komputerze, ale inni gracze łączą się z
nią przez internet. Kod frontendu jest taki sam niezależnie od tego, czy baza
jest w chmurze, czy u Ciebie — zmieniasz tylko adres i klucz w `config.js`.

```
  Przeglądarka gracza ──HTTPS──▶ GitHub Pages (pliki strony)
           │
           └──────────────────▶ Twój Supabase (Docker na Twoim Linuksie)
                                 wystawiony przez tunel lub publiczny adres
```

---

## Część 1. Baza danych na Twoim komputerze (Linux)

### 1.1. Zainstaluj Dockera

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER      # wyloguj się i zaloguj ponownie
```

### 1.2. Pobierz i uruchom Supabase

```bash
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
```

Otwórz `.env` i **zmień** wartości domyślne (to ważne dla bezpieczeństwa):
`POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `DASHBOARD_USERNAME`,
`DASHBOARD_PASSWORD`. Klucze `ANON_KEY` i `SERVICE_ROLE_KEY` wygenerujesz do swojego
`JWT_SECRET` generatorem ze strony Supabase (dokumentacja „Self-Hosting → Generating
API Keys”). Następnie:

```bash
docker compose up -d
```

Po chwili panel **Supabase Studio** działa pod `http://localhost:8000`
(logowanie danymi `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`).

### 1.3. Załóż tabele

W Studio otwórz **SQL Editor → New query**, wklej **całą** zawartość
[`schema.sql`](schema.sql) i kliknij **Run**. Skrypt można bezpiecznie uruchomić
ponownie — nie kasuje danych.

### 1.4. Udostępnij bazę innym

Domyślnie Supabase słucha tylko lokalnie. Żeby dołączyli inni gracze, wystaw port
`8000` na świat. Najprościej **tunelem Cloudflare** (nie wymaga otwierania portów
na routerze):

```bash
# instalacja: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel --url http://localhost:8000
```

Dostaniesz publiczny adres w stylu `https://cos-tam.trycloudflare.com` — to jest
Twój **URL** do `config.js`. (Alternatywy: `ngrok http 8000`, albo przekierowanie
portu na routerze + Twoje publiczne IP jako `http://IP:8000`.)

> Komputer musi być włączony i mieć uruchomiony `docker compose` oraz tunel, gdy
> inni korzystają z portalu. Po restarcie: `docker compose up -d` i ponownie tunel.

---

## Część 2. Strona na GitHub Pages

1. Uzupełnij [`config.js`](config.js):
   - `url` → adres z tunelu (np. `https://cos-tam.trycloudflare.com`),
   - `klucz` → **ANON_KEY** z Twojego `.env`.
   Klucz anon jest publiczny z założenia — dostępu pilnują polityki RLS z `schema.sql`.
   **Nigdy** nie wklejaj tu `SERVICE_ROLE_KEY`.
2. Wgraj **całą zawartość tego folderu** do repozytorium na GitHubie.
3. **Settings → Pages → Source: Deploy from a branch**, gałąź `main`, katalog `/`.
4. Strona ruszy pod `https://twoj-login.github.io/nazwa-repo/`.

Plik `.nojekyll` jest już w paczce — nie usuwaj go (dzięki niemu GitHub nie miesza
w folderze `js`).

---

## Pierwszy administrator i klucze PNI

- **Pierwsze konto** założone w systemie automatycznie dostaje uprawnienia
  administratora serwisu i **nie potrzebuje klucza** — zarejestruj się jako pierwszy.
- Każdy kolejny użytkownik musi przy rejestracji wpisać **numer PNI** — to klucz
  dostępu, który administrator generuje w **Systemie Administratora** i przekazuje
  danej osobie. Bez ważnego, niewykorzystanego klucza rejestracja się nie powiedzie.

## Uprawnienia

W Systemie Administratora (`admin.html`, zakładka „Użytkownicy”) zaznaczasz:

- **Administrator** — pełny dostęp, w tym nadawanie uprawnień innym.
- **Admin PSEO** — zarządza Egzaminami Obywatelskimi (pytania, klucze, ocena).
- **Prokurator** — może wnosić akty oskarżenia w Panelu prokuratora.
- **Sędzia — sądy** — zaznaczasz (checkboxami) **wszystkie sądy**, w których dana
  osoba może wydawać wyroki: rejonowy, okręgowy, apelacyjny, wojskowy, najwyższy,
  Trybunał Konstytucyjny, Trybunał Stanu. Jedna osoba może orzekać w kilku sądach.

## Sądownictwo i prokuratura (ESS)

Moduł ma cztery zakładki, z osobną kolorystyką dla sądownictwa (złota) i
prokuratury (bordowa):

- **Wyroki** — publiczny rejestr wyroków, pogrupowany: sądy powszechne (rejonowy,
  okręgowy, wojskowy), apelacyjne, Sąd Najwyższy, Trybunał Konstytucyjny, Trybunał
  Stanu. Czyta każdy, także niezalogowany.
- **Prokuratura** — publiczny rejestr aktów oskarżenia, pogrupowany według sądu,
  do którego akt jest kierowany.
- **Panel sędziego** (dla sędziów) — formularz wyroku według wzoru procesowego:
  sąd/trybunał (tylko te, do których sędzia ma uprawnienia), nazwa sądu, miejscowość,
  data, sygnatura (z przyciskiem „Generuj sygnaturę”), przedmiot, strony, status,
  skład orzekający, **sentencja w numerowanych punktach** i osobne **uzasadnienie**.
  Każdy wyrok wydawany jest **w imieniu Republiki Pruskiej**.
- **Panel prokuratora** (dla prokuratorów) — formularz aktu oskarżenia: sąd, do
  którego kierowany, prokuratura, miejscowość, data, sygnatura, oskarżony,
  pokrzywdzony, **zarzuty w numerowanych punktach**, uzasadnienie i wnioski końcowe.

## Egzaminy (PSEO)

Egzamin ma trzy części: **pisemną**, **ustną** i **ustawodawczą**.

- Część pisemna to **30 losowych pytań** z bazy pytań admina; aby przystąpić,
  trzeba wpisać **klucz wstępu** wygenerowany przez admina PSEO. Wynik pisemny liczy
  się automatycznie — poprawne odpowiedzi nie są wysyłane do przeglądarki zdającego.
- Części ustną i ustawodawczą **wpisuje admin** w panelu.
- Wyniki są ukryte dla zdającego, dopóki admin nie kliknie **„Zapisz i ujawnij”**.
- Progi zdania: **pisemny ≥ 90%**, **ustny ≥ 60%**, **ustawodawczy ≥ 75%**.

---

## Portal wyborczy

Dostępny z trybu obywatela (kafel „Elektroniczny Portal Wyborczy”). Ma dwie części:

**Panel administratora** (dla administratorów) — tworzenie wyborów i wybór typu:
- **Referendum** — pytania i odpowiedzi (dowolnie wiele).
- **Wybory prezydenckie** — kandydaci (opcjonalnie z komitetem).
- **Wybory samorządowe** — miasto oraz kandydaci na Prezydenta miasta wraz z komitetami.
- **Wybory parlamentarne** — komitety wyborcze.

Administrator zarządza cyklem: **Rozpocznij głosowanie** → **Zatrzymaj głosowanie**,
a po zatrzymaniu widzi **wyniki** (słupki z liczbą i procentem głosów, dla referendum
w rozbiciu na pytania).

**Głosowanie** (dla wyborców) — lista aktywnych wyborów. Aby oddać głos, wyborca
potwierdza tożsamość **hasłem do konta** oraz **swoim numerem PNI**, a następnie
akceptuje oświadczenie, że głos jest ostateczny. **Głos jest tajny i jednorazowy:**
fakt oddania głosu i jego treść zapisywane są w osobnych tabelach, więc nie da się
ustalić, kto jak zagłosował, a raz oddanego głosu nie można powtórzyć ani zmienić.

## Bezpieczeństwo — o czym pamiętać

- Zmień **wszystkie** domyślne hasła i klucze w `.env` Supabase.
- Udostępniaj publicznie **tylko** port `8000` (API), nie bazę Postgres (5432).
- W `config.js` używaj wyłącznie klucza **anon**; `service_role` daje pełen dostęp
  do bazy z pominięciem RLS — trzymaj go w tajemnicy.
- Dostępu do danych pilnują polityki RLS z `schema.sql` — nie wyłączaj ich.
- Tunel/adres publiczny wystawia Twój komputer do internetu; korzystaj z HTTPS
  (tunel Cloudflare daje je automatycznie).

## Pliki

```
index.html  pseo.html  ess.html  wybory.html  admin.html
config.js               ← adres i klucz anon (jedyny plik do edycji)
schema.sql              ← struktura bazy (uruchom w SQL Editor)
css/styl.css
js/wspolne.js           ← logowanie, rejestracja, uprawnienia, UI
js/index.js  js/pseo.js  js/ess.js  js/wybory.js  js/admin.js
js/vendor/supabase.js   ← biblioteka Supabase (lokalnie, bez CDN)
assets/                 ← logo, favicon
.nojekyll
```
