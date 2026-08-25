(async function () {
  const E = window.ePrusy, $ = E.$, $$ = E.$$, esc = E.esc, N = E.NAZWY_SADOW;
  await E.gotowe;
  E.rysujKonto('#acct');
  if (E.jestAdmin()) $('#nav-admin').hidden = false;

  // grupy na stronie głównej
  const GRUPY = [
    { klucz: 'powszechne', tytul: 'Sądy powszechne', sady: ['rejonowy', 'okregowy', 'wojskowy'] },
    { klucz: 'apelacyjne', tytul: 'Sądy apelacyjne', sady: ['apelacyjny'] },
    { klucz: 'najwyzszy', tytul: 'Sąd Najwyższy', sady: ['najwyzszy'] },
    { klucz: 'tk', tytul: 'Trybunał Konstytucyjny', sady: ['tk'] },
    { klucz: 'ts', tytul: 'Trybunał Stanu', sady: ['ts'] }
  ];

  if (E.jestSedzia() || E.jestAdmin()) $('#tab-sedzia').hidden = false;

  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.t === 'sedzia' && !(E.jestSedzia() || E.jestAdmin())) return;
    $$('#tabs button').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    $$('.pane').forEach(p => p.classList.remove('on'));
    $('#pane-' + b.dataset.t).classList.add('on');
  });

  /* ---------- wyroki (publiczne) ---------- */
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

  function wyrokHTML(w) {
    return '<div class="card" style="margin:10px 0">' +
      '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline">' +
        '<b style="font-size:16px">' + esc(w.tytul) + '</b>' +
        '<span class="chip">' + esc(N[w.sad] || w.sad) + '</span></div>' +
      '<div class="hint" style="margin-top:6px">' +
        [w.sygnatura ? 'Sygn. ' + esc(w.sygnatura) : '', w.data_wyroku ? esc(w.data_wyroku) : '',
         w.sedzia_imie ? 'Sędzia: ' + esc(w.sedzia_imie) : ''].filter(Boolean).join(' · ') + '</div>' +
      (w.strony ? '<div class="hint" style="margin-top:4px">Strony: ' + esc(w.strony) + '</div>' : '') +
      (w.tresc ? '<p style="margin:12px 0 0;white-space:pre-wrap">' + esc(w.tresc) + '</p>' : '') +
      (mogeEdytowac(w) ? '<div style="margin-top:12px"><button class="btn tiny danger" data-del="' + w.id + '">Usuń</button></div>' : '') +
      '</div>';
  }
  function mogeEdytowac(w) { return E.jestAdmin() || (E.ja && w.sedzia === E.ja.id); }

  /* ---------- panel sędziego ---------- */
  function widokSedzia() {
    const box = $('#pane-sedzia');
    if (!E.jestSedzia() && !E.jestAdmin()) { box.innerHTML = '<div class="empty">Panel dostępny tylko dla sędziów.</div>'; return; }
    const opcjeSad = E.jestAdmin()
      ? Object.keys(N).map(s => '<option value="' + s + '">' + N[s] + '</option>').join('')
      : '<option value="' + E.ja.sad + '">' + N[E.ja.sad] + '</option>';
    box.innerHTML =
      '<div class="card"><h3>Opublikuj wyrok</h3>' +
      '<p class="hint" style="margin-top:0">Wyrok pojawi się w publicznym rejestrze w odpowiedniej kategorii sądu.</p>' +
      '<div class="grid g2">' +
        '<label class="f"><span>Sąd</span><select id="w-sad">' + opcjeSad + '</select></label>' +
        '<label class="f"><span>Sygnatura akt</span><input type="text" id="w-sygn" placeholder="np. I C 114/26"></label>' +
      '</div>' +
      '<label class="f" style="margin-top:12px"><span>Tytuł / przedmiot sprawy</span><input type="text" id="w-tytul" placeholder="np. Wyrok w sprawie o zniesławienie"></label>' +
      '<div class="grid g2" style="margin-top:12px">' +
        '<label class="f"><span>Strony</span><input type="text" id="w-strony" placeholder="np. Prokuratura vs. J. Kowalski"></label>' +
        '<label class="f"><span>Data wyroku</span><input type="text" id="w-data" placeholder="np. 25 sierpnia 2026 r."></label>' +
      '</div>' +
      '<label class="f" style="margin-top:12px"><span>Treść wyroku / uzasadnienie</span><textarea id="w-tresc" placeholder="Sentencja i uzasadnienie…"></textarea></label>' +
      '<div style="margin-top:14px"><button class="btn" id="publikuj">Opublikuj wyrok</button></div>' +
      '<div id="w-msg"></div></div>';
    $('#publikuj').onclick = publikuj;
  }

  async function publikuj() {
    const rec = {
      sad: $('#w-sad').value, sygnatura: $('#w-sygn').value.trim(),
      tytul: $('#w-tytul').value.trim(), strony: $('#w-strony').value.trim(),
      data_wyroku: $('#w-data').value.trim(), tresc: $('#w-tresc').value.trim(),
      sedzia: E.ja.id, sedzia_imie: E.ja.imie
    };
    if (!rec.tytul) { E.nota('#w-msg', 'Podaj tytuł wyroku.', 'err'); return; }
    if (E.trybDemo) { E.nota('#w-msg', 'Tryb demonstracyjny — publikacja wymaga bazy.', 'info'); return; }
    const btn = $('#publikuj'); btn.disabled = true;
    const { error } = await E.sb.from('ess_wyrok').insert(rec);
    btn.disabled = false;
    if (error) { E.nota('#w-msg', E.tlumacz(error), 'err'); return; }
    ['w-sygn', 'w-tytul', 'w-strony', 'w-data', 'w-tresc'].forEach(id => $('#' + id).value = '');
    E.nota('#w-msg', 'Wyrok opublikowany.', 'ok');
    E.toast('Wyrok opublikowany.', 'ok');
    widokWyroki();
  }

  // usuwanie z listy publicznej
  $('#pane-wyroki').addEventListener('click', async e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    if (!confirm('Usunąć wyrok?')) return;
    const { error } = await E.sb.from('ess_wyrok').delete().eq('id', b.dataset.del);
    if (error) { E.toast(E.tlumacz(error), 'err'); return; }
    widokWyroki();
  });

  widokWyroki();
  if (E.jestSedzia() || E.jestAdmin()) widokSedzia();
  if (E.trybDemo) E.toast('Tryb demonstracyjny — podłącz bazę w config.js.', 'info', 5000);
})();
