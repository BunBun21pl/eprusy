(async function () {
  const E = window.ePrusy, $ = E.$, $$ = E.$$, esc = E.esc, N = E.NAZWY_SADOW;
  await E.gotowe;
  E.rysujKonto('#acct');
  if (E.jestAdmin()) $('#nav-admin').hidden = false;

  const STATUSY = ['prawomocny', 'nieprawomocny', 'prawomocny z klauzulą wykonalności'];
  const GRUPY = [
    { klucz: 'powszechne', tytul: 'Sądy powszechne', sady: ['rejonowy', 'okregowy', 'wojskowy'] },
    { klucz: 'apelacyjne', tytul: 'Sądy apelacyjne', sady: ['apelacyjny'] },
    { klucz: 'najwyzszy', tytul: 'Sąd Najwyższy', sady: ['najwyzszy'] },
    { klucz: 'tk', tytul: 'Trybunał Konstytucyjny', sady: ['tk'] },
    { klucz: 'ts', tytul: 'Trybunał Stanu', sady: ['ts'] }
  ];
  const OPTGROUPS = [
    { label: 'Sądy powszechne', sady: ['rejonowy', 'okregowy', 'wojskowy'] },
    { label: 'Sądy apelacyjne', sady: ['apelacyjny'] },
    { label: 'Sąd Najwyższy', sady: ['najwyzszy'] },
    { label: 'Trybunały', sady: ['tk', 'ts'] }
  ];

  const mojeSady = () => E.jestAdmin() ? Object.keys(N) : (E.ja ? E.ja.sady : []);
  const mogeOrzekac = () => mojeSady().length > 0;
  if (mogeOrzekac()) $('#tab-sedzia').hidden = false;

  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.t === 'sedzia' && !mogeOrzekac()) return;
    $$('#tabs button').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    $$('.pane').forEach(p => p.classList.remove('on'));
    $('#pane-' + b.dataset.t).classList.add('on');
    if (b.dataset.t === 'wyroki') widokWyroki();
  });

  /* ---------- WYROKI (publiczne) ---------- */
  async function widokWyroki() {
    const box = $('#pane-wyroki');
    if (E.trybDemo) { box.innerHTML = '<div class="empty">Tryb demonstracyjny — brak połączenia z bazą.</div>'; return; }
    const { data, error } = await E.sb.from('ess_wyrok').select('*').order('utworzono', { ascending: false });
    if (error) { box.innerHTML = '<div class="note err">' + esc(E.tlumacz(error)) + '</div>'; return; }
    const wg = {}; (data || []).forEach(w => { (wg[w.sad] = wg[w.sad] || []).push(w); });
    box.innerHTML = GRUPY.map(g => {
      const lista = g.sady.flatMap(s => wg[s] || []);
      return '<div class="card" style="margin-bottom:16px"><h3>' + esc(g.tytul) + ' <span class="chip">' + lista.length + '</span></h3>' +
        (!lista.length ? '<div class="empty">Brak opublikowanych wyroków.</div>' :
          lista.map(w => wyrokHTML(w)).join('')) + '</div>';
    }).join('');
  }

  function punktyZ(w) {
    let p = w.sentencja;
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { p = []; } }
    return Array.isArray(p) ? p.filter(x => String(x).trim()) : [];
  }

  function wyrokHTML(w) {
    const punkty = punktyZ(w);
    const meta = [w.sygnatura ? 'Sygn. akt ' + esc(w.sygnatura) : '',
      (w.miejscowosc || w.data_wyroku) ? esc([w.miejscowosc, w.data_wyroku].filter(Boolean).join(', ')) : ''
    ].filter(Boolean).join(' · ');
    return '<div class="wyrok">' +
      '<div class="wyrok-godlo">☩</div>' +
      '<div class="wyrok-imieniu">W imieniu Republiki Pruskiej</div>' +
      '<div class="wyrok-sad">' + esc(w.nazwa_sadu || N[w.sad] || '') + '</div>' +
      (meta ? '<div class="wyrok-meta">' + meta + '</div>' : '') +
      '<div class="wyrok-glowa">' +
        '<span class="chip">' + esc(N[w.sad] || w.sad) + '</span>' +
        (w.status ? '<span class="wyrok-status ' + (/nieprawomocny/.test(w.status) ? 'np' : 'pr') + '">' + esc(w.status) + '</span>' : '') +
      '</div>' +
      (w.przedmiot || w.tytul ? '<div class="wyrok-przedmiot">' + esc(w.przedmiot || w.tytul) + '</div>' : '') +
      (w.strony ? '<div class="wyrok-linia"><span>Strony / uczestnicy:</span> ' + esc(w.strony) + '</div>' : '') +
      (w.sklad ? '<div class="wyrok-linia"><span>Skład orzekający:</span> ' + esc(w.sklad).replace(/\n/g, '<br>') + '</div>' : '') +
      '<div class="wyrok-sekcja">Sentencja</div>' +
      (punkty.length
        ? '<ol class="wyrok-punkty">' + punkty.map(p => '<li>' + esc(p) + '</li>').join('') + '</ol>'
        : (w.tresc ? '<p class="wyrok-tresc">' + esc(w.tresc) + '</p>' : '<p class="hint">—</p>')) +
      (w.uzasadnienie ? '<div class="wyrok-sekcja">Uzasadnienie</div><p class="wyrok-tresc">' + esc(w.uzasadnienie) + '</p>' : '') +
      '<div class="wyrok-stopka"><span>' + esc(w.sedzia_imie ? 'Orzekał(a): ' + w.sedzia_imie : '') + '</span>' +
        (mogeEdytowac(w) ? '<button class="btn tiny danger" data-del="' + w.id + '">Usuń</button>' : '<span></span>') + '</div>' +
      '</div>';
  }
  function mogeEdytowac(w) { return E.jestAdmin() || (E.ja && w.sedzia === E.ja.id); }

  /* ---------- PANEL SĘDZIEGO ---------- */
  let punkty = [''];

  function optcje() {
    const dozw = mojeSady();
    return OPTGROUPS.map(g => {
      const opts = g.sady.filter(s => dozw.indexOf(s) >= 0)
        .map(s => '<option value="' + s + '">' + esc(N[s]) + '</option>').join('');
      return opts ? '<optgroup label="' + esc(g.label) + '">' + opts + '</optgroup>' : '';
    }).join('');
  }

  function widokSedzia() {
    const box = $('#pane-sedzia');
    if (!mogeOrzekac()) { box.innerHTML = '<div class="empty">Panel dostępny tylko dla sędziów.</div>'; return; }
    box.innerHTML =
      '<div class="card"><h3>Wydaj wyrok</h3>' +
      '<p class="hint" style="margin-top:0">Wypełnij formularz według wzoru procesowego. Każdy wyrok wydawany jest w imieniu Republiki Pruskiej i pojawi się w zakładce właściwego sądu.</p>' +
      '<div class="wyrok-imieniu" style="margin:6px 0 18px">W imieniu Republiki Pruskiej</div>' +
      '<div class="grid g2">' +
        '<label class="f"><span>Sąd / trybunał</span><select id="w-sad">' + optcje() + '</select></label>' +
        '<label class="f"><span>Nazwa orzekającego sądu</span><input type="text" id="w-nazwa" placeholder="np. Sąd Okręgowy w Królewcu"></label>' +
      '</div>' +
      '<div class="grid g2" style="margin-top:12px">' +
        '<label class="f"><span>Data wydania</span><input type="text" id="w-data" placeholder="np. 21 sierpnia 2026 r."></label>' +
        '<label class="f"><span>Miejscowość</span><input type="text" id="w-miejsc" placeholder="np. Królewiec"></label>' +
      '</div>' +
      '<div class="grid g2" style="margin-top:12px;align-items:end">' +
        '<label class="f"><span>Sygnatura akt</span><input type="text" id="w-sygn" placeholder="np. II K 3/26"></label>' +
        '<div><button class="btn ghost" id="gen-sygn">Generuj sygnaturę</button></div>' +
      '</div>' +
      '<label class="f" style="margin-top:12px"><span>Przedmiot sprawy</span><input type="text" id="w-przedmiot" placeholder="np. Wniosek o zbadanie zgodności ustawy z Konstytucją"></label>' +
      '<div class="grid g2" style="margin-top:12px">' +
        '<label class="f"><span>Strony / uczestnicy</span><input type="text" id="w-strony" placeholder="np. Wnioskodawca: Rzecznik Praw Obywatelskich"></label>' +
        '<label class="f"><span>Status orzeczenia</span><select id="w-status">' + STATUSY.map(s => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('') + '</select></label>' +
      '</div>' +
      '<label class="f" style="margin-top:12px"><span>Skład orzekający</span><textarea id="w-sklad" style="min-height:80px" placeholder="Przewodniczący: …&#10;Sędziowie: …"></textarea></label>' +
      '<div class="wyrok-sekcja" style="margin-top:18px">Sentencja — „orzeka / postanawia”</div>' +
      '<div id="punkty-box"></div>' +
      '<button class="btn ghost sm" id="dodaj-punkt" style="margin-top:6px">+ Dodaj punkt</button>' +
      '<label class="f" style="margin-top:18px"><span>Uzasadnienie</span><textarea id="w-uzas" style="min-height:130px" placeholder="Motywy rozstrzygnięcia…"></textarea></label>' +
      '<div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">' +
        '<button class="btn" id="publikuj">Opublikuj wyrok</button>' +
        '<button class="btn ghost" id="wyczysc">Wyczyść</button></div>' +
      '<div id="w-msg"></div></div>';

    rysujPunkty();
    $('#gen-sygn').onclick = generujSygn;
    $('#dodaj-punkt').onclick = () => { punkty.push(''); rysujPunkty(); };
    $('#publikuj').onclick = publikuj;
    $('#wyczysc').onclick = wyczysc;
  }

  function rysujPunkty() {
    const box = $('#punkty-box');
    box.innerHTML = punkty.map((tresc, i) =>
      '<div class="punkt" data-i="' + i + '">' +
        '<span class="punkt-nr">' + (i + 1) + '.</span>' +
        '<textarea class="punkt-in" placeholder="Treść punktu rozstrzygnięcia…">' + esc(tresc) + '</textarea>' +
        (punkty.length > 1 ? '<button class="btn tiny danger punkt-del" title="Usuń punkt">×</button>' : '<span style="width:34px"></span>') +
      '</div>').join('');
    box.querySelectorAll('.punkt-in').forEach(t => t.addEventListener('input', e => {
      punkty[+e.target.closest('.punkt').dataset.i] = e.target.value;
    }));
    box.querySelectorAll('.punkt-del').forEach(b => b.onclick = () => {
      punkty.splice(+b.closest('.punkt').dataset.i, 1); rysujPunkty();
    });
  }

  function generujSygn() {
    const dzialy = ['C', 'K', 'U', 'Ns', 'Kp', 'W', 'SK'];
    const rzym = ['I', 'II', 'III', 'IV', 'V'];
    const s = $('#w-sad') ? $('#w-sad').value : '';
    let baza;
    if (s === 'tk') baza = 'K ' + (Math.floor(Math.random() * 40) + 1);
    else if (s === 'ts') baza = 'TS ' + (Math.floor(Math.random() * 10) + 1);
    else baza = rzym[Math.floor(Math.random() * rzym.length)] + ' ' + dzialy[Math.floor(Math.random() * dzialy.length)] + ' ' + (Math.floor(Math.random() * 300) + 1);
    $('#w-sygn').value = baza + '/' + String(new Date().getFullYear()).slice(2);
  }

  function wyczysc() {
    ['w-nazwa', 'w-data', 'w-miejsc', 'w-sygn', 'w-przedmiot', 'w-strony', 'w-sklad', 'w-uzas'].forEach(id => { const el = $('#' + id); if (el) el.value = ''; });
    punkty = ['']; rysujPunkty(); E.nota('#w-msg', '');
  }

  async function publikuj() {
    const listaPunktow = punkty.map(p => String(p).trim()).filter(Boolean);
    const rec = {
      sad: $('#w-sad').value,
      nazwa_sadu: $('#w-nazwa').value.trim() || N[$('#w-sad').value],
      miejscowosc: $('#w-miejsc').value.trim(),
      data_wyroku: $('#w-data').value.trim(),
      sygnatura: $('#w-sygn').value.trim(),
      przedmiot: $('#w-przedmiot').value.trim(),
      strony: $('#w-strony').value.trim(),
      status: $('#w-status').value,
      sklad: $('#w-sklad').value.trim(),
      sentencja: listaPunktow,
      uzasadnienie: $('#w-uzas').value.trim(),
      tytul: $('#w-przedmiot').value.trim(),
      sedzia: E.ja.id, sedzia_imie: E.ja.imie
    };
    if (!rec.przedmiot) { E.nota('#w-msg', 'Podaj przedmiot sprawy.', 'err'); return; }
    if (!listaPunktow.length) { E.nota('#w-msg', 'Dodaj co najmniej jeden punkt sentencji.', 'err'); return; }
    if (E.trybDemo) { E.nota('#w-msg', 'Tryb demonstracyjny — publikacja wymaga bazy.', 'info'); return; }
    const btn = $('#publikuj'); btn.disabled = true;
    const { error } = await E.sb.from('ess_wyrok').insert(rec);
    btn.disabled = false;
    if (error) { E.nota('#w-msg', E.tlumacz(error), 'err'); return; }
    wyczysc();
    E.nota('#w-msg', 'Wyrok opublikowany w rejestrze.', 'ok');
    E.toast('Wyrok opublikowany.', 'ok');
  }

  $('#pane-wyroki').addEventListener('click', async e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    if (!confirm('Usunąć wyrok?')) return;
    const { error } = await E.sb.from('ess_wyrok').delete().eq('id', b.dataset.del);
    if (error) { E.toast(E.tlumacz(error), 'err'); return; }
    widokWyroki();
  });

  widokWyroki();
  if (mogeOrzekac()) widokSedzia();
  if (E.trybDemo) E.toast('Tryb demonstracyjny — podłącz bazę w config.js.', 'info', 5000);
})();
