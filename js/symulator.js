(async function () {
  const E = window.ePrusy, $ = E.$, $$ = E.$$, esc = E.esc, N = E.NAZWY_SADOW;
  await E.gotowe;
  if (!E.ja) return;

  const jestSedzia = () => (E.ja.sady && E.ja.sady.length) || E.ja.admin;
  const mojeSady = () => E.ja.admin ? Object.keys(N) : (E.ja.sady || []);
  if (!jestSedzia()) return;
  $('#tab-symulator').hidden = false;

  let aktywna = null;   // otwarta sprawa
  let pierwsze = true;

  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.dataset.t !== 'symulator') return;
    if (pierwsze) { pierwsze = false; widokLista(); }
  });

  async function wywolaj(body) {
    if (E.trybDemo) return { data: { ok: false, blad: 'Tryb demonstracyjny — symulator wymaga podłączonej funkcji.' } };
    const res = await E.sb.functions.invoke('symulator', { body });
    // supabase-js zwraca ogólny błąd przy statusie != 2xx — wyciągnij prawdziwy komunikat z treści
    if (res.error) {
      let blad = res.error.message || 'Błąd funkcji symulatora.';
      try {
        const ctx = res.error.context;
        if (ctx && typeof ctx.json === 'function') { const b = await ctx.json(); if (b && b.blad) blad = b.blad; }
        else if (ctx && typeof ctx.text === 'function') { const t = await ctx.text(); if (t) { try { const b = JSON.parse(t); if (b.blad) blad = b.blad; } catch (_) { blad = t.slice(0, 300); } } }
      } catch (_) { /* zostaw ogólny komunikat */ }
      return { data: { ok: false, blad } };
    }
    return res;
  }

  /* ---------- lista spraw + generowanie ---------- */
  async function widokLista() {
    const box = $('#pane-symulator');
    const opcjeSad = mojeSady().map(s => '<option value="' + s + '">' + esc(N[s]) + '</option>').join('');
    box.innerHTML =
      '<div class="card"><h3>Symulator rozprawy</h3>' +
      '<p class="hint" style="margin-top:0">Wygeneruj sprawę karną zgodną z prawem Republiki Pruskiej, przesłuchaj świadków i oskarżonego, a następnie wydaj wyrok. To tryb ćwiczeniowy — nie trafia do oficjalnego rejestru wyroków.</p>' +
      '<div id="lim-info" class="hint"></div>' +
      '<div class="grid g2" style="margin-top:8px;align-items:end">' +
        (mojeSady().length > 1 ? '<label class="f"><span>Sąd</span><select id="sim-sad">' + opcjeSad + '</select></label>' : '<input type="hidden" id="sim-sad" value="' + esc(mojeSady()[0] || 'rejonowy') + '">') +
        '<div><button class="btn acc" id="gen-sprawa">Wygeneruj nową sprawę</button></div>' +
      '</div><div id="gen-msg"></div></div>' +
      '<div id="sim-lista"></div>' +
      '<div id="sim-sprawa"></div>';
    $('#gen-sprawa').onclick = generuj;
    listaSpraw();
    limit();
  }

  async function limit() {
    if (E.trybDemo) return;
    const dzis = new Date().toISOString().slice(0, 10);
    const { data } = await E.sb.from('sim_licznik').select('liczba').eq('sedzia', E.ja.id).eq('dzien', dzis).maybeSingle();
    const box = $('#lim-info'); if (box) box.textContent = 'Sprawy wygenerowane dziś: ' + (data ? data.liczba : 0) + '.';
  }

  async function generuj() {
    const btn = $('#gen-sprawa'); btn.disabled = true;
    E.nota('#gen-msg', 'Generuję sprawę… może to potrwać kilkanaście sekund.', 'info');
    const sad = $('#sim-sad') ? $('#sim-sad').value : 'rejonowy';
    const { data, error } = await wywolaj({ action: 'generuj', sad });
    btn.disabled = false;
    if (error) { E.nota('#gen-msg', E.tlumacz(error), 'err'); return; }
    if (!data || !data.ok) { E.nota('#gen-msg', (data && data.blad) || 'Nie udało się wygenerować sprawy.', 'err'); return; }
    E.nota('#gen-msg', 'Sprawa gotowa.' + (data.pozostalo != null ? ' Pozostało dziś: ' + data.pozostalo + '.' : ''), 'ok');
    await listaSpraw(); limit();
    otworz(data.id);
  }

  async function listaSpraw() {
    if (E.trybDemo) { $('#sim-lista').innerHTML = '<div class="empty">Tryb demonstracyjny.</div>'; return; }
    const { data } = await E.sb.from('sim_sprawa').select('id,tytul,sygnatura,oskarzony,status,utworzono').order('utworzono', { ascending: false });
    const box = $('#sim-lista');
    if (!data || !data.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="card"><h3>Twoje sprawy</h3>' + data.map(s =>
      '<div class="sim-row" data-id="' + s.id + '">' +
        '<div><b>' + esc(s.tytul || 'Sprawa') + '</b> <span class="hint">' + esc(s.sygnatura || '') + ' · ' + esc(s.oskarzony || '') + '</span></div>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          '<span class="' + (s.status === 'zakonczona' ? 'status-zakonczone' : 'status-trwa') + '">' + (s.status === 'zakonczona' ? 'Zakończona' : 'Rozprawa') + '</span>' +
          '<button class="btn ghost sm" data-open="' + s.id + '">Otwórz</button>' +
          '<button class="btn tiny danger" data-del="' + s.id + '">Usuń</button>' +
        '</div></div>').join('') + '</div>';
    box.querySelectorAll('[data-open]').forEach(b => b.onclick = () => otworz(b.dataset.open));
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('Usunąć sprawę?')) return; await E.sb.from('sim_sprawa').delete().eq('id', b.dataset.del); if (aktywna && aktywna.id === b.dataset.del) { aktywna = null; $('#sim-sprawa').innerHTML = ''; } listaSpraw(); });
  }

  /* ---------- otwarcie sprawy: akta + rozprawa + wyrok ---------- */
  async function otworz(id) {
    const { data: s } = await E.sb.from('sim_sprawa').select('*').eq('id', id).single();
    if (!s) return;
    aktywna = s;
    const zarzuty = (s.zarzuty || []).map((z, i) => '<li><b>' + esc(z.czyn || '') + '</b>' + (z.kwalifikacja ? ' — <span class="mono">' + esc(z.kwalifikacja) + '</span>' : '') + '</li>').join('');
    const dowody = (s.dowody || []).map(d => '<li>' + esc(typeof d === 'string' ? d : (d.opis || JSON.stringify(d))) + '</li>').join('');
    const osoby = [{ imie: s.oskarzony, rola: 'oskarżony' }].concat(s.swiadkowie || []);
    const opcjeOsob = osoby.map(o => '<option value="' + esc(o.imie) + '">' + esc(o.imie) + ' — ' + esc(o.rola || '') + '</option>').join('');
    const zakonczona = s.status === 'zakonczona';

    $('#sim-sprawa').innerHTML =
      '<div class="wyrok" style="margin-top:16px">' +
        '<div class="wyrok-imieniu">Akta sprawy</div>' +
        '<div class="wyrok-sad">' + esc(s.tytul || '') + '</div>' +
        '<div class="wyrok-meta">' + [s.sygnatura ? 'Sygn. ' + esc(s.sygnatura) : '', esc(N[s.sad] || '')].filter(Boolean).join(' · ') + '</div>' +
        '<div class="wyrok-linia"><span>Oskarżony:</span> ' + esc(s.oskarzony || '') + '</div>' +
        (s.opis ? '<p class="wyrok-tresc">' + esc(s.opis) + '</p>' : '') +
        (zarzuty ? '<div class="wyrok-sekcja">Zarzuty</div><ol class="akta-lista">' + zarzuty + '</ol>' : '') +
        (dowody ? '<div class="wyrok-sekcja">Dowody</div><ul class="akta-lista">' + dowody + '</ul>' : '') +
      '</div>' +
      '<div class="card" style="margin-top:16px"><h3>Przebieg rozprawy</h3>' +
        '<div id="sim-transkrypt" class="transkrypt"></div>' +
        (zakonczona ? '' :
          '<div class="grid g2" style="margin-top:14px;align-items:end">' +
            '<label class="f"><span>Przesłuchaj</span><select id="sim-mowca">' + opcjeOsob + '</select></label>' +
            '<div></div></div>' +
          '<label class="f" style="margin-top:10px"><span>Pytanie sądu</span><textarea id="sim-pytanie" style="min-height:70px" placeholder="np. Gdzie Pan/Pani przebywał(a) wieczorem w dniu zdarzenia?"></textarea></label>' +
          '<div style="margin-top:10px"><button class="btn" id="sim-pytaj">Zadaj pytanie</button></div>' +
          '<div id="sim-pmsg"></div>') +
      '</div>' +
      '<div class="card" style="margin-top:16px"><h3>Wyrok</h3>' +
        (zakonczona ? kartaWyroku(s.wyrok) :
          '<div class="wyrok-imieniu" style="margin-bottom:14px">W imieniu Republiki Pruskiej</div>' +
          '<label class="f"><span>Rozstrzygnięcie</span><input type="text" id="sw-rozstrz" placeholder="np. uznaje oskarżonego za winnego i skazuje na karę 1 roku pozbawienia wolności"></label>' +
          '<label class="f" style="margin-top:12px"><span>Uzasadnienie</span><textarea id="sw-uzas" style="min-height:110px" placeholder="Motywy rozstrzygnięcia w oparciu o materiał dowodowy i prawo…"></textarea></label>' +
          '<div style="margin-top:14px"><button class="btn acc" id="sw-wydaj">Wydaj wyrok</button></div>' +
          '<div id="sw-msg"></div>') +
      '</div>';

    rysujTranskrypt(id);
    $('#sim-sprawa').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!zakonczona) {
      $('#sim-pytaj').onclick = () => pytaj(id);
      $('#sw-wydaj').onclick = () => wydaj(id);
    }
  }

  function kartaWyroku(w) {
    w = w || {};
    return '<div class="wyrok-imieniu" style="margin-bottom:10px">W imieniu Republiki Pruskiej</div>' +
      '<p class="wyrok-tresc"><b>' + esc(w.rozstrzygniecie || '') + '</b></p>' +
      (w.uzasadnienie ? '<div class="wyrok-sekcja">Uzasadnienie</div><p class="wyrok-tresc">' + esc(w.uzasadnienie) + '</p>' : '') +
      (w.ocena ? '<div class="wyrok-sekcja">Ocena dydaktyczna</div><div class="note info" style="white-space:pre-wrap">' + esc(w.ocena) + '</div>' : '');
  }

  async function rysujTranskrypt(id) {
    const { data } = await E.sb.from('sim_wpis').select('*').eq('sprawa', id).order('utworzono');
    const box = $('#sim-transkrypt'); if (!box) return;
    if (!data || !data.length) { box.innerHTML = '<div class="hint">Rozprawa jeszcze się nie rozpoczęła.</div>'; return; }
    box.innerHTML = data.map(w => {
      if (w.rola === 'system') return '<div class="t-sys">' + esc(w.tresc) + '</div>';
      const kto = w.rola === 'sedzia' ? 'Sąd' : (w.mowca || (w.rola === 'oskarzony' ? 'Oskarżony' : 'Świadek'));
      return '<div class="t-wiersz ' + (w.rola === 'sedzia' ? 't-sedzia-w' : 't-osoba') + '">' +
        '<div class="t-kto">' + esc(kto) + '</div><div class="t-tresc">' + esc(w.tresc) + '</div></div>';
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  async function pytaj(id) {
    const mowca = $('#sim-mowca').value, pytanie = $('#sim-pytanie').value.trim();
    if (!pytanie) { E.nota('#sim-pmsg', 'Wpisz pytanie.', 'err'); return; }
    const btn = $('#sim-pytaj'); btn.disabled = true;
    E.nota('#sim-pmsg', 'Świadek się zastanawia…', 'info');
    const { data, error } = await wywolaj({ action: 'przesluchaj', sprawa_id: id, mowca, pytanie });
    btn.disabled = false;
    if (error) { E.nota('#sim-pmsg', E.tlumacz(error), 'err'); return; }
    if (!data || !data.ok) { E.nota('#sim-pmsg', (data && data.blad) || 'Błąd przesłuchania.', 'err'); return; }
    $('#sim-pytanie').value = ''; E.nota('#sim-pmsg', '');
    rysujTranskrypt(id);
  }

  async function wydaj(id) {
    const rozstrzygniecie = $('#sw-rozstrz').value.trim(), uzasadnienie = $('#sw-uzas').value.trim();
    if (!rozstrzygniecie) { E.nota('#sw-msg', 'Podaj rozstrzygnięcie.', 'err'); return; }
    if (!confirm('Wydać wyrok? Rozprawa zostanie zamknięta.')) return;
    const btn = $('#sw-wydaj'); btn.disabled = true;
    E.nota('#sw-msg', 'Ogłaszanie wyroku…', 'info');
    const { data, error } = await wywolaj({ action: 'wyrok', sprawa_id: id, rozstrzygniecie, uzasadnienie });
    btn.disabled = false;
    if (error) { E.nota('#sw-msg', E.tlumacz(error), 'err'); return; }
    if (!data || !data.ok) { E.nota('#sw-msg', (data && data.blad) || 'Błąd.', 'err'); return; }
    E.toast('Wyrok wydany.', 'ok');
    await listaSpraw(); otworz(id);
  }
})();
