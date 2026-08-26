/* ============================================================
   e-Prusy — wspólny moduł dla wszystkich podstron
   Zajmuje się: konfiguracją, połączeniem z Supabase, logowaniem,
   rejestracją (z kluczem PNI), profilem, uprawnieniami i UI.
   ============================================================ */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inicjaly = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';

  const NAZWY_SADOW = {
    rejonowy: 'Sąd Rejonowy', okregowy: 'Sąd Okręgowy', apelacyjny: 'Sąd Apelacyjny',
    wojskowy: 'Sąd Wojskowy', najwyzszy: 'Sąd Najwyższy', tk: 'Trybunał Konstytucyjny', ts: 'Trybunał Stanu'
  };

  const E = {
    sb: null, trybDemo: false, ja: null,
    $, $$, esc, inicjaly, NAZWY_SADOW,
    gotowe: null   // Promise gotowości
  };
  window.ePrusy = E;

  /* ---------- diagnostyka konfiguracji ---------- */
  function rolaZKlucza(k) {
    if (/^sb_secret_/.test(k)) return 'service_role';
    const c = k.split('.'); if (c.length !== 3) return null;
    try { return JSON.parse(atob(c[1].replace(/-/g, '+').replace(/_/g, '/'))).role || null; } catch (e) { return null; }
  }
  function sprawdzKonfiguracje() {
    const k = window.KONFIG || {};
    const url = String(k.url || '').trim().replace(/\/+$/, '');
    const klucz = String(k.klucz || '').trim();
    const p = [];
    if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function')
      p.push('Nie wczytała się biblioteka Supabase (js/vendor/supabase.js).');
    if (!window.KONFIG) p.push('Nie wczytał się plik config.js.');
    else {
      if (!url || url.indexOf('TWOJ_') === 0) p.push('W config.js nie uzupełniono adresu URL.');
      else if (!/^https?:\/\//i.test(url)) p.push('Adres URL musi zaczynać się od http:// lub https://.');
      if (!klucz || klucz.indexOf('TWOJ_') === 0) p.push('W config.js nie uzupełniono klucza anon.');
      else if (klucz.length < 30) p.push('Klucz wygląda na ucięty.');
      else if (rolaZKlucza(klucz) === 'service_role') p.push('W config.js jest klucz service_role — użyj anon.');
    }
    return { url, klucz, problemy: p };
  }

  /* ---------- inicjalizacja ---------- */
  E.gotowe = (async function init() {
    const stan = sprawdzKonfiguracje();
    if (stan.problemy.length) {
      E.trybDemo = true;
      console.warn('e-Prusy: tryb bez bazy —', stan.problemy.join(' '));
      return;
    }
    E.sb = window.supabase.createClient(stan.url, stan.klucz);
    try {
      const { error } = await E.sb.from('profil').select('id').limit(1);
      if (error && /Failed to fetch|NetworkError/i.test(error.message || '')) { E.trybDemo = true; return; }
    } catch (e) { E.trybDemo = true; return; }
    const { data } = await E.sb.auth.getSession();
    if (data && data.session) await pobierzProfil();
  })();

  async function pobierzProfil() {
    const { data: u } = await E.sb.auth.getUser();
    if (!u || !u.user) { E.ja = null; return; }
    let { data: p } = await E.sb.from('profil').select('*').eq('id', u.user.id).maybeSingle();
    if (!p) { await new Promise(r => setTimeout(r, 700)); const r2 = await E.sb.from('profil').select('*').eq('id', u.user.id).maybeSingle(); p = r2.data; }
    E.ja = {
      id: u.user.id, email: u.user.email,
      imie: (p && p.imie) || (u.user.email || '').split('@')[0],
      pni: p && p.pni, admin: !!(p && p.admin_serwisu),
      pseoAdmin: !!(p && (p.pseo_admin || p.admin_serwisu)),
      sady: (p && p.sady) || []
    };
  }
  E.pobierzProfil = pobierzProfil;

  /* ---------- pomocnicze uprawnienia ---------- */
  E.zalogowany = () => !!E.ja;
  E.jestAdmin = () => !!(E.ja && E.ja.admin);
  E.jestPseoAdmin = () => !!(E.ja && E.ja.pseoAdmin);
  E.jestSedzia = () => !!(E.ja && E.ja.sady && E.ja.sady.length);

  /* ============================================================
     UI: pasek konta w nagłówku
     ============================================================ */
  E.rysujKonto = function (sel) {
    const box = $(sel); if (!box) return;
    if (!E.ja) {
      box.innerHTML = '<button class="acct-btn" id="ep-login"><span>Zaloguj się</span></button>';
      $('#ep-login').onclick = () => E.modalAuth('login');
      return;
    }
    const j = E.ja;
    const tagiSad = (j.sady || []).map(s => '<span class="tag sedzia">' + esc(NAZWY_SADOW[s] || 'Sędzia') + '</span>').join('');
    const tagi = (j.admin ? '<span class="tag admin">Administrator</span>' : '') +
      (j.pseoAdmin && !j.admin ? '<span class="tag pseo">Admin PSEO</span>' : '') + tagiSad;
    box.innerHTML =
      '<button class="acct-btn" id="ep-acct"><span class="av">' + esc(inicjaly(j.imie)) + '</span>' +
      '<span>' + esc((j.imie || '').split(' ')[0] || 'Konto') + '</span></button>' +
      '<div class="menu" id="ep-menu" hidden>' +
        '<div class="mhd"><b>' + esc(j.imie) + '</b><small>' + esc(j.email) + '</small>' +
          (j.pni ? '<div class="pni">' + esc(j.pni) + '</div>' : '') +
          (tagi ? '<div>' + tagi + '</div>' : '') + '</div>' +
        '<a class="mi" href="index.html">Strona główna</a>' +
        (j.pseoAdmin || true ? '<a class="mi" href="pseo.html">Egzaminy Obywatelskie</a>' : '') +
        '<a class="mi" href="ess.html">System Sądownictwa</a>' +
        (j.admin ? '<a class="mi" href="admin.html">System Administratora</a>' : '') +
        '<div class="sep"></div>' +
        '<button class="mi danger" id="ep-logout">Wyloguj się</button>' +
      '</div>';
    const b = $('#ep-acct'), m = $('#ep-menu');
    b.onclick = e => { e.stopPropagation(); m.hidden = !m.hidden; };
    document.addEventListener('click', () => { if (m) m.hidden = true; });
    m.onclick = e => e.stopPropagation();
    $('#ep-logout').onclick = E.wyloguj;
  };

  E.wyloguj = async function () {
    if (E.sb) await E.sb.auth.signOut();
    location.href = 'index.html';
  };

  /* ============================================================
     Modal logowania / rejestracji
     ============================================================ */
  let trybModal = 'login';
  E.modalAuth = function (tryb) {
    if (E.trybDemo) { alert('Tryb demonstracyjny — logowanie działa po podłączeniu bazy (config.js).'); return; }
    trybModal = tryb || 'login';
    let root = $('#ep-modal'); if (!root) { root = document.createElement('div'); root.id = 'ep-modal'; document.body.appendChild(root); }
    root.innerHTML =
      '<div class="modal-bg" id="ep-mbg"><div class="modal">' +
        '<div class="modal-hd"><button class="x-close" id="ep-mx">×</button>' +
          '<img src="assets/logo.png" alt=""><b>e-<span>Prusy</span></b></div>' +
        '<div class="modal-bd">' +
          '<div class="tabs2" id="ep-mtabs"><button data-m="login" aria-pressed="true">Logowanie</button>' +
            '<button data-m="rejestr" aria-pressed="false">Rejestracja</button></div>' +
          '<div id="ep-imie-box" hidden><label class="f" style="margin-bottom:14px"><span>Imię i nazwisko</span>' +
            '<input type="text" id="ep-imie" placeholder="np. Jan Wilczyński" autocomplete="name"></label></div>' +
          '<label class="f" style="margin-bottom:14px"><span>Adres e-mail</span>' +
            '<input type="email" id="ep-email" placeholder="jan@przyklad.pl" autocomplete="email"></label>' +
          '<label class="f" style="margin-bottom:14px"><span>Hasło</span>' +
            '<input type="password" id="ep-haslo" placeholder="min. 6 znaków" autocomplete="current-password"></label>' +
          '<div id="ep-pni-box" hidden><label class="f" style="margin-bottom:16px"><span>Numer PNI (klucz dostępu)</span>' +
            '<input type="text" id="ep-pni" placeholder="np. PNI-XXXXXX" autocomplete="off"></label></div>' +
          '<button class="btn" id="ep-submit">Zaloguj się</button>' +
          '<div id="ep-msg"></div>' +
          '<div class="modal-note" id="ep-note"></div>' +
        '</div></div></div>';
    $('#ep-mx').onclick = zamknij;
    $('#ep-mbg').onclick = e => { if (e.target.id === 'ep-mbg') zamknij(); };
    $$('#ep-mtabs button').forEach(b => b.onclick = () => ustaw(b.dataset.m));
    $('#ep-submit').onclick = wyslij;
    ['ep-email', 'ep-haslo', 'ep-pni', 'ep-imie'].forEach(id => { const el = $('#' + id); if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') wyslij(); }); });
    ustaw(trybModal);
  };
  function ustaw(m) {
    trybModal = m;
    $$('#ep-mtabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === m ? 'true' : 'false'));
    $('#ep-imie-box').hidden = m !== 'rejestr';
    $('#ep-pni-box').hidden = m !== 'rejestr';
    $('#ep-submit').textContent = m === 'login' ? 'Zaloguj się' : 'Załóż konto';
    $('#ep-note').innerHTML = m === 'rejestr'
      ? 'Rejestracja wymaga <strong>numeru PNI</strong> — klucza dostępu wydawanego przez administratora. Pierwsze konto w systemie zakłada się bez klucza i otrzymuje uprawnienia administratora.'
      : '';
    $('#ep-msg').innerHTML = '';
  }
  function zamknij() { const r = $('#ep-modal'); if (r) r.innerHTML = ''; }
  E.zamknijModal = zamknij;

  function nota(sel, txt, typ) { const el = $(sel); if (el) el.innerHTML = txt ? '<div class="note ' + (typ || 'info') + '">' + esc(txt) + '</div>' : ''; }
  E.nota = nota;

  async function wyslij() {
    const email = $('#ep-email').value.trim(), haslo = $('#ep-haslo').value, btn = $('#ep-submit');
    if (!email || !haslo) { nota('#ep-msg', 'Podaj e-mail i hasło.', 'err'); return; }
    btn.disabled = true;
    try {
      if (trybModal === 'login') {
        const { error } = await E.sb.auth.signInWithPassword({ email, password: haslo });
        if (error) throw error;
        await pobierzProfil(); zamknij();
        if (E.poZalogowaniu) E.poZalogowaniu(); else location.reload();
      } else {
        const imie = $('#ep-imie').value.trim();
        const pni = $('#ep-pni').value.trim();
        // walidacja klucza po stronie bazy (bez ujawniania listy)
        const { data: stat, error: e1 } = await E.sb.rpc('sprawdz_klucz', { kod_in: pni });
        if (e1) throw e1;
        if (stat === 'zly') { nota('#ep-msg', 'Nieprawidłowy numer PNI. Zgłoś się po klucz do administratora.', 'err'); btn.disabled = false; return; }
        if (stat === 'zajety') { nota('#ep-msg', 'Ten numer PNI został już wykorzystany.', 'err'); btn.disabled = false; return; }
        // stat === 'ok' lub 'pierwszy'
        const { data, error } = await E.sb.auth.signUp({ email, password: haslo, options: { data: { imie, pni: stat === 'pierwszy' ? '' : pni } } });
        if (error) throw error;
        if (data.session) { await pobierzProfil(); zamknij(); if (E.poZalogowaniu) E.poZalogowaniu(); else location.reload(); }
        else { nota('#ep-msg', 'Konto założone. Potwierdź adres e-mail i zaloguj się.', 'ok'); ustaw('login'); }
      }
    } catch (e) { nota('#ep-msg', tlumacz(e), 'err'); } finally { btn.disabled = false; }
  }

  function tlumacz(e) {
    const m = String(e && e.message || e);
    if (/Invalid login credentials/i.test(m)) return 'Nieprawidłowy e-mail lub hasło.';
    if (/User already registered/i.test(m)) return 'Konto z tym adresem już istnieje.';
    if (/Password should be at least/i.test(m)) return 'Hasło musi mieć co najmniej 6 znaków.';
    if (/Email not confirmed/i.test(m)) return 'Potwierdź adres e-mail.';
    if (/rate limit|too many/i.test(m)) return 'Za dużo prób — odczekaj chwilę.';
    if (/row-level security|violates/i.test(m)) return 'Brak uprawnień do tej operacji.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Brak połączenia z bazą.';
    return m;
  }
  E.tlumacz = tlumacz;

  /* ---------- strażnicy stron ---------- */
  E.wymagajLogowania = function () {
    if (!E.ja) { location.href = 'index.html'; return false; }
    return true;
  };
  E.wymagajAdmina = function () {
    if (!E.ja || !E.ja.admin) { location.href = 'index.html'; return false; }
    return true;
  };

  /* ---------- toast ---------- */
  let tT = null;
  E.toast = function (txt, typ, ms) {
    let t = $('#ep-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ep-toast'; t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:80;max-width:540px;width:calc(100% - 40px)'; document.body.appendChild(t); }
    t.innerHTML = '<div class="note ' + (typ || 'info') + '" style="margin:0;box-shadow:0 12px 34px rgba(0,0,0,.5)">' + esc(txt) + '</div>';
    clearTimeout(tT); tT = setTimeout(() => { t.innerHTML = ''; }, ms || 3600);
  };

  E.losujKod = function (prefix) {
    const z = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = ''; for (let i = 0; i < 8; i++) s += z[Math.floor(Math.random() * z.length)];
    return (prefix || '') + s.slice(0, 4) + '-' + s.slice(4);
  };
})();
