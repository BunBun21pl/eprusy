(async function () {
  const E = window.ePrusy, $ = E.$, $$ = E.$$, esc = E.esc;
  await E.gotowe;
  if (!E.wymagajLogowania()) return;
  E.rysujKonto('#acct');
  if (E.jestAdmin()) $('#nav-admin').hidden = false;

  const PROGI = { pisemny: 90, ustny: 60, ustawodawczy: 75 };
  const admin = E.jestPseoAdmin();
  if (admin) { $$('.only-admin').forEach(el => el.hidden = false); }

  // zakładki — przy wejściu odświeżamy dane danej zakładki
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.t === 'admin' && !admin) return;
    $$('#tabs button').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    $$('.pane').forEach(p => p.classList.remove('on'));
    $('#pane-' + b.dataset.t).classList.add('on');
    if (b.dataset.t === 'wyniki') widokWyniki();
    if (b.dataset.t === 'admin' && admin) { listaKluczy(); listaPytan(); listaEgzaminow(); }
  });

  /* ============================================================
     PRZYSTĄP DO EGZAMINU
     ============================================================ */
  let egzamin = null; // { pytania:[{id,tresc,odpowiedzi}], odpowiedzi:{id:wybor} }

  function widokPrzystap() {
    const box = $('#pane-przystap');
    box.innerHTML =
      '<div class="card"><h3>Część pisemna</h3>' +
      '<p class="hint" style="margin-top:0">Egzamin pisemny to 30 losowych pytań. Aby przystąpić, wpisz klucz wstępu otrzymany od administratora PSEO.</p>' +
      '<div class="grid g2" style="margin-top:6px">' +
        '<label class="f"><span>Klucz wstępu na egzamin</span><input type="text" id="kod-egz" placeholder="np. EGZ-XXXXXX"></label>' +
        '<div style="display:flex;align-items:flex-end"><button class="btn" id="start-egz">Rozpocznij egzamin</button></div>' +
      '</div><div id="egz-msg"></div></div>' +
      '<div id="egz-obszar"></div>';
    $('#start-egz').onclick = rozpocznij;
  }

  async function rozpocznij() {
    const kod = $('#kod-egz').value.trim();
    if (!kod) { E.nota('#egz-msg', 'Wpisz klucz wstępu.', 'err'); return; }
    if (E.trybDemo) { E.nota('#egz-msg', 'Tryb demonstracyjny — egzamin wymaga bazy.', 'info'); return; }
    const btn = $('#start-egz'); btn.disabled = true;
    const { data, error } = await E.sb.rpc('pseo_rozpocznij', { kod_in: kod });
    btn.disabled = false;
    if (error) { E.nota('#egz-msg', E.tlumacz(error), 'err'); return; }
    if (!data || !data.ok) { E.nota('#egz-msg', (data && data.blad) || 'Nie udało się rozpocząć egzaminu.', 'err'); return; }
    egzamin = { pytania: data.pytania, odpowiedzi: {} };
    rysujPytania();
  }

  function rysujPytania() {
    const box = $('#egz-obszar');
    box.innerHTML =
      '<div class="card"><h3>Egzamin pisemny — ' + egzamin.pytania.length + ' pytań</h3>' +
      '<p class="hint" style="margin-top:0">Zaznacz jedną odpowiedź w każdym pytaniu. Po zakończeniu kliknij „Zakończ i wyślij”.</p>' +
      '<div id="pytania">' + egzamin.pytania.map((p, i) =>
        '<div class="card" style="margin:14px 0" data-pid="' + esc(p.id) + '"><b>' + (i + 1) + '. ' + esc(p.tresc) + '</b>' +
        '<div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">' +
          (p.odpowiedzi || []).map((o, oi) =>
            '<label style="display:flex;gap:10px;align-items:center;cursor:pointer;padding:8px 10px;border:1px solid var(--line);border-radius:8px">' +
            '<input type="radio" name="p-' + esc(p.id) + '" value="' + oi + '" style="width:auto"> <span>' + esc(o) + '</span></label>').join('') +
        '</div></div>').join('') + '</div>' +
      '<button class="btn wide" id="wyslij-egz">Zakończ i wyślij</button><div id="egz-wynik-msg"></div></div>';
    box.addEventListener('change', e => {
      const r = e.target.closest('input[type=radio]'); if (!r) return;
      const pid = r.closest('[data-pid]').dataset.pid;
      egzamin.odpowiedzi[pid] = parseInt(r.value, 10);
    });
    $('#wyslij-egz').onclick = wyslijEgzamin;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function wyslijEgzamin() {
    const odp = egzamin.pytania.map(p => ({ id: p.id, wybor: egzamin.odpowiedzi[p.id] != null ? egzamin.odpowiedzi[p.id] : -1 }));
    const bez = odp.filter(o => o.wybor < 0).length;
    if (bez > 0 && !confirm('Pozostawiono ' + bez + ' pytań bez odpowiedzi. Wysłać mimo to?')) return;
    const btn = $('#wyslij-egz'); btn.disabled = true;
    const { data, error } = await E.sb.rpc('pseo_zloz', { odp_in: odp });
    btn.disabled = false;
    if (error) { E.nota('#egz-wynik-msg', E.tlumacz(error), 'err'); return; }
    egzamin = null;
    $('#egz-obszar').innerHTML =
      '<div class="card"><h3>Egzamin pisemny wysłany</h3>' +
      '<p>Twoja część pisemna została zapisana. Wynik zostanie ujawniony przez komisję po ocenie części ustnej i ustawodawczej — sprawdź zakładkę <b>Wyniki egzaminu</b>.</p></div>';
    E.toast('Egzamin pisemny wysłany.', 'ok');
  }

  /* ============================================================
     WYNIKI
     ============================================================ */
  async function widokWyniki() {
    const box = $('#pane-wyniki');
    if (E.trybDemo) { box.innerHTML = '<div class="empty">Tryb demonstracyjny — brak połączenia z bazą.</div>'; return; }
    const { data, error } = await E.sb.from('pseo_egzamin').select('*').order('utworzono', { ascending: false });
    if (error) { box.innerHTML = '<div class="note err">' + esc(E.tlumacz(error)) + '</div>'; return; }
    const moje = (data || []).filter(x => x.uzytkownik === E.ja.id);
    box.innerHTML = '<div class="card"><h3>Twoje wyniki</h3>' + (
      !moje.length ? '<div class="empty">Nie masz jeszcze ujawnionych wyników.</div>' :
      moje.map(kartaWyniku).join('')) + '</div>';
  }

  function ocena(proc, prog) {
    if (proc == null) return '<span class="chip">—</span>';
    const ok = Number(proc) >= prog;
    return '<b style="color:' + (ok ? 'var(--ok)' : 'var(--err)') + '">' + Number(proc) + '%</b> <small class="hint">(próg ' + prog + '%)</small>';
  }
  function kartaWyniku(x) {
    const zdanyAuto = Number(x.wynik_pisemny) >= PROGI.pisemny && Number(x.wynik_ustny) >= PROGI.ustny && Number(x.wynik_ustawodawczy) >= PROGI.ustawodawczy;
    const zdany = x.zdany != null ? x.zdany : zdanyAuto;
    return '<div class="card" style="margin:12px 0">' +
      '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:center">' +
        '<b>Egzamin z ' + esc(new Date(x.utworzono).toLocaleDateString('pl-PL')) + '</b>' +
        '<span class="reg-res" style="font-weight:800;color:' + (zdany ? 'var(--ok)' : 'var(--err)') + '">' + (zdany ? 'ZDANY' : 'NIEZDANY') + '</span></div>' +
      '<div class="grid g3" style="margin-top:12px">' +
        '<div><div class="hint">Pisemny</div>' + ocena(x.wynik_pisemny, PROGI.pisemny) + '</div>' +
        '<div><div class="hint">Ustny</div>' + ocena(x.wynik_ustny, PROGI.ustny) + '</div>' +
        '<div><div class="hint">Ustawodawczy</div>' + ocena(x.wynik_ustawodawczy, PROGI.ustawodawczy) + '</div>' +
      '</div></div>';
  }

  /* ============================================================
     PANEL ADMINA PSEO
     ============================================================ */
  async function widokAdmin() {
    if (!admin) return;
    const box = $('#pane-admin');
    box.innerHTML =
      '<div class="card"><h3>Klucze wstępu na egzamin</h3>' +
        '<p class="hint" style="margin-top:0">Wygeneruj klucz i przekaż zdającemu. Każdy klucz działa jednorazowo.</p>' +
        '<button class="btn" id="gen-egz-klucz">Wygeneruj klucz wstępu</button>' +
        '<div id="klucz-msg"></div><div id="klucze-lista" style="margin-top:14px"></div>' +
      '</div>' +
      '<div class="card"><h3>Baza pytań</h3>' +
        '<div class="grid g2"><label class="f"><span>Treść pytania</span><input type="text" id="q-tresc" placeholder="np. Jaki organ uchwala ustawy?"></label>' +
        '<div></div></div>' +
        '<div class="grid g4" style="margin-top:12px">' +
          '<label class="f"><span>Odpowiedź A</span><input type="text" id="q-a"></label>' +
          '<label class="f"><span>Odpowiedź B</span><input type="text" id="q-b"></label>' +
          '<label class="f"><span>Odpowiedź C</span><input type="text" id="q-c"></label>' +
          '<label class="f"><span>Odpowiedź D</span><input type="text" id="q-d"></label>' +
        '</div>' +
        '<div class="grid g2" style="margin-top:12px"><label class="f"><span>Poprawna odpowiedź</span>' +
          '<select id="q-ok"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select></label>' +
          '<div style="display:flex;align-items:flex-end"><button class="btn" id="dodaj-pytanie">Dodaj pytanie</button></div></div>' +
        '<div id="q-msg"></div><div id="pytania-lista" style="margin-top:16px"></div>' +
      '</div>' +
      '<div class="card"><h3>Egzaminy — ocena i ujawnianie</h3>' +
        '<p class="hint" style="margin-top:0">Wpisz wyniki części ustnej i ustawodawczej, a następnie kliknij „Zapisz i ujawnij”. Do tego czasu zdający nie widzi wyników.</p>' +
        '<div id="egzaminy-lista"></div>' +
      '</div>';
    $('#gen-egz-klucz').onclick = generujKluczEgz;
    $('#dodaj-pytanie').onclick = dodajPytanie;
    await Promise.all([listaKluczy(), listaPytan(), listaEgzaminow()]);
  }

  async function generujKluczEgz() {
    const kod = E.losujKod('EGZ-');
    const { error } = await E.sb.from('pseo_klucz').insert({ kod, autor: E.ja.id });
    if (error) { E.nota('#klucz-msg', E.tlumacz(error), 'err'); return; }
    E.nota('#klucz-msg', 'Wygenerowano klucz: ' + kod, 'ok');
    listaKluczy();
  }
  async function listaKluczy() {
    const { data } = await E.sb.from('pseo_klucz').select('*').order('utworzono', { ascending: false }).limit(40);
    const box = $('#klucze-lista');
    if (!data || !data.length) { box.innerHTML = '<div class="empty">Brak kluczy.</div>'; return; }
    box.innerHTML = '<div class="tbl-scroll"><table><thead><tr><th>Klucz</th><th>Status</th><th></th></tr></thead><tbody>' +
      data.map(k => '<tr><td><span class="kod">' + esc(k.kod) + '</span></td>' +
        '<td>' + (k.uzyty ? '<span class="chip">użyty</span>' : '<b style="color:var(--ok)">wolny</b>') + '</td>' +
        '<td style="text-align:right">' + (k.uzyty ? '' : '<button class="btn tiny danger" data-del-klucz="' + k.id + '">Usuń</button>') + '</td></tr>').join('') +
      '</tbody></table></div>';
    box.querySelectorAll('[data-del-klucz]').forEach(b => b.onclick = async () => {
      await E.sb.from('pseo_klucz').delete().eq('id', b.dataset.delKlucz); listaKluczy();
    });
  }

  async function dodajPytanie() {
    const tresc = $('#q-tresc').value.trim();
    const odp = ['q-a', 'q-b', 'q-c', 'q-d'].map(id => $('#' + id).value.trim());
    const poprawna = parseInt($('#q-ok').value, 10);
    if (!tresc || odp.some(o => !o)) { E.nota('#q-msg', 'Uzupełnij treść i wszystkie cztery odpowiedzi.', 'err'); return; }
    const { error } = await E.sb.from('pseo_pytanie').insert({ tresc, odpowiedzi: odp, poprawna, autor: E.ja.id });
    if (error) { E.nota('#q-msg', E.tlumacz(error), 'err'); return; }
    ['q-tresc', 'q-a', 'q-b', 'q-c', 'q-d'].forEach(id => $('#' + id).value = '');
    E.nota('#q-msg', 'Pytanie dodane.', 'ok'); setTimeout(() => E.nota('#q-msg', ''), 2000);
    listaPytan();
  }
  async function listaPytan() {
    const { data } = await E.sb.from('pseo_pytanie').select('*').order('utworzono', { ascending: false });
    const box = $('#pytania-lista');
    const n = (data || []).length;
    box.innerHTML = '<div class="hint" style="margin-bottom:10px">Pytań w bazie: <b>' + n + '</b>' + (n < 30 ? ' — do egzaminu potrzeba co najmniej 30.' : '') + '</div>' +
      (!n ? '<div class="empty">Brak pytań.</div>' :
      data.map((p, i) => '<div class="card" style="margin:8px 0"><div style="display:flex;justify-content:space-between;gap:10px">' +
        '<b>' + esc(p.tresc) + '</b><button class="btn tiny danger" data-del-q="' + p.id + '">Usuń</button></div>' +
        '<div class="hint" style="margin-top:6px">' + (p.odpowiedzi || []).map((o, oi) => (oi === p.poprawna ? '✓ ' : '') + esc(o)).join(' · ') + '</div></div>').join(''));
    box.querySelectorAll('[data-del-q]').forEach(b => b.onclick = async () => {
      if (!confirm('Usunąć pytanie?')) return;
      await E.sb.from('pseo_pytanie').delete().eq('id', b.dataset.delQ); listaPytan();
    });
  }

  async function listaEgzaminow() {
    const [{ data: egz }, { data: prof }] = await Promise.all([
      E.sb.from('pseo_egzamin').select('*').order('utworzono', { ascending: false }),
      E.sb.from('profil').select('id,imie,pni')
    ]);
    const mapa = {}; (prof || []).forEach(p => mapa[p.id] = p);
    const box = $('#egzaminy-lista');
    if (!egz || !egz.length) { box.innerHTML = '<div class="empty">Brak złożonych egzaminów.</div>'; return; }
    box.innerHTML = egz.map(x => {
      const os = mapa[x.uzytkownik] || {};
      return '<div class="card" style="margin:10px 0" data-egz="' + x.id + '">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">' +
          '<b>' + esc(os.imie || '—') + ' <span class="hint">' + esc(os.pni || '') + '</span></b>' +
          '<span class="chip">' + (x.ujawniony ? 'ujawniony' : 'w toku') + '</span></div>' +
        '<div class="grid g3" style="margin-top:12px">' +
          '<div><div class="hint">Pisemny (auto)</div><b>' + (x.wynik_pisemny != null ? x.wynik_pisemny + '%' : '—') + '</b></div>' +
          '<label class="f"><span>Ustny (%)</span><input type="number" min="0" max="100" class="e-ustny" value="' + (x.wynik_ustny != null ? x.wynik_ustny : '') + '"></label>' +
          '<label class="f"><span>Ustawodawczy (%)</span><input type="number" min="0" max="100" class="e-ustaw" value="' + (x.wynik_ustawodawczy != null ? x.wynik_ustawodawczy : '') + '"></label>' +
        '</div>' +
        '<div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">' +
          '<button class="btn sm e-zapisz">Zapisz i ujawnij</button>' +
          '<button class="btn ghost sm e-zapisz-cicho">Zapisz bez ujawniania</button>' +
          '<button class="btn tiny danger e-usun">Usuń</button></div>' +
        '<div class="e-msg"></div></div>';
    }).join('');

    box.querySelectorAll('[data-egz]').forEach(karta => {
      const id = karta.dataset.egz;
      const ust = () => ({ ustny: karta.querySelector('.e-ustny').value, ustaw: karta.querySelector('.e-ustaw').value });
      const zapisz = async (ujawnij) => {
        const v = ust();
        const wu = v.ustny === '' ? null : Number(v.ustny);
        const wa = v.ustaw === '' ? null : Number(v.ustaw);
        const rec = await E.sb.from('pseo_egzamin').select('wynik_pisemny').eq('id', id).single();
        const pis = rec.data ? Number(rec.data.wynik_pisemny) : 0;
        const zdany = ujawnij ? (pis >= PROGI.pisemny && (wu || 0) >= PROGI.ustny && (wa || 0) >= PROGI.ustawodawczy) : null;
        const patch = { wynik_ustny: wu, wynik_ustawodawczy: wa };
        if (ujawnij) { patch.ujawniony = true; patch.zdany = zdany; }
        const { error } = await E.sb.from('pseo_egzamin').update(patch).eq('id', id);
        E.nota(karta.querySelector('.e-msg') ? '#pane-admin .e-msg' : '#pane-admin', '', 'ok');
        if (error) { karta.querySelector('.e-msg').innerHTML = '<div class="note err">' + esc(E.tlumacz(error)) + '</div>'; return; }
        E.toast(ujawnij ? 'Wynik zapisany i ujawniony.' : 'Zapisano (bez ujawniania).', 'ok');
        listaEgzaminow();
      };
      karta.querySelector('.e-zapisz').onclick = () => zapisz(true);
      karta.querySelector('.e-zapisz-cicho').onclick = () => zapisz(false);
      karta.querySelector('.e-usun').onclick = async () => { if (!confirm('Usunąć egzamin?')) return; await E.sb.from('pseo_egzamin').delete().eq('id', id); listaEgzaminow(); };
    });
  }

  // init
  widokPrzystap();
  widokWyniki();
  if (admin) widokAdmin();
  if (E.trybDemo) E.toast('Tryb demonstracyjny — podłącz bazę w config.js.', 'info', 5000);
})();
