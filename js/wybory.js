(async function () {
  const E = window.ePrusy, $ = E.$, $$ = E.$$, esc = E.esc;
  await E.gotowe;
  if (!E.wymagajLogowania()) return;
  E.rysujKonto('#acct');
  const admin = E.jestAdmin();
  if (admin) { $('#nav-admin').hidden = false; $$('.only-admin').forEach(el => el.hidden = false); }

  const TYPY = {
    referendum: 'Referendum',
    prezydenckie: 'Wybory prezydenckie',
    samorzadowe: 'Wybory samorządowe',
    parlamentarne: 'Wybory parlamentarne'
  };
  const STATUS_ET = { przygotowanie: 'W przygotowaniu', trwa: 'Trwa głosowanie', zakonczone: 'Zakończone' };

  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.t === 'admin' && !admin) return;
    $$('#tabs button').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    $$('.pane').forEach(p => p.classList.remove('on'));
    $('#pane-' + b.dataset.t).classList.add('on');
    if (b.dataset.t === 'glosowanie') widokGlosowanie();
    if (b.dataset.t === 'admin' && admin) widokAdmin();
  });

  /* ============================================================
     GŁOSOWANIE (wyborca)
     ============================================================ */
  async function widokGlosowanie() {
    const box = $('#pane-glosowanie');
    if (E.trybDemo) { box.innerHTML = '<div class="empty">Tryb demonstracyjny — brak połączenia z bazą.</div>'; return; }
    const [{ data: wyb, error }, { data: udz }] = await Promise.all([
      E.sb.from('wybory').select('*').eq('status', 'trwa').order('utworzono', { ascending: false }),
      E.sb.from('wybory_udzial').select('wybory').eq('wyborca', E.ja.id)
    ]);
    if (error) { box.innerHTML = '<div class="note err">' + esc(E.tlumacz(error)) + '</div>'; return; }
    const zaglosowane = new Set((udz || []).map(u => u.wybory));
    if (!wyb || !wyb.length) { box.innerHTML = '<div class="empty">Brak aktywnych wyborów. Zajrzyj później.</div>'; return; }
    box.innerHTML = wyb.map(w => kartaGlosowania(w, zaglosowane.has(w.id))).join('');
    wyb.forEach(w => { if (!zaglosowane.has(w.id)) podepnijGlosowanie(w); });
  }

  function kartaGlosowania(w, juz) {
    return '<div class="card" style="margin-bottom:16px" data-w="' + w.id + '">' +
      '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">' +
        '<h3 style="margin:0">' + esc(w.tytul) + '</h3>' +
        '<span class="chip">' + esc(TYPY[w.typ]) + (w.miasto ? ' · ' + esc(w.miasto) : '') + '</span></div>' +
      (juz
        ? '<div class="note ok" style="margin-top:14px">Twój głos w tych wyborach został już oddany. Dziękujemy — głos jest tajny i jednorazowy.</div>'
        : '<div class="karta-tresc" style="margin-top:14px">' + kartaWyboru(w) + '</div>' +
          '<div style="margin-top:16px"><button class="btn" data-oddaj="' + w.id + '">Oddaj głos</button></div>' +
          '<div class="g-msg"></div>') +
      '</div>';
  }

  // pola wyboru zależne od typu; name unikalny per wybory
  function kartaWyboru(w) {
    const o = w.opcje || {};
    if (w.typ === 'referendum') {
      const pyt = o.pytania || [];
      return pyt.map((p, qi) =>
        '<div class="ref-pyt"><b>' + (qi + 1) + '. ' + esc(p.tresc) + '</b>' +
        '<div class="opcje-lista">' + (p.odpowiedzi || []).map((a, ai) =>
          '<label class="opcja"><input type="radio" name="q-' + w.id + '-' + qi + '" value="' + ai + '"> <span>' + esc(a) + '</span></label>').join('') +
        '</div></div>').join('');
    }
    const lista = w.typ === 'parlamentarne' ? (o.komitety || []) : (o.kandydaci || []);
    const naglowek = w.typ === 'parlamentarne' ? 'Komitet wyborczy'
      : (w.typ === 'samorzadowe' ? 'Kandydat na Prezydenta' + (w.miasto ? ' ' + esc(w.miasto) : '') : 'Kandydat');
    return '<div class="hint" style="margin-bottom:8px">' + naglowek + ':</div><div class="opcje-lista">' +
      lista.map((k, i) => {
        const etykieta = w.typ === 'parlamentarne' ? esc(k.nazwa || '—')
          : esc(k.imie || '—') + (k.komitet ? ' <span class="hint">(' + esc(k.komitet) + ')</span>' : '');
        return '<label class="opcja"><input type="radio" name="w-' + w.id + '" value="' + i + '"> <span>' + etykieta + '</span></label>';
      }).join('') + '</div>';
  }

  function zbierzWybor(w) {
    if (w.typ === 'referendum') {
      const pyt = (w.opcje.pytania || []);
      const odp = [];
      for (let qi = 0; qi < pyt.length; qi++) {
        const sel = document.querySelector('input[name="q-' + w.id + '-' + qi + '"]:checked');
        if (!sel) return null;
        odp.push(parseInt(sel.value, 10));
      }
      return { odp };
    }
    const sel = document.querySelector('input[name="w-' + w.id + '"]:checked');
    if (!sel) return null;
    return { wybor: parseInt(sel.value, 10) };
  }

  function podepnijGlosowanie(w) {
    const karta = document.querySelector('[data-w="' + w.id + '"]'); if (!karta) return;
    karta.querySelector('[data-oddaj]').onclick = () => {
      const wybor = zbierzWybor(w);
      if (!wybor) { E.nota(karta.querySelector('.g-msg') ? '#pane-glosowanie [data-w="' + w.id + '"] .g-msg' : '#pane-glosowanie', 'Zaznacz swój wybór.', 'err'); return; }
      modalPotwierdz(w, wybor);
    };
  }

  /* ---------- modal potwierdzenia głosu ---------- */
  function modalPotwierdz(w, wybor) {
    let root = $('#w-modal'); if (!root) { root = document.createElement('div'); root.id = 'w-modal'; document.body.appendChild(root); }
    root.innerHTML =
      '<div class="modal-bg" id="wm-bg"><div class="modal">' +
        '<div class="modal-hd"><button class="x-close" id="wm-x">×</button><img src="assets/logo.png" alt=""><b>Potwierdź głos</b></div>' +
        '<div class="modal-bd">' +
          '<p class="hint" style="margin-top:0">Głosujesz w: <b>' + esc(w.tytul) + '</b>. Aby potwierdzić tożsamość, podaj hasło do swojego konta oraz swój numer PNI.</p>' +
          '<label class="f" style="margin-bottom:14px"><span>Hasło do konta</span><input type="password" id="wm-haslo" autocomplete="current-password"></label>' +
          '<label class="f" style="margin-bottom:16px"><span>Twój numer PNI</span><input type="text" id="wm-pni" placeholder="PNI-…" autocomplete="off"></label>' +
          '<label class="zgoda"><input type="checkbox" id="wm-zgoda"> <span>Oświadczam, że oddaję głos świadomie i w pełni dobrowolnie. Wiem, że jest to wybór ostateczny — po zatwierdzeniu nie będę mógł zagłosować ponownie ani zmienić głosu.</span></label>' +
          '<button class="btn wide" id="wm-ok" style="margin-top:18px">Oddaję głos ostatecznie</button>' +
          '<div id="wm-msg"></div>' +
        '</div></div></div>';
    const zamknij = () => { root.innerHTML = ''; };
    $('#wm-x').onclick = zamknij;
    $('#wm-bg').onclick = e => { if (e.target.id === 'wm-bg') zamknij(); };
    $('#wm-ok').onclick = async () => {
      const haslo = $('#wm-haslo').value, pni = $('#wm-pni').value.trim();
      if (!$('#wm-zgoda').checked) { E.nota('#wm-msg', 'Zaznacz oświadczenie, aby oddać głos.', 'err'); return; }
      if (!haslo) { E.nota('#wm-msg', 'Podaj hasło do konta.', 'err'); return; }
      if (!pni) { E.nota('#wm-msg', 'Podaj swój numer PNI.', 'err'); return; }
      if (E.ja.pni && pni !== E.ja.pni) { E.nota('#wm-msg', 'Podany PNI nie zgadza się z Twoim kontem.', 'err'); return; }
      const btn = $('#wm-ok'); btn.disabled = true;
      // weryfikacja hasła przez ponowne logowanie
      const { error: eLog } = await E.sb.auth.signInWithPassword({ email: E.ja.email, password: haslo });
      if (eLog) { E.nota('#wm-msg', 'Nieprawidłowe hasło do konta.', 'err'); btn.disabled = false; return; }
      const { data, error } = await E.sb.rpc('oddaj_glos', { wybory_id: w.id, wybor_in: wybor });
      btn.disabled = false;
      if (error) { E.nota('#wm-msg', E.tlumacz(error), 'err'); return; }
      if (!data || !data.ok) { E.nota('#wm-msg', (data && data.blad) || 'Nie udało się oddać głosu.', 'err'); return; }
      zamknij();
      E.toast('Głos oddany. Dziękujemy!', 'ok');
      widokGlosowanie();
    };
  }

  /* ============================================================
     PANEL ADMINISTRATORA
     ============================================================ */
  let nowe = null;
  function stanPoczatkowy() {
    return {
      tytul: '', typ: 'referendum', miasto: '',
      pytania: [{ tresc: '', odpowiedzi: ['', ''] }],
      kandydaci: [{ imie: '', komitet: '' }],
      komitety: [{ nazwa: '' }]
    };
  }

  async function widokAdmin() {
    if (!admin) return;
    nowe = stanPoczatkowy();
    $('#pane-admin').innerHTML =
      '<div class="card"><h3>Utwórz nowe wybory</h3>' +
        '<div class="grid g2">' +
          '<label class="f"><span>Tytuł</span><input type="text" id="n-tytul" placeholder="np. Wybory Prezydenta Republiki"></label>' +
          '<label class="f"><span>Typ</span><select id="n-typ">' + Object.keys(TYPY).map(t => '<option value="' + t + '">' + TYPY[t] + '</option>').join('') + '</select></label>' +
        '</div>' +
        '<div id="n-dyn" style="margin-top:14px"></div>' +
        '<div style="margin-top:16px"><button class="btn" id="n-utworz">Utwórz wybory</button></div>' +
        '<div id="n-msg"></div>' +
      '</div>' +
      '<div class="card"><h3>Zarządzanie wyborami</h3><div id="lista-wyborow"></div></div>';
    $('#n-tytul').addEventListener('input', e => nowe.tytul = e.target.value);
    $('#n-typ').addEventListener('change', e => { czytajDyn(); nowe.typ = e.target.value; rysujDyn(); });
    $('#n-utworz').onclick = utworz;
    rysujDyn();
    listaWyborow();
  }

  function czytajDyn() {
    // zapisz bieżące wartości pól dynamicznych do stanu (by nie zniknęły przy przerysowaniu)
    if (nowe.typ === 'referendum') {
      $$('#n-dyn .ref-q').forEach((el, qi) => {
        if (!nowe.pytania[qi]) return;
        nowe.pytania[qi].tresc = el.querySelector('.q-tresc').value;
        el.querySelectorAll('.q-odp').forEach((inp, ai) => { nowe.pytania[qi].odpowiedzi[ai] = inp.value; });
      });
    } else if (nowe.typ === 'parlamentarne') {
      $$('#n-dyn .kom-row').forEach((el, i) => { if (nowe.komitety[i]) nowe.komitety[i].nazwa = el.querySelector('.kom-nazwa').value; });
    } else {
      const m = $('#n-miasto'); if (m) nowe.miasto = m.value;
      $$('#n-dyn .kand-row').forEach((el, i) => {
        if (!nowe.kandydaci[i]) return;
        nowe.kandydaci[i].imie = el.querySelector('.kand-imie').value;
        const k = el.querySelector('.kand-komitet'); if (k) nowe.kandydaci[i].komitet = k.value;
      });
    }
  }

  function rysujDyn() {
    const box = $('#n-dyn');
    if (nowe.typ === 'referendum') {
      box.innerHTML = '<div class="hint" style="margin-bottom:8px">Pytania i odpowiedzi:</div>' +
        nowe.pytania.map((p, qi) =>
          '<div class="ref-q card" style="margin:8px 0" data-qi="' + qi + '">' +
            '<div style="display:flex;gap:10px"><input type="text" class="q-tresc" placeholder="Treść pytania ' + (qi + 1) + '" value="' + esc(p.tresc) + '">' +
            (nowe.pytania.length > 1 ? '<button class="btn tiny danger" data-delq="' + qi + '">Usuń</button>' : '') + '</div>' +
            '<div class="hint" style="margin:10px 0 6px">Odpowiedzi:</div>' +
            p.odpowiedzi.map((a, ai) => '<div style="display:flex;gap:8px;margin-bottom:6px"><input type="text" class="q-odp" placeholder="Odpowiedź" value="' + esc(a) + '">' +
              (p.odpowiedzi.length > 2 ? '<button class="btn tiny danger" data-dela="' + qi + '_' + ai + '">×</button>' : '') + '</div>').join('') +
            '<button class="btn ghost sm" data-adda="' + qi + '">+ Odpowiedź</button>' +
          '</div>').join('') +
        '<button class="btn ghost sm" id="add-q">+ Dodaj pytanie</button>';
    } else if (nowe.typ === 'parlamentarne') {
      box.innerHTML = '<div class="hint" style="margin-bottom:8px">Komitety wyborcze:</div>' +
        nowe.komitety.map((k, i) => '<div class="kom-row" style="display:flex;gap:8px;margin-bottom:8px" data-i="' + i + '">' +
          '<input type="text" class="kom-nazwa" placeholder="Nazwa komitetu wyborczego" value="' + esc(k.nazwa) + '">' +
          (nowe.komitety.length > 1 ? '<button class="btn tiny danger" data-delk="' + i + '">Usuń</button>' : '') + '</div>').join('') +
        '<button class="btn ghost sm" id="add-k">+ Dodaj komitet</button>';
    } else {
      const miastoPole = nowe.typ === 'samorzadowe'
        ? '<label class="f" style="margin-bottom:12px"><span>Miasto</span><input type="text" id="n-miasto" placeholder="np. Królewiec" value="' + esc(nowe.miasto) + '"></label>' : '';
      const komitetPole = (idx, k) => (nowe.typ === 'samorzadowe' || nowe.typ === 'prezydenckie')
        ? '<input type="text" class="kand-komitet" placeholder="Komitet wyborczy' + (nowe.typ === 'prezydenckie' ? ' (opcjonalnie)' : '') + '" value="' + esc(k.komitet || '') + '">' : '';
      box.innerHTML = miastoPole +
        '<div class="hint" style="margin-bottom:8px">' + (nowe.typ === 'samorzadowe' ? 'Kandydaci na Prezydenta miasta:' : 'Kandydaci:') + '</div>' +
        nowe.kandydaci.map((k, i) => '<div class="kand-row" style="display:flex;gap:8px;margin-bottom:8px" data-i="' + i + '">' +
          '<input type="text" class="kand-imie" placeholder="Imię i nazwisko kandydata" value="' + esc(k.imie) + '">' + komitetPole(i, k) +
          (nowe.kandydaci.length > 1 ? '<button class="btn tiny danger" data-delc="' + i + '">Usuń</button>' : '') + '</div>').join('') +
        '<button class="btn ghost sm" id="add-c">+ Dodaj kandydata</button>';
    }
    podepnijDyn();
  }

  function podepnijDyn() {
    const box = $('#n-dyn');
    const q = id => box.querySelector(id);
    if (q('#add-q')) q('#add-q').onclick = () => { czytajDyn(); nowe.pytania.push({ tresc: '', odpowiedzi: ['', ''] }); rysujDyn(); };
    if (q('#add-k')) q('#add-k').onclick = () => { czytajDyn(); nowe.komitety.push({ nazwa: '' }); rysujDyn(); };
    if (q('#add-c')) q('#add-c').onclick = () => { czytajDyn(); nowe.kandydaci.push({ imie: '', komitet: '' }); rysujDyn(); };
    box.querySelectorAll('[data-delq]').forEach(b => b.onclick = () => { czytajDyn(); nowe.pytania.splice(+b.dataset.delq, 1); rysujDyn(); });
    box.querySelectorAll('[data-adda]').forEach(b => b.onclick = () => { czytajDyn(); nowe.pytania[+b.dataset.adda].odpowiedzi.push(''); rysujDyn(); });
    box.querySelectorAll('[data-dela]').forEach(b => b.onclick = () => { czytajDyn(); const [qi, ai] = b.dataset.dela.split('_').map(Number); nowe.pytania[qi].odpowiedzi.splice(ai, 1); rysujDyn(); });
    box.querySelectorAll('[data-delk]').forEach(b => b.onclick = () => { czytajDyn(); nowe.komitety.splice(+b.dataset.delk, 1); rysujDyn(); });
    box.querySelectorAll('[data-delc]').forEach(b => b.onclick = () => { czytajDyn(); nowe.kandydaci.splice(+b.dataset.delc, 1); rysujDyn(); });
  }

  async function utworz() {
    czytajDyn();
    if (!nowe.tytul.trim()) { E.nota('#n-msg', 'Podaj tytuł wyborów.', 'err'); return; }
    let opcje = {};
    if (nowe.typ === 'referendum') {
      const pytania = nowe.pytania.map(p => ({ tresc: p.tresc.trim(), odpowiedzi: p.odpowiedzi.map(a => a.trim()).filter(Boolean) }))
        .filter(p => p.tresc && p.odpowiedzi.length >= 2);
      if (!pytania.length) { E.nota('#n-msg', 'Dodaj co najmniej jedno pytanie z dwiema odpowiedziami.', 'err'); return; }
      opcje = { pytania };
    } else if (nowe.typ === 'parlamentarne') {
      const komitety = nowe.komitety.map(k => ({ nazwa: k.nazwa.trim() })).filter(k => k.nazwa);
      if (komitety.length < 2) { E.nota('#n-msg', 'Dodaj co najmniej dwa komitety.', 'err'); return; }
      opcje = { komitety };
    } else {
      const kandydaci = nowe.kandydaci.map(k => ({ imie: k.imie.trim(), komitet: (k.komitet || '').trim() })).filter(k => k.imie);
      if (kandydaci.length < 2) { E.nota('#n-msg', 'Dodaj co najmniej dwóch kandydatów.', 'err'); return; }
      if (nowe.typ === 'samorzadowe' && !nowe.miasto.trim()) { E.nota('#n-msg', 'Podaj miasto.', 'err'); return; }
      opcje = { kandydaci };
    }
    const rec = { tytul: nowe.tytul.trim(), typ: nowe.typ, miasto: nowe.typ === 'samorzadowe' ? nowe.miasto.trim() : null, opcje, status: 'przygotowanie', autor: E.ja.id };
    const { error } = await E.sb.from('wybory').insert(rec);
    if (error) { E.nota('#n-msg', E.tlumacz(error), 'err'); return; }
    E.nota('#n-msg', 'Wybory utworzone. Rozpocznij głosowanie w sekcji poniżej.', 'ok');
    nowe = stanPoczatkowy(); $('#n-tytul').value = ''; $('#n-typ').value = 'referendum'; nowe.typ = 'referendum'; rysujDyn();
    listaWyborow();
  }

  async function listaWyborow() {
    const { data, error } = await E.sb.from('wybory').select('*').order('utworzono', { ascending: false });
    const box = $('#lista-wyborow');
    if (error) { box.innerHTML = '<div class="note err">' + esc(E.tlumacz(error)) + '</div>'; return; }
    if (!data || !data.length) { box.innerHTML = '<div class="empty">Brak wyborów.</div>'; return; }
    box.innerHTML = data.map(w =>
      '<div class="card" style="margin:10px 0" data-wid="' + w.id + '">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">' +
          '<div><b>' + esc(w.tytul) + '</b> <span class="chip">' + esc(TYPY[w.typ]) + '</span></div>' +
          '<span class="status-' + w.status + '">' + STATUS_ET[w.status] + '</span></div>' +
        '<div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">' +
          (w.status === 'przygotowanie' ? '<button class="btn sm" data-start="' + w.id + '">Rozpocznij głosowanie</button>' : '') +
          (w.status === 'trwa' ? '<button class="btn sm danger" data-stop="' + w.id + '">Zatrzymaj głosowanie</button>' : '') +
          (w.status === 'zakonczone' ? '<button class="btn sm" data-wyniki="' + w.id + '">Pokaż wyniki</button>' : '') +
          '<button class="btn tiny danger" data-delw="' + w.id + '">Usuń</button>' +
        '</div>' +
        '<div class="wyniki-box" id="wyniki-' + w.id + '"></div>' +
      '</div>').join('');

    box.querySelectorAll('[data-start]').forEach(b => b.onclick = () => zmienStatus(b.dataset.start, 'trwa'));
    box.querySelectorAll('[data-stop]').forEach(b => b.onclick = () => { if (confirm('Zatrzymać głosowanie? Po zatrzymaniu nie będzie można oddawać głosów.')) zmienStatus(b.dataset.stop, 'zakonczone'); });
    box.querySelectorAll('[data-delw]').forEach(b => b.onclick = async () => { if (!confirm('Usunąć wybory wraz z głosami?')) return; await E.sb.from('wybory').delete().eq('id', b.dataset.delw); listaWyborow(); });
    box.querySelectorAll('[data-wyniki]').forEach(b => b.onclick = () => pokazWyniki(b.dataset.wyniki));
  }

  async function zmienStatus(id, status) {
    const { error } = await E.sb.from('wybory').update({ status }).eq('id', id);
    if (error) { E.toast(E.tlumacz(error), 'err'); return; }
    E.toast(status === 'trwa' ? 'Głosowanie rozpoczęte.' : 'Głosowanie zatrzymane.', 'ok');
    listaWyborow();
  }

  async function pokazWyniki(id) {
    const box = $('#wyniki-' + id);
    box.innerHTML = '<div class="hint" style="margin-top:12px">Wczytywanie wyników…</div>';
    const [{ data: w }, { data: glosy, error }, { data: udz }] = await Promise.all([
      E.sb.from('wybory').select('*').eq('id', id).single(),
      E.sb.from('wybory_glos').select('wybor').eq('wybory', id),
      E.sb.from('wybory_udzial').select('wybory').eq('wybory', id)
    ]);
    if (error) { box.innerHTML = '<div class="note err">' + esc(E.tlumacz(error)) + '</div>'; return; }
    const n = (glosy || []).length;
    box.innerHTML = '<div class="wyniki"><div class="wyniki-hd">Wyniki · oddanych głosów: ' + n + '</div>' + renderWyniki(w, glosy || []) + '</div>';
  }

  function slupek(etykieta, liczba, suma) {
    const pct = suma ? Math.round(liczba / suma * 100) : 0;
    return '<div class="wynik-w"><div class="wynik-top"><span>' + etykieta + '</span><b>' + liczba + ' (' + pct + '%)</b></div>' +
      '<div class="wynik-bar"><span style="width:' + pct + '%"></span></div></div>';
  }

  function renderWyniki(w, glosy) {
    const o = w.opcje || {};
    if (w.typ === 'referendum') {
      const pyt = o.pytania || [];
      return pyt.map((p, qi) => {
        const licz = (p.odpowiedzi || []).map((a, ai) => glosy.filter(g => (g.wybor.odp || [])[qi] === ai).length);
        const suma = licz.reduce((s, x) => s + x, 0);
        return '<div class="wynik-grupa"><div class="wynik-pyt">' + (qi + 1) + '. ' + esc(p.tresc) + '</div>' +
          p.odpowiedzi.map((a, ai) => slupek(esc(a), licz[ai], suma)).join('') + '</div>';
      }).join('');
    }
    const lista = w.typ === 'parlamentarne' ? (o.komitety || []) : (o.kandydaci || []);
    const licz = lista.map((k, i) => glosy.filter(g => g.wybor.wybor === i).length);
    const suma = licz.reduce((s, x) => s + x, 0);
    return lista.map((k, i) => {
      const et = w.typ === 'parlamentarne' ? esc(k.nazwa || '—') : esc(k.imie || '—') + (k.komitet ? ' (' + esc(k.komitet) + ')' : '');
      return slupek(et, licz[i], suma);
    }).join('');
  }

  widokGlosowanie();
  if (admin) widokAdmin();
  if (E.trybDemo) E.toast('Tryb demonstracyjny — podłącz bazę w config.js.', 'info', 5000);
})();
