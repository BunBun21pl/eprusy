// ============================================================
//  e-Prusy — Symulator sądowy (Supabase Edge Function)
//  Trzyma klucz Gemini po stronie serwera, wymusza uprawnienia
//  sędziego i dzienny limit spraw, a następnie woła Gemini.
//
//  Zmienne środowiskowe (ustaw: supabase secrets set ...):
//    GEMINI_KEY        — klucz z Google AI Studio (wymagany)
//    GEMINI_MODEL      — domyślnie 'gemini-2.5-flash'
//    SIM_LIMIT_DZIENNY — domyślnie '2'
//  SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY są dostarczane automatycznie.
// ============================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const KEY = Deno.env.get("GEMINI_KEY") ?? "";
const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
const LIMIT = parseInt(Deno.env.get("SIM_LIMIT_DZIENNY") ?? "2", 10);
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function gemini(prompt: string, jsonOut = false): Promise<string> {
  if (!KEY) throw new Error("Brak klucza GEMINI_KEY na serwerze.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 2048, ...(jsonOut ? { responseMimeType: "application/json" } : {}) },
  };
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("Gemini API: " + r.status + " " + (await r.text()).slice(0, 300));
  const d = await r.json();
  const txt = d?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  if (!txt) throw new Error("Pusta odpowiedź modelu.");
  return txt;
}

function parseJSON(txt: string): any {
  try { return JSON.parse(txt); } catch (_) {
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Model nie zwrócił poprawnego JSON.");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth) return json({ ok: false, blad: "Brak autoryzacji." }, 401);

    // klient „jako użytkownik” — do sprawdzenia tożsamości
    const asUser = createClient(SB_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await asUser.auth.getUser();
    if (!u?.user) return json({ ok: false, blad: "Nieprawidłowa sesja." }, 401);
    const uid = u.user.id;

    // klient service role — do uprzywilejowanych operacji
    const svc = createClient(SB_URL, SB_SERVICE);
    const { data: prof } = await svc.from("profil").select("imie, sady, admin_serwisu").eq("id", uid).maybeSingle();
    const sady: string[] = prof?.sady ?? [];
    if (!sady.length && !prof?.admin_serwisu) return json({ ok: false, blad: "Symulator jest dostępny tylko dla sędziów." }, 403);

    const { action, ...arg } = await req.json();

    // ---------- GENERUJ SPRAWĘ ----------
    if (action === "generuj") {
      const dzis = new Date().toISOString().slice(0, 10);
      const { data: lic } = await svc.from("sim_licznik").select("liczba").eq("sedzia", uid).eq("dzien", dzis).maybeSingle();
      const uzyte = lic?.liczba ?? 0;
      if (uzyte >= LIMIT) return json({ ok: false, blad: `Dzienny limit spraw (${LIMIT}) został wyczerpany. Wróć jutro.` });

      const sad = (arg.sad && sady.includes(arg.sad)) ? arg.sad : (sady[0] ?? "rejonowy");
      const { data: kod } = await svc.from("sim_prawo").select("kodeks,tresc").eq("dziedzina", "karny").order("kolejnosc");
      const prawo = (kod ?? []).map((k: { kodeks: string; tresc: string }) => `# ${k.kodeks}\n${k.tresc}`).join("\n\n");

      const prompt =
`Jesteś generatorem spraw karnych dla symulatora sądowego Republiki Pruskiej. Na podstawie WYŁĄCZNIE poniższego prawa wygeneruj jedną realistyczną, spójną sprawę karną odpowiednią dla sądu: ${sad}.
Zwróć wyłącznie obiekt JSON o polach:
{
 "tytul": krótki tytuł sprawy,
 "sygnatura": np. "II K 123/26",
 "opis": stan faktyczny znany sądowi z aktu oskarżenia (2-4 zdania, bez rozstrzygania winy),
 "oskarzony": imię i nazwisko,
 "zarzuty": [{"czyn": opis czynu, "kwalifikacja": konkretny artykuł kodeksu z tego prawa}],
 "swiadkowie": [{"imie": imię i nazwisko, "rola": np. "świadek naoczny", "pokrzywdzony", "biegły"}],
 "dowody": [krótkie opisy dowodów],
 "sekret": {
    "wina": czy oskarżony faktycznie jest winny i w jakim zakresie,
    "prawda": co naprawdę się wydarzyło (pełna wersja, znana tylko systemowi),
    "wiedza": { "imię osoby (świadek lub 'oskarżony')": "co ta osoba wie i jak zeznaje, w tym czy kłamie/zataja" }
 }
}
Dodaj 2-4 świadków. Kwalifikacje muszą pochodzić z podanego prawa. Odpowiedz po polsku.

PRAWO:
${prawo}`;

      const spr = parseJSON(await gemini(prompt, true));
      const sekret = spr.sekret ?? {};
      delete spr.sekret;

      const { data: nowa, error: e1 } = await svc.from("sim_sprawa").insert({
        sedzia: uid, sad, tytul: spr.tytul, sygnatura: spr.sygnatura, opis: spr.opis,
        oskarzony: spr.oskarzony, zarzuty: spr.zarzuty ?? [], swiadkowie: spr.swiadkowie ?? [],
        dowody: spr.dowody ?? [], status: "rozprawa",
      }).select("id").single();
      if (e1) return json({ ok: false, blad: e1.message });

      await svc.from("sim_sekret").insert({ sprawa: nowa.id, tresc: sekret });
      await svc.from("sim_wpis").insert({ sprawa: nowa.id, rola: "system", tresc: "Otwarcie rozprawy. Sąd wywołuje sprawę." });
      await svc.from("sim_licznik").upsert({ sedzia: uid, dzien: dzis, liczba: uzyte + 1 }, { onConflict: "sedzia,dzien" });

      return json({ ok: true, id: nowa.id, pozostalo: Math.max(0, LIMIT - uzyte - 1) });
    }

    // ---------- PRZESŁUCHANIE ----------
    if (action === "przesluchaj") {
      const { sprawa_id, mowca, pytanie } = arg;
      if (!sprawa_id || !mowca || !pytanie) return json({ ok: false, blad: "Brak danych przesłuchania." });
      const { data: s } = await svc.from("sim_sprawa").select("*").eq("id", sprawa_id).eq("sedzia", uid).maybeSingle();
      if (!s) return json({ ok: false, blad: "Nie znaleziono sprawy." }, 404);
      if (s.status !== "rozprawa") return json({ ok: false, blad: "Rozprawa jest zakończona." });
      const { data: sek } = await svc.from("sim_sekret").select("tresc").eq("sprawa", sprawa_id).maybeSingle();
      const { data: hist } = await svc.from("sim_wpis").select("rola,mowca,tresc").eq("sprawa", sprawa_id).order("utworzono");

      const wiedza = sek?.tresc?.wiedza?.[mowca] ?? "Brak szczególnej wiedzy — odpowiadaj zgodnie z rolą.";
      const transkrypt = (hist ?? []).map((w: { rola: string; mowca?: string; tresc: string }) =>
        `${w.rola === "sedzia" ? "SĄD" : (w.mowca ?? w.rola).toUpperCase()}: ${w.tresc}`).join("\n");

      const prompt =
`Odgrywasz osobę na sali rozpraw w Republice Pruskiej: ${mowca}. Odpowiadasz w pierwszej osobie, realistycznie i konsekwentnie, zgodnie z tym co ta osoba wie i jak by się zachowała (może być zdenerwowana, wymijająca, może zatajać niekorzystne fakty — ale nie zmyślaj rzeczy sprzecznych z prawdą sprawy).
Sprawa: ${s.tytul}. Zarzut wobec oskarżonego ${s.oskarzony}.
Stan faktyczny: ${s.opis}
Co ta osoba naprawdę wie: ${JSON.stringify(wiedza)}
Dotychczasowy przebieg rozprawy:
${transkrypt || "(brak)"}

Pytanie sądu do Ciebie (${mowca}): "${pytanie}"
Odpowiedz krótko (1-4 zdania), tylko słowami tej osoby, bez didaskaliów.`;

      const odp = await gemini(prompt, false);
      await svc.from("sim_wpis").insert([
        { sprawa: sprawa_id, rola: "sedzia", tresc: pytanie },
        { sprawa: sprawa_id, rola: (mowca === s.oskarzony ? "oskarzony" : "swiadek"), mowca, tresc: odp.trim() },
      ]);
      return json({ ok: true, odpowiedz: odp.trim() });
    }

    // ---------- WYROK ----------
    if (action === "wyrok") {
      const { sprawa_id, rozstrzygniecie, uzasadnienie } = arg;
      if (!sprawa_id || !rozstrzygniecie) return json({ ok: false, blad: "Podaj rozstrzygnięcie." });
      const { data: s } = await svc.from("sim_sprawa").select("*").eq("id", sprawa_id).eq("sedzia", uid).maybeSingle();
      if (!s) return json({ ok: false, blad: "Nie znaleziono sprawy." }, 404);
      const { data: sek } = await svc.from("sim_sekret").select("tresc").eq("sprawa", sprawa_id).maybeSingle();

      let ocena = "";
      try {
        const prompt =
`Jesteś recenzentem dydaktycznym w symulatorze sądowym Republiki Pruskiej. Oceń krótko (3-5 zdań) wyrok wydany przez ćwiczącego sędziego — czy jest spójny z materiałem sprawy i prawdą, oraz czy dobrze uzasadniony. Nie przesądzaj kategorycznie; wskaż mocne strony i ewentualne uchybienia.
Sprawa: ${s.tytul}; oskarżony ${s.oskarzony}; zarzuty: ${JSON.stringify(s.zarzuty)}.
Prawda o sprawie: ${JSON.stringify(sek?.tresc ?? {})}
Wyrok sędziego — rozstrzygnięcie: ${rozstrzygniecie}
Uzasadnienie: ${uzasadnienie ?? "(brak)"}`;
        ocena = (await gemini(prompt, false)).trim();
      } catch (_) { ocena = ""; }

      await svc.from("sim_sprawa").update({ status: "zakonczona", wyrok: { rozstrzygniecie, uzasadnienie: uzasadnienie ?? "", ocena } }).eq("id", sprawa_id);
      await svc.from("sim_wpis").insert({ sprawa: sprawa_id, rola: "system", tresc: "Ogłoszenie wyroku: " + rozstrzygniecie });
      return json({ ok: true, ocena });
    }

    return json({ ok: false, blad: "Nieznana operacja." }, 400);
  } catch (e) {
    return json({ ok: false, blad: String((e as Error).message ?? e) }, 500);
  }
});
