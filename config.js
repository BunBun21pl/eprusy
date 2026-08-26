// ============================================================
//  e-Prusy — KONFIGURACJA (jedyny plik do edycji)
// ============================================================
//  Self-hosted Supabase (na Twoim komputerze):
//    url   → adres, pod którym wystawiasz Supabase, np.
//            'https://eprusy.twojtunel.trycloudflare.com'
//            albo 'http://TWOJE_PUBLICZNE_IP:8000'
//    klucz → ANON_KEY z pliku .env Twojej instalacji Supabase
//
//  Supabase w chmurze: URL i „anon public” z Project Settings → Data API.
//
//  Klucz anon jest publiczny z założenia. Dostępu pilnują polityki RLS
//  z pliku schema.sql. NIGDY nie wklejaj tu klucza service_role.
// ============================================================
window.KONFIG = {
  url:   'TWOJ_URL_SUPABASE',
  klucz: 'TWOJ_KLUCZ_ANON'
};
