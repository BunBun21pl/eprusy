(async function () {
  const E = window.ePrusy, $ = E.$, $$ = E.$$, esc = E.esc, N = E.NAZWY_SADOW;
  await E.gotowe;
  if (!E.wymagajLogowania()) return;
  if (!E.wymagajAdmina()) return;
  E.rysujKonto('#acct');

  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#tabs button').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    $$('.pane').forEach(p => p.classList.remove('on'));
    $('#pane-' + b.dataset.t).classList.add('on');
  });

  /* ---------- klucze rejestracji ---------- */
  function widokKlucze() {
    $('#pane-klucze').innerHTML =
      '<div class="card"><h3>Wygeneruj klucz dostępu (PNI)</h3>' +
      '<p class="hint" style="margin-top:0">Klucz przekazujesz osobie, która ma się zarejestrować — wpisuje go w polu „numer PNI”. Każdy klucz jest jednorazowy.</p>' +
      '<div class="grid g2"><label class="f"><span>Opis (opcjonalnie)</span><input type="text" id="k-opis" placeholder="np. dla Jana Wilczyńskiego"></label>' +
      '<div style="display:flex;align-items:flex-end"><button class="btn" id="gen-klucz">Wygeneruj klucz</button></div></div>' +
      '<div id="k-msg"></div><div id="klucze-lista" style="margin-top:16px"></div></div>';
    $('#gen-klucz').onclick = generuj;
    listaKluczy();
  }

  async function generuj() {
    const kod = E.losujKod('PNI-');
    const opis = $('#k-opis').value.trim() || null;
    const { error } = await E.sb.from('klucz_rejestracji').insert({ kod, opis, autor: E.ja.id });
    if (error) { E.nota('#k-msg', E.tlumacz(error), 'err'); return; }
    $('#k-opis').value = '';
    E.nota('#k-msg', 'Wygenerowano klucz: ' + kod + ' — skopiuj i przekaż użytkownikowi.', 'ok');
    listaKluczy();
  }

  async function listaKluczy() {
    const { data, error } = await E.sb.from('klucz_rejestracji').select('*').order('utworzono', { ascending: false });
    const box = $('#klucze-lista');
    if (error) { box.innerHTML = '<div class="note err">' + esc(E.tlumacz(error)) + '</div>'; return; }
    if (!data || !data.length) { box.innerHTML = '<div class="empty">Brak kluczy. Wygeneruj pierwszy.</div>'; return; }
    box.innerHTML = '<div class="tbl-scroll"><table><thead><tr><th>Klucz</th><th>Opis</th><th>Status</th><th></th></tr></thead><tbody>' +
      data.map(k => '<tr><td><span class="kod">' + esc(k.kod) + '</span></td>' +
        '<td class="hint">' + esc(k.opis || '—') + '</td>' +
        '<td>' + (k.uzyty ? '<span class="chip">wykorzystany</span>' : '<b style="color:var(--ok)">wolny</b>') + '</td>' +
        '<td style="text-align:right">' +
          '<button class="btn tiny ghost" data-copy="' + esc(k.kod) + '">Kopiuj</button> ' +
          (k.uzyty ? '' : '<button class="btn tiny danger" data-del="' + k.id + '">Usuń</button>') +
        '</td></tr>').join('') + '</tbody></table></div>';
    box.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
      navigator.clipboard && navigator.clipboard.writeText(b.dataset.copy);
      E.toast('Skopiowano ' + b.dataset.copy, 'ok');
    });
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      await E.sb.from('klucz_rejestracji').delete().eq('id', b.dataset.del); listaKluczy();
    });
  }

  /* ---------- użytkownicy i uprawnienia ---------- */
  async function widokUzytkownicy() {
    const box = $('#pane-uzytkownicy');
    if (E.trybDemo) { box.innerHTML = '<div class="empty">Tryb demonstracyjny — brak połączenia z bazą.</div>'; return; }
    const { data, error } = await E.sb.from('profil').select('*').order('utworzono', { ascending: true });
    if (error) { box.innerHTML = '<div class="note err">' + esc(E.tlumacz(error)) + '</div>'; return; }
    box.innerHTML = '<div class="card"><h3>Użytkownicy (' + (data || []).length + ')</h3>' +
      '<p class="hint" style="margin-top:0">Zaznacz uprawnienia i wybierz sądy, w których dana osoba może wydawać wyroki. Zmiany zapisują się natychmiast.</p>' +
      '<div class="tbl-scroll"><table><thead><tr><th>Użytkownik</th><th>PNI</th><th>Administrator</th><th>Admin PSEO</th><th>Sędzia — sądy (zaznacz)</th></tr></thead><tbody>' +
      (data || []).map(u => wiersz(u)).join('') + '</tbody></table></div></div>';

    box.querySelectorAll('tr[data-uid]').forEach(tr => {
      const uid = tr.dataset.uid;
      const zapisz = async patch => {
        const { error } = await E.sb.from('profil').update(patch).eq('id', uid);
        if (error) { E.toast(E.tlumacz(error), 'err'); return false; }
        E.toast('Zapisano uprawnienia.', 'ok'); return true;
      };
      tr.querySelector('.c-admin').onchange = e => zapisz({ admin_serwisu: e.target.checked });
      tr.querySelector('.c-pseo').onchange = e => zapisz({ pseo_admin: e.target.checked });
      tr.querySelectorAll('.c-sad').forEach(chk => chk.onchange = () => {
        const sady = Array.from(tr.querySelectorAll('.c-sad')).filter(c => c.checked).map(c => c.value);
        zapisz({ sady });
      });
    });
  }

  function wiersz(u) {
    const sam = u.id === E.ja.id;
    const posiada = u.sady || [];
    const checkboxy = Object.keys(N).map(s =>
      '<label class="sad-chk"><input type="checkbox" class="c-sad" value="' + s + '"' + (posiada.indexOf(s) >= 0 ? ' checked' : '') + '> ' + esc(N[s]) + '</label>').join('');
    return '<tr data-uid="' + u.id + '">' +
      '<td><b>' + esc(u.imie || '—') + '</b><div class="hint">' + esc(u.email || '') + (sam ? ' · to Ty' : '') + '</div></td>' +
      '<td><span class="kod">' + esc(u.pni || '—') + '</span></td>' +
      '<td><input type="checkbox" class="c-admin" style="width:auto"' + (u.admin_serwisu ? ' checked' : '') + (sam ? ' title="Nie odbieraj uprawnień samemu sobie"' : '') + '></td>' +
      '<td><input type="checkbox" class="c-pseo" style="width:auto"' + (u.pseo_admin ? ' checked' : '') + '></td>' +
      '<td><div class="sad-grid">' + checkboxy + '</div></td>' +
      '</tr>';
  }

  widokKlucze();
  widokUzytkownicy();
})();
