(async function () {
  const E = window.ePrusy, $ = E.$, esc = E.esc;
  await E.gotowe;

  function nav() {
    const n = $('#nav');
    if (!E.ja) { n.innerHTML = ''; return; }
    n.innerHTML =
      '<a href="index.html" class="on">Start</a>' +
      '<a href="pseo.html">Egzaminy</a>' +
      '<a href="ess.html">Sądownictwo</a>' +
      (E.jestAdmin() ? '<a href="admin.html" class="adm">Administracja</a>' : '');
  }

  function pokaz(id) {
    ['hero', 'wybor', 'panel-gracz', 'panel-obywatel'].forEach(s => { const el = $('#' + s); if (el) el.hidden = s !== id; });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function odswiez() {
    E.rysujKonto('#acct'); nav();
    if (!E.ja) {
      $('#hero-akcje').innerHTML = '<button class="btn" id="a-login">Zaloguj się</button> <button class="btn ghost" id="a-rej">Zarejestruj się</button>';
      $('#a-login').onclick = () => E.modalAuth('login');
      $('#a-rej').onclick = () => E.modalAuth('rejestr');
      pokaz('hero');
    } else {
      pokaz('wybor');
    }
  }

  E.poZalogowaniu = odswiez;

  // wybór trybu
  $('#tryb-gracz').onclick = () => { rysujKonto(); $('#tile-admin').style.display = E.jestAdmin() ? '' : 'none'; pokaz('panel-gracz'); };
  $('#tryb-obywatel').onclick = () => pokaz('panel-obywatel');
  document.querySelectorAll('[data-powrot]').forEach(b => b.onclick = () => pokaz('wybor'));

  function rysujKonto() {
    const j = E.ja; if (!j) return;
    $('#konto-karta').innerHTML =
      '<h3>Dane konta</h3>' +
      '<div class="grid g2">' +
        '<div><div class="hint">Imię i nazwisko</div><div style="font-size:16px;font-weight:600">' + esc(j.imie) + '</div></div>' +
        '<div><div class="hint">Adres e-mail</div><div style="font-size:16px">' + esc(j.email) + '</div></div>' +
        '<div><div class="hint">Numer PNI</div><div class="kod" style="margin-top:2px">' + esc(j.pni || '—') + '</div></div>' +
        '<div><div class="hint">Uprawnienia</div><div style="margin-top:2px">' +
          (j.admin ? '<span class="tag admin">Administrator</span>' : '') +
          (j.pseoAdmin && !j.admin ? '<span class="tag pseo">Admin PSEO</span>' : '') +
          (j.sady || []).map(s => '<span class="tag sedzia">' + esc(E.NAZWY_SADOW[s]) + '</span>').join('') +
          (!j.admin && !j.pseoAdmin && !(j.sady && j.sady.length) ? '<span class="chip">Obywatel</span>' : '') +
        '</div></div>' +
      '</div>' +
      '<div style="margin-top:16px"><button class="btn ghost sm" id="zmien-imie">Zmień imię</button></div>' +
      '<div id="konto-msg"></div>';
    $('#zmien-imie').onclick = async () => {
      const nowe = prompt('Nowe imię i nazwisko:', j.imie);
      if (!nowe || !nowe.trim()) return;
      if (E.trybDemo) { E.toast('Tryb demonstracyjny — nie zapisano.'); return; }
      const { error } = await E.sb.from('profil').update({ imie: nowe.trim() }).eq('id', j.id);
      if (error) { E.nota('#konto-msg', E.tlumacz(error), 'err'); return; }
      j.imie = nowe.trim(); rysujKonto(); E.rysujKonto('#acct'); E.toast('Zapisano.', 'ok');
    };
  }

  // usługi obywatela
  document.querySelectorAll('.us').forEach(b => b.onclick = () => {
    E.nota('#us-msg', 'Usługa „' + b.dataset.us + '”: w Republice Pruskiej znajdziesz tutaj prawdziwe dane i dokumenty (IC). W tej wersji to symulacja na potrzeby rozgrywki.', 'info');
    $('#us-msg').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  odswiez();
  if (E.trybDemo) E.toast('Tryb demonstracyjny — podłącz bazę w config.js, aby się logować.', 'info', 6000);
})();
