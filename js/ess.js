(async function () {
  const E = window.ePrusy, $ = E.$, $$ = E.$$, esc = E.esc, N = E.NAZWY_SADOW;
  await E.gotowe;
  E.rysujKonto('#acct');
  if (E.jestAdmin()) $('#nav-admin').hidden = false;

  const STATUSY = ['prawomocny', 'nieprawomocny', 'prawomocny z klauzulą wykonalności'];
  const GRUPY = [
    { tytul: 'Sądy powszechne', sady: ['rejonowy', 'okregowy', 'wojskowy'] },
    { tytul: 'Sądy apelacyjne', sady: ['apelacyjny'] },
    { tytul: 'Sąd Najwyższy', sady: ['najwyzszy'] },
    { tytul: 'Trybunał Konstytucyjny', sady: ['tk'] },
    { tytul: 'Trybunał Stanu', sady: ['ts'] }
  ];
  const OPTGROUPS = [
    { label: 'Sądy powszechne', sady: ['rejonowy', 'okregowy', 'wojskowy'] },
    { label: 'Sądy apelacyjne', sady: ['apelacyjny'] },
    { label: 'Sąd Najwyższy', sady: ['najwyzszy'] },
    { label: 'Trybunały', sady: ['tk', 'ts'] }
  ];
  const opcjeSad = (dozw) => OPTGROUPS.map(g => {
    const opts = g.sady.filter(s => dozw.indexOf(s) >= 0).map(s => '<option value="' + s + '">' + esc(N[s]) + '</option>').join('');
    return opts ? '<optgroup label="' + esc(g.label) + '">' + opts + '</optgroup>' : '';
  }).join('');
  const grupujPo = (data) => { const wg = {}; (data || []).forEach(w => { (wg[w.sad] = wg[w.sad] || []).push(w); }); return wg; };
  const punktyZ = (v, pole) => {
    let p = v[pole]; if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { p = []; } }
    return Array.isArray(p) ? p.filter(x => String(x).trim()) : [];
  };

  const mojeSady = () => E.jestAdmin() ? Object.keys(N) : (E.ja ? E.ja.sady : []);
  const mogeOrzekac = () => mojeSady().length > 0;
  const mogeOskarzac = () => E.jestProkurator();
  if (mogeOrzekac()) $('#tab-sedzia').hidden = false;
  if (mogeOskarzac()) $('#tab-prok').hidden = false;

  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.t === 'sedzia' && !mogeOrzekac()) return;
    if (b.dataset.t === 'prok' && !mogeOskarzac()) return;
    $$('#tabs button').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    $$('.pane').forEach(p => p.classList.remove('on'));
    $('#pane-' + b.dataset.t).classList.add('on');
    if (b.dataset.t === 'wyroki') widokWyroki();
    if (b.dataset.t === 'prokuratura') widokProkuratura();
  });

  /* ============================================================
     WYROKI — „W imieniu Republiki Pruskiej” (motyw złoty)
     ============================================================ */
  async function widokWyroki() {
    const box = $('#pane-wyroki');
    if (E.trybDemo) { box.innerHTML = '<div class="empty">Tryb demonstracyjny — brak połączenia z bazą.</div>'; return; }
    const { data, error } = await E.sb.from('ess_wyrok').select('*').order('utworzono', { ascending: false });
    if (error) { box.innerHTML = '<div class="note err">' + esc(E.tlumacz(error)) + '</div>'; return; }
    const wg = grupujPo(data);
    box.innerHTML = GRUPY.map(g => {
      const lista = g.sady.flatMap(s => wg[s] || []);
      return '<div class="card" style="margin-bottom:16px"><h3>' + esc(g.tytul) + ' <span class="chip">' + lista.length + '</span></h3>' +
        (!lista.length ? '<div class="empty">Brak opublikowanych wyroków.</div>' : lista.map(wyrokHTML).join('')) + '</div>';
    }).join('');
  }

  function wyrokHTML(w) {
    const punkty = punktyZ(w, 'sentencja');
    const meta = [w.sygnatura ? 'Sygn. akt ' + esc(w.sygnatura) : '',
      (w.miejscowosc || w.data_wyroku) ? esc([w.miejscowosc, w.data_wyroku].filter(Boolean).join(', ')) : ''].filter(Boolean).join(' · ');
    return '<div class="wyrok">' +
      '<div class="wyrok-godlo">☩</div>' +
      '<div class="wyrok-imieniu">W imieniu Republiki Pruskiej</div>' +
      '<div class="wyrok-sad">' + esc(w.nazwa_sadu || N[w.sad] || '') + '</div>' +
      (meta ? '<div class="wyrok-meta">' + meta + '</div>' : '') +
      '<div class="wyrok-glowa"><span class="chip">' + esc(N[w.sad] || w.sad) + '</span>' +
        (w.status ? '<span class="wyrok-status ' + (/nieprawomocny/.test(w.status) ? 'np' : 'pr') + '">' + esc(w.status) + '</span>' : '') + '</div>' +
      (w.przedmiot || w.tytul ? '<div class="wyrok-przedmiot">' + esc(w.przedmiot || w.tytul) + '</div>' : '') +
      (w.strony ? '<div class="wyrok-linia"><span>Strony / uczestnicy:</span> ' + esc(w.strony) + '</div>' : '') +
      (w.sklad ? '<div class="wyrok-linia"><span>Skład orzekający:</span> ' + esc(w.sklad).replace(/\n/g, '<br>') + '</div>' : '') +
      '<div class="wyrok-sekcja">Sentencja</div>' +
      (punkty.length ? '<ol class="wyrok-punkty">' + punkty.map(p => '<li>' + esc(p) + '</li>').join('') + '</ol>'
        : (w.tresc ? '<p class="wyrok-tresc">' + esc(w.tresc) + '</p>' : '<p class="hint">—</p>')) +
      (w.uzasadnienie ? '<div class="wyrok-sekcja">Uzasadnienie</div><p class="wyrok-tresc">' + esc(w.uzasadnienie) + '</p>' : '') +
      '<div class="wyrok-stopka"><span>' + esc(w.sedzia_imie ? 'Orzekał(a): ' + w.sedzia_imie : '') + '</span>' +
        ((E.jestAdmin() || (E.ja && w.sedzia === E.ja.id)) ? '<button class="btn tiny danger" data-delw="' + w.id + '">Usuń</button>' : '<span></span>') + '</div>' +
      '</div>';
  }

  /* ---------- panel sędziego ---------- */
  let punkty = [''];
  function widokSedzia() {
    const box = $('#pane-sedzia');
    if (!mogeOrzekac()) { box.innerHTML = '<div class="empty">Panel dostępny tylko dla sędziów.</div>'; return; }
    box.innerHTML =
      '<div class="card"><h3>Wydaj wyrok</h3>' +
      '<p class="hint" style="margin-top:0">Wypełnij formularz według wzoru procesowego. Każdy wyrok wydawany jest w imieniu Republiki Pruskiej i pojawi się w zakładce właściwego sądu.</p>' +
      '<div class="wyrok-imieniu" style="margin:6px 0 18px">W imieniu Republiki Pruskiej</div>' +
      '<div class="grid g2">' +
        '<label class="f"><span>Sąd / trybunał</span><select id="w-sad">' + opcjeSad(mojeSady()) + '</select></label>' +
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
        '<button class="btn acc" id="publikuj">Opublikuj wyrok</button>' +
        '<button class="btn ghost" id="wyczysc">Wyczyść</button></div>' +
      '<div id="w-msg"></div></div>';
    rysujListe('#punkty-box', punkty, 'Treść punktu rozstrzygnięcia…', v => { punkty = v; });
    $('#gen-sygn').onclick = () => $('#w-sygn').value = genSygnSad($('#w-sad').value);
    $('#dodaj-punkt').onclick = () => { punkty.push(''); rysujListe('#punkty-box', punkty, 'Treść punktu rozstrzygnięcia…', v => { punkty = v; }); };
    $('#publikuj').onclick = publikujWyrok;
    $('#wyczysc').onclick = () => { czysc(['w-nazwa','w-data','w-miejsc','w-sygn','w-przedmiot','w-strony','w-sklad','w-uzas']); punkty = ['']; rysujListe('#punkty-box', punkty, 'Treść punktu rozstrzygnięcia…', v => { punkty = v; }); E.nota('#w-msg',''); };
  }

  async function publikujWyrok() {
    const lista = punkty.map(p => String(p).trim()).filter(Boolean);
    const rec = {
      sad: $('#w-sad').value, nazwa_sadu: $('#w-nazwa').value.trim() || N[$('#w-sad').value],
      miejscowosc: $('#w-miejsc').value.trim(), data_wyroku: $('#w-data').value.trim(),
      sygnatura: $('#w-sygn').value.trim(), przedmiot: $('#w-przedmiot').value.trim(),
      strony: $('#w-strony').value.trim(), status: $('#w-status').value, sklad: $('#w-sklad').value.trim(),
      sentencja: lista, uzasadnienie: $('#w-uzas').value.trim(), tytul: $('#w-przedmiot').value.trim(),
      sedzia: E.ja.id, sedzia_imie: E.ja.imie
    };
    if (!rec.przedmiot) { E.nota('#w-msg', 'Podaj przedmiot sprawy.', 'err'); return; }
    if (!lista.length) { E.nota('#w-msg', 'Dodaj co najmniej jeden punkt sentencji.', 'err'); return; }
    if (E.trybDemo) { E.nota('#w-msg', 'Tryb demonstracyjny — publikacja wymaga bazy.', 'info'); return; }
    const btn = $('#publikuj'); btn.disabled = true;
    const { error } = await E.sb.from('ess_wyrok').insert(rec); btn.disabled = false;
    if (error) { E.nota('#w-msg', E.tlumacz(error), 'err'); return; }
    czysc(['w-nazwa','w-data','w-miejsc','w-sygn','w-przedmiot','w-strony','w-sklad','w-uzas']); punkty = ['']; rysujListe('#punkty-box', punkty, 'Treść punktu rozstrzygnięcia…', v => { punkty = v; });
    E.nota('#w-msg', 'Wyrok opublikowany w rejestrze.', 'ok'); E.toast('Wyrok opublikowany.', 'ok');
  }

  /* ============================================================
     PROKURATURA — akty oskarżenia (motyw bordowy)
     ============================================================ */
  async function widokProkuratura() {
    const box = $('#pane-prokuratura');
    if (E.trybDemo) { box.innerHTML = '<div class="empty">Tryb demonstracyjny — brak połączenia z bazą.</div>'; return; }
    const { data, error } = await E.sb.from('ess_akt').select('*').order('utworzono', { ascending: false });
    if (error) { box.innerHTML = '<div class="note err">' + esc(E.tlumacz(error)) + '</div>'; return; }
    const wg = grupujPo(data);
    box.innerHTML = GRUPY.map(g => {
      const lista = g.sady.flatMap(s => wg[s] || []);
      return '<div class="card" style="margin-bottom:16px"><h3>Kierowane do: ' + esc(g.tytul) + ' <span class="chip">' + lista.length + '</span></h3>' +
        (!lista.length ? '<div class="empty">Brak aktów oskarżenia.</div>' : lista.map(aktHTML).join('')) + '</div>';
    }).join('');
  }

  function aktHTML(a) {
    const zarzuty = punktyZ(a, 'zarzuty');
    const meta = [a.sygnatura ? 'Sygn. akt ' + esc(a.sygnatura) : '',
      (a.miejscowosc || a.data_aktu) ? esc([a.miejscowosc, a.data_aktu].filter(Boolean).join(', ')) : ''].filter(Boolean).join(' · ');
    return '<div class="wyrok">' +
      '<div class="wyrok-godlo">§</div>' +
      '<div class="wyrok-imieniu">Akt oskarżenia</div>' +
      '<div class="wyrok-sad">' + esc(a.prokuratura || 'Prokuratura') + '</div>' +
      (meta ? '<div class="wyrok-meta">' + meta + '</div>' : '') +
      '<div class="wyrok-glowa"><span class="chip">kierowany do: ' + esc(N[a.sad] || a.sad) + '</span></div>' +
      (a.oskarzony ? '<div class="wyrok-przedmiot">przeciwko: ' + esc(a.oskarzony) + '</div>' : '') +
      (a.pokrzywdzony ? '<div class="wyrok-linia"><span>Pokrzywdzony:</span> ' + esc(a.pokrzywdzony) + '</div>' : '') +
      '<div class="wyrok-sekcja">Zarzuty</div>' +
      (zarzuty.length ? '<ol class="wyrok-punkty">' + zarzuty.map(z => '<li>' + esc(z) + '</li>').join('') + '</ol>' : '<p class="hint">—</p>') +
      (a.uzasadnienie ? '<div class="wyrok-sekcja">Uzasadnienie</div><p class="wyrok-tresc">' + esc(a.uzasadnienie) + '</p>' : '') +
      (a.wnioski ? '<div class="wyrok-sekcja">Wnioski</div><p class="wyrok-tresc">' + esc(a.wnioski) + '</p>' : '') +
      '<div class="wyrok-stopka"><span>' + esc(a.prokurator_imie ? 'Oskarża: ' + a.prokurator_imie : '') + '</span>' +
        ((E.jestAdmin() || (E.ja && a.prokurator === E.ja.id)) ? '<button class="btn tiny danger" data-dela="' + a.id + '">Usuń</button>' : '<span></span>') + '</div>' +
      '</div>';
  }

  /* ---------- panel prokuratora ---------- */
  let zarzuty = [''];
  function widokProkPanel() {
    const box = $('#pane-prok');
    if (!mogeOskarzac()) { box.innerHTML = '<div class="empty">Panel dostępny tylko dla prokuratorów.</div>'; return; }
    box.innerHTML =
      '<div class="card"><h3>Wnieś akt oskarżenia</h3>' +
      '<p class="hint" style="margin-top:0">Akt oskarżenia kierujesz do właściwego sądu. Pojawi się w zakładce „Prokuratura”.</p>' +
      '<div class="wyrok-imieniu" style="margin:6px 0 18px">Akt oskarżenia</div>' +
      '<div class="grid g2">' +
        '<label class="f"><span>Sąd, do którego kierowany</span><select id="a-sad">' + opcjeSad(Object.keys(N)) + '</select></label>' +
        '<label class="f"><span>Prokuratura</span><input type="text" id="a-prok" placeholder="np. Prokuratura Rejonowa w Królewcu"></label>' +
      '</div>' +
      '<div class="grid g2" style="margin-top:12px">' +
        '<label class="f"><span>Data</span><input type="text" id="a-data" placeholder="np. 21 sierpnia 2026 r."></label>' +
        '<label class="f"><span>Miejscowość</span><input type="text" id="a-miejsc" placeholder="np. Królewiec"></label>' +
      '</div>' +
      '<div class="grid g2" style="margin-top:12px;align-items:end">' +
        '<label class="f"><span>Sygnatura akt</span><input type="text" id="a-sygn" placeholder="np. PR Ds 45/26"></label>' +
        '<div><button class="btn ghost" id="gen-sygn-a">Generuj sygnaturę</button></div>' +
      '</div>' +
      '<div class="grid g2" style="margin-top:12px">' +
        '<label class="f"><span>Oskarżony</span><input type="text" id="a-osk" placeholder="np. Jan Kowalski, s. Andrzeja"></label>' +
        '<label class="f"><span>Pokrzywdzony (opcjonalnie)</span><input type="text" id="a-pokrz" placeholder="np. Skarb Państwa"></label>' +
      '</div>' +
      '<div class="wyrok-sekcja" style="margin-top:18px">Zarzuty — „oskarżam o to, że…”</div>' +
      '<div id="zarzuty-box"></div>' +
      '<button class="btn ghost sm" id="dodaj-zarzut" style="margin-top:6px">+ Dodaj zarzut</button>' +
      '<label class="f" style="margin-top:18px"><span>Uzasadnienie</span><textarea id="a-uzas" style="min-height:120px" placeholder="Opis stanu faktycznego i dowodów…"></textarea></label>' +
      '<label class="f" style="margin-top:12px"><span>Wnioski końcowe (opcjonalnie)</span><textarea id="a-wnioski" style="min-height:80px" placeholder="Wnioski dowodowe, wniosek o wymiar kary…"></textarea></label>' +
      '<div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">' +
        '<button class="btn acc" id="wniesc">Wnieś akt oskarżenia</button>' +
        '<button class="btn ghost" id="a-wyczysc">Wyczyść</button></div>' +
      '<div id="a-msg"></div></div>';
    rysujListe('#zarzuty-box', zarzuty, 'Treść zarzutu wraz z kwalifikacją prawną…', v => { zarzuty = v; });
    $('#gen-sygn-a').onclick = () => $('#a-sygn').value = genSygnProk();
    $('#dodaj-zarzut').onclick = () => { zarzuty.push(''); rysujListe('#zarzuty-box', zarzuty, 'Treść zarzutu wraz z kwalifikacją prawną…', v => { zarzuty = v; }); };
    $('#wniesc').onclick = wniescAkt;
    $('#a-wyczysc').onclick = () => { czysc(['a-prok','a-data','a-miejsc','a-sygn','a-osk','a-pokrz','a-uzas','a-wnioski']); zarzuty = ['']; rysujListe('#zarzuty-box', zarzuty, 'Treść zarzutu wraz z kwalifikacją prawną…', v => { zarzuty = v; }); E.nota('#a-msg',''); };
  }

  async function wniescAkt() {
    const lista = zarzuty.map(z => String(z).trim()).filter(Boolean);
    const rec = {
      sad: $('#a-sad').value, prokuratura: $('#a-prok').value.trim(),
      miejscowosc: $('#a-miejsc').value.trim(), data_aktu: $('#a-data').value.trim(),
      sygnatura: $('#a-sygn').value.trim(), oskarzony: $('#a-osk').value.trim(),
      pokrzywdzony: $('#a-pokrz').value.trim(), zarzuty: lista,
      uzasadnienie: $('#a-uzas').value.trim(), wnioski: $('#a-wnioski').value.trim(),
      prokurator: E.ja.id, prokurator_imie: E.ja.imie
    };
    if (!rec.oskarzony) { E.nota('#a-msg', 'Podaj oskarżonego.', 'err'); return; }
    if (!lista.length) { E.nota('#a-msg', 'Dodaj co najmniej jeden zarzut.', 'err'); return; }
    if (E.trybDemo) { E.nota('#a-msg', 'Tryb demonstracyjny — publikacja wymaga bazy.', 'info'); return; }
    const btn = $('#wniesc'); btn.disabled = true;
    const { error } = await E.sb.from('ess_akt').insert(rec); btn.disabled = false;
    if (error) { E.nota('#a-msg', E.tlumacz(error), 'err'); return; }
    czysc(['a-prok','a-data','a-miejsc','a-sygn','a-osk','a-pokrz','a-uzas','a-wnioski']); zarzuty = ['']; rysujListe('#zarzuty-box', zarzuty, 'Treść zarzutu wraz z kwalifikacją prawną…', v => { zarzuty = v; });
    E.nota('#a-msg', 'Akt oskarżenia wniesiony.', 'ok'); E.toast('Akt oskarżenia wniesiony.', 'ok');
  }

  /* ---------- wspólne pomocnicze ---------- */
  function rysujListe(sel, tab, ph, ustaw) {
    const box = $(sel); if (!box) return;
    box.innerHTML = tab.map((tresc, i) =>
      '<div class="punkt" data-i="' + i + '"><span class="punkt-nr">' + (i + 1) + '.</span>' +
      '<textarea class="punkt-in" placeholder="' + esc(ph) + '">' + esc(tresc) + '</textarea>' +
      (tab.length > 1 ? '<button class="btn tiny danger punkt-del" title="Usuń">×</button>' : '<span style="width:34px"></span>') + '</div>').join('');
    box.querySelectorAll('.punkt-in').forEach(t => t.addEventListener('input', e => { tab[+e.target.closest('.punkt').dataset.i] = e.target.value; ustaw(tab); }));
    box.querySelectorAll('.punkt-del').forEach(b => b.onclick = () => { tab.splice(+b.closest('.punkt').dataset.i, 1); ustaw(tab); rysujListe(sel, tab, ph, ustaw); });
  }
  function czysc(ids) { ids.forEach(id => { const el = $('#' + id); if (el) el.value = ''; }); }
  function genSygnSad(s) {
    const dzialy = ['C', 'K', 'U', 'Ns', 'Kp', 'W'], rzym = ['I', 'II', 'III', 'IV', 'V'];
    let b; if (s === 'tk') b = 'K ' + (Math.floor(Math.random() * 40) + 1);
    else if (s === 'ts') b = 'TS ' + (Math.floor(Math.random() * 10) + 1);
    else b = rzym[Math.floor(Math.random() * rzym.length)] + ' ' + dzialy[Math.floor(Math.random() * dzialy.length)] + ' ' + (Math.floor(Math.random() * 300) + 1);
    return b + '/' + String(new Date().getFullYear()).slice(2);
  }
  function genSygnProk() {
    const pre = ['PR', 'PO', 'PK'][Math.floor(Math.random() * 3)];
    return pre + ' ' + (Math.floor(Math.random() * 4) + 1) + ' Ds ' + (Math.floor(Math.random() * 400) + 1) + '/' + String(new Date().getFullYear()).slice(2);
  }

  // usuwanie z list publicznych
  $('#pane-wyroki').addEventListener('click', async e => {
    const b = e.target.closest('[data-delw]'); if (!b) return;
    if (!confirm('Usunąć wyrok?')) return;
    const { error } = await E.sb.from('ess_wyrok').delete().eq('id', b.dataset.delw);
    if (error) { E.toast(E.tlumacz(error), 'err'); return; } widokWyroki();
  });
  $('#pane-prokuratura').addEventListener('click', async e => {
    const b = e.target.closest('[data-dela]'); if (!b) return;
    if (!confirm('Usunąć akt oskarżenia?')) return;
    const { error } = await E.sb.from('ess_akt').delete().eq('id', b.dataset.dela);
    if (error) { E.toast(E.tlumacz(error), 'err'); return; } widokProkuratura();
  });

  widokWyroki();
  widokProkuratura();
  if (mogeOrzekac()) widokSedzia();
  if (mogeOskarzac()) widokProkPanel();
  if (E.trybDemo) E.toast('Tryb demonstracyjny — podłącz bazę w config.js.', 'info', 5000);
})();
