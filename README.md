# Roblox AI Game Builder

**Build games on Roblox Studio using your own API keys.**

Opisujesz grę po polsku (albo w dowolnym języku) → aplikacja prowadzi rozmowę z modelem AI
(OpenAI, Claude, Gemini, OpenRouter, DeepSeek, Groq, Mistral, xAI, Ollama…) i produkuje **kompletny,
grywalny projekt Roblox**: design, szkielet mapy, kod Luau i eksport jednym kliknięciem do Roblox Studio.

* **Wtyczka do Roblox Studio z pełnym UI** — buduje grę w otwartym miejscu, a potem **zmieniasz ją rozmową z AI**
  prosto z panelu w Studiu („dodaj sklep”, „zwiększ trudność”, „dodaj bossa na 10. fali”).
* **Live sync** — wtyczka pilnuje rewizji projektu i **dociąga do Studia tylko zmienione skrypty**.
  Edytujesz kod w aplikacji (albo w edytorze w UI) i po ~2 s masz zmianę w otwartym miejscu, bez przebudowy mapy.
* **Naprawa błędów z testu w Studiu** — wtyczka nasłuchuje `LogService`, więc po Twoim Play ma listę realnych
  błędów runtime i jednym przyciskiem wysyła je do modelu jako zadanie naprawcze.
* **Audyt całego projektu** — ocena 0-100 i lista sprawdzeń: pokrycie planu, `require()` do istniejących modułów,
  RemoteEventy używane po obu stronach, skrypt startowy, autorytet serwera, systemy z designu.
* **Auto-naprawa kodu** — po wygenerowaniu walidator wskazuje błędy, a model sam przepisuje wadliwe pliki
  (do 2 rund) i projekt jest walidowany ponownie.
* **Podgląd na żywo i licznik kosztów** — widzisz, jak model pisze kod (strumień ze wszystkich 10 dostawców),
  a po zakończeniu koszt projektu w USD; opcjonalny **limit wydatków** zatrzymuje generowanie w trakcie.
* **Znaczniki assetów** — kod może zawierać `"placeholder:coin"`; wtyczka podmienia je na darmowe assety
  z katalogu (30 pozycji) jednym kliknięciem.
* **Biblioteka projektów z wersjami** — każda generacja i każda zmiana zapisuje się w `.projects/`
  (ostatnie 5 wersji), więc do gry wracasz jednym kliknięciem, a zmianę możesz cofnąć.
* **Generator ikon (PNG 512×512)** — proceduralna ikona gry w palecie dopasowanej do gatunku, gotowa do wgrania na Roblox.
* **Historia wersji i rollback** — każda generacja, zmiana i edycja pliku to nowa wersja; przywrócenie działa
  z aplikacji i z panelu Studia (rollback tworzy kolejną wersję, więc nic nie ginie).
* **5 gier demo offline** — Obby, Tower Defense, Arena PvP, Tycoon i Horror, w całości lokalnie, bez klucza API.
* **Zero zależności** w runtime — czysty Node.js (>=18), jeden `npm start`.
* **Własne klucze (BYOK)** — klucz nie opuszcza Twojej maszyny, nie jest nigdzie zapisywany.
* **Walidator jakości** — sprawdza przestarzałe API, placeholdery, brakujące `return`, spójność świata i **kompiluje każdy plik Luau prawdziwym parserem Luau** w testach (68 testów).

---

## Szybki start

```bash
git clone https://github.com/rejson59/RobloxAIGameBuilder.git
cd RobloxAIGameBuilder
npm start
```

Otwórz `http://localhost:5173` (albo adres, który wypisze konsola).

1. **Chcesz tylko zobaczyć, jak to działa?** Kliknij demo po lewej (np. „Neon Rush Tower Defense”) — projekt powstaje natychmiast, bez klucza API, i możesz go od razu pobrać.
2. **Chcesz swoją grę?** Przełącz na „Własny klucz API”, wklej klucz, wybierz model, opisz grę i kliknij **Zbuduj grę**.
3. **Chcesz to mieć w Studiu?** Zakładka **Wtyczka Studio** → *Pobierz .plugin.luau* → wrzuć do folderu wtyczek → w Studiu kliknij **Buduj grę**.

> Klucz API trzymany jest wyłącznie w pamięci serwera tej sesji i wysyłany tylko do wybranego dostawcy.

---

## Dodanie gry do Roblox Studio (najważniejsze)

Trzy drogi, wszystkie prowadzą do grywalnego miejsca:

### A. Wtyczka z pełnym UI — rekomendowane

1. W aplikacji zakładka **Wtyczka Studio** → **Pobierz .plugin.luau** (albo skopiuj kod przyciskiem).
2. Roblox Studio → **Plugins → Plugins Folder** (otworzy folder na dysku).
3. Skopiuj tam plik `.plugin.luau` i zrestartuj Studio.
4. Na pasku pojawi się **Roblox AI Game Builder**:

| Element wtyczki | Co robi |
| --- | --- |
| **Buduj grę** (pasek + panel) | Wstawia mapę, światła i wszystkie skrypty w otwarte miejsce. Operacja jest w historii zmian, więc `Ctrl+Z` cofa. |
| **Zmień grę (AI)** | Panel z polem tekstowym: opisujesz zmianę, wtyczka wysyła projekt do lokalnego buildera (`npm start`), odbiera nowe pliki, zapisuje i przebudowuje miejsce. Pasek postępu + możliwość przerwania. |
| **Zaślepki assetów** | Skanuje miejsce i wypisuje `Decal`/`Sound`/`MeshId`/`ImageLabel` bez wartości (typowe po imporcie). Klik = zaznaczenie instancji. |
| **Darmowe assety** | Jednym kliknięciem wstawia dźwięki i tekstury z biblioteki Robloxa (gotowe do podmiany). |
| **Ikona gry** | Pobiera proceduralną ikonę PNG 512×512 i zapisuje ją w folderze wtyczek (do wgrania na create.roblox.com). |
| **Live sync** | Przełącznik: co 2,5 s sprawdza rewizję projektu i podmienia tylko zmienione skrypty (z historią zmian). |
| **Napraw błędy z Play** | Po teście gry wysyła zebrane błędy runtime do modelu i przebudowuje miejsce z poprawkami. |
| **Podmień znaczniki assetów** | Zamienia `"placeholder:coin"`, `"placeholder:neon_grid"` itd. na darmowe assety z katalogu. |
| **Historia wersji** | Lista wersji projektu z przyciskiem „Przywróć” — cofa nieudaną zmianę bez wychodzenia ze Studia. |

Żeby działały funkcje AI, w Studiu musi być włączone **Game Settings → Security → Allow HTTP Requests**
(serwer budujący działa na `127.0.0.1:5173`, czyli na Twojej maszynie). Budowanie gry i assety działają **bez** połączenia.

### B. `.rbxmx` — najprościej (30 sekund)

1. Pobierz plik `nazwa-gry.rbxmx`.
2. Roblox Studio → **New → Baseplate**.
3. Przeciągnij plik `.rbxmx` do okna Studio (albo **Model → Import from file**).
4. Naciśnij **Play** (F5).

Skrypty lądują automatycznie w odpowiednich usługach: `Script` → ServerScriptService,
`LocalScript` → StarterPlayerScripts, `ModuleScript` → ReplicatedStorage.Shared, a mapa w Workspace.

### C. `.rbxlx` (całe miejsce) albo Rojo (dla programistów)

* **`.rbxlx`** — pobierz i otwórz w Studiu jak zwykły plik miejsca.
* **Rojo** — pobierz ZIP, rozpakuj, `rojo serve`, w Studiu wtyczka Rojo → *Connect*.

---

## Zmienianie gry rozmową (refine)

Największa różnica względem „generatora na jeden strzał”: projekt można dalej rozwijać bez zaczynania od zera.

**W aplikacji:** wygeneruj grę → zakładka **Zmień grę (AI)** → napisz np. „dodaj sklep z ulepszeniami i ranking graczy”
→ *Zastosuj zmianę*. Model dostaje pełny projekt (kod + mapa + design), zwraca **tylko zmienione/nowe pliki**,
walidator je sprawdza, auto-naprawa domyka błędy, a całość zapisuje się jako **nowa wersja** w bibliotece.

**W Studiu:** panel wtyczki → to samo pole tekstowe. Po zmianie wtyczka od razu przebudowuje miejsce,
więc efekt widzisz bez wychodzenia z Robloxa.

Kontrakt zmian jest celowo bezpieczny: nowe pliki mogą powstawać tylko w `src/{server,client,shared}/`,
ścieżki spoza projektu są odrzucane, a każdy plik przechodzi linter i parser Luau.

---

## Live sync: edytujesz tutaj, widzisz w Studiu

1. W aplikacji wygeneruj projekt i pobierz wtyczkę.
2. W Studiu kliknij **Buduj grę**, a potem zaznacz **Live sync** w sekcji 1 panelu.
3. Zmieniaj cokolwiek: w zakładce **Pliki Luau** włącz **Edytuj**, popraw kod i kliknij **Zapisz zmiany**
   (albo poproś AI o zmianę, albo przywróć starszą wersję z zakładki **Historia**).
4. Wtyczka zauważy nową rewizję i podmieni **tylko ten skrypt** — mapa i reszta kodu zostają nietknięte.

Działa to też w drugą stronę: jeśli dopiszesz kod w Studiu, projekt w aplikacji nadal możesz rozwijać
(wtyczka wysyła aktualny kod do modelu przy każdej zmianie przez AI).

## Audyt projektu (ocena 0-100)

Zakładka **Audyt** pokazuje sprawdzenia, których nie zrobi żaden linter pojedynczego pliku:

| Sprawdzenie | Co wykrywa |
| --- | --- |
| Pokrycie planu | pliki z planu, których model nie napisał (i pliki spoza planu) |
| `require()` | odwołania do modułów, które nie istnieją — najczęstsza przyczyna błędów po uruchomieniu |
| RemoteEventy | nazwy z planu, których nie ma w kodzie albo są tylko po jednej stronie |
| Skrypt startowy | brak `*.server.luau`, który spina systemy (gra po prostu nic nie robi) |
| Autorytet serwera | `DataStoreService`/`ServerStorage` w skrypcie klienta |
| Systemy z designu | systemy opisane w designie bez śladu w kodzie |
| Niedokończone | pliki praktycznie puste i znaczniki TODO/FIXME |

Wynik trafia też do biblioteki, więc od razu widzisz, które projekty wymagają uwagi.

## Koszty i budżet

* Każde zadanie zapisuje zużycie tokenów i **szacunkowy koszt** (cennik w `server/pricing.js`, edytowalny).
* W statystykach projektu i na liście biblioteki widzisz kwotę; w trakcie generowania licznik rośnie po każdej odpowiedzi modelu.
* **Limit wydatków**: pole „Limit wydatków na projekt (USD)” w UI albo `MAX_COST_USD=0.5 npm start`.
  Po przekroczeniu generowanie zatrzymuje się z jasnym komunikatem (projekt częściowy zostaje w zadaniu).
* Strumieniowanie pokazuje, co model pisze (i ile znaków już napisał) — zamiast pustego paska postępu.

## Assety: znaczniki zamiast zgadywanych ID

Model **nie wpisuje** `rbxassetid://…` (walidator tego zabrania), ale może zostawić znacznik:

```lua
coinSound.SoundId = "placeholder:coin"        -- dźwięk monety
decal.Texture = "placeholder:neon_grid"       -- świecąca siatka
```

Wtyczka ma przycisk **„Podmień znaczniki placeholder:…”**: skanuje miejsce, dopasowuje tagi do katalogu
darmowych assetów (`server/assets.js`, 30 pozycji: dźwięki UI, ruchu, atmosfera, tekstury) i podstawia ID.
Nic nie dzieje się bez Twojego kliknięcia, a katalog możesz dowolnie edytować.

---

## Jak to działa (pipeline)

```
opis gracza
     │
     ├─ 1. DESIGN      → nazwa, gatunek, pętla rozgrywki, systemy, balans, dokument projektowy (Markdown)
     ├─ 2. WORLD       → deklaratywne drzewo instancji: spawn, mapa, światła, GUI dekoracyjne
     ├─ 3. PLAN        → architektura plików Luau + kontrakt RemoteEventów
     ├─ 4. CODE        → kod pisany paczkami w kolejności zależności:
     │                    shared → moduły serwera → bootstrap → skrypty serwera → klient
     ├─ 5. WALIDACJA   → linter + parser Luau + sanity świata
     └─ 6. AUTO-NAPRAWA → model przepisuje pliki z błędami (do 2 rund), walidacja od nowa
                            │
                            ├─ biblioteka (.projects/ + wersje)
                            ├─ ikona PNG 512×512
                            └─ eksport: ZIP (Rojo) · .rbxmx · .rbxlx · .plugin.luau
```

Kod jest generowany **paczkami**, a nie jednym wielkim zapytaniem, dlatego projekty mają 5-18 plików
i nie urywają się w połowie z powodu limitu tokenów. Każda paczka widzi kontrakt pozostałych plików
(nazwy eksportów, nazwy RemoteEventów), więc moduły faktycznie się dogadują.

---

## Obsługiwani dostawcy (własne klucze)

| Dostawca | Identyfikator | Protokół | Przykładowe modele |
| --- | --- | --- | --- |
| OpenAI | `openai` | chat/completions | `gpt-4.1`, `gpt-4.1-mini`, `gpt-4o`, `o4-mini` |
| Anthropic | `anthropic` | messages | `claude-sonnet-4-5`, `claude-opus-4-1` |
| Google | `google` | generateContent | `gemini-2.5-pro`, `gemini-2.5-flash` |
| OpenRouter | `openrouter` | chat/completions | dowolny model z katalogu |
| DeepSeek | `deepseek` | chat/completions | `deepseek-chat`, `deepseek-reasoner` |
| Groq | `groq` | chat/completions | `llama-3.3-70b-versatile` |
| Mistral | `mistral` | chat/completions | `mistral-large-latest` |
| xAI | `xai` | chat/completions | `grok-4`, `grok-3-mini` |
| Ollama (lokalnie) | `ollama` | chat/completions | `qwen2.5-coder:14b`, `llama3.1:8b` |
| Własny endpoint | `custom` | chat/completions | cokolwiek zgodnego z OpenAI API |

W UI jest przycisk **Testuj klucz** (jedno krótkie zapytanie) i **Pobierz modele** (lista modeli Twojego konta
w podpowiedziach pola „Model”).

### Dema offline (bez klucza, generowane lokalnie)

| Id | Gra | Co pokazuje |
| --- | --- | --- |
| `obby` | Neon Skyway Obby | checkpointy, monety, meta, sklep z ulepszeniami, procedurally budowana trasa |
| `td` | Neon Rush Tower Defense | 20 fal, 3 typy wież, ulepszenia, sprzedaż, pathing |
| `arena` | Neon Arena | 2 drużyny, rundy, respawn, broń hitscan, ranking zabójstw |
| `tycoon` | Neon Bakery Tycoon | 8 maszyn, dochód pasywny, działki per gracz, zapis w DataStore |
| `horror` | Blackout Ward | latarka z baterią, 3 generatory, potwór słyszący graczy, strach (blur + heartbeat) |

Każde demo to pełny projekt: 5-7 plików Luau, mapa, oświetlenie, HUD i eksport do Studia.

---

## CLI

```bash
# demo offline → katalog z pełnym projektem Rojo, ZIP-em, .rbxmx, .rbxlx i wtyczką
npm run demo:export
node server/cli.js --demo td --out examples/tower-defense
node server/cli.js --demo horror --formats plugin,rbxmx --out moja-gra

# własna gra z kluczem z env
OPENAI_API_KEY=sk-... node server/cli.js \
  --idea "symulator pszczół: zbieraj nektar, rozbudowuj ul, ranking graczy" \
  --provider openai --model gpt-4.1-mini --scale standard --out moja-gra

# lokalny model (bez klucza)
node server/cli.js --idea "arena pvp z 3 klasami" --provider ollama --model qwen2.5-coder:14b --out gra
```

Pełna lista flag: `node server/cli.js --help`.

---

## API HTTP (dla własnych integracji)

| Metoda | Endpoint | Opis |
| --- | --- | --- |
| GET | `/api/health` | status, wersja, liczba projektów i zadań |
| GET | `/api/providers` | lista dostawców i modeli |
| GET | `/api/demos` | lista dem offline |
| POST | `/api/demo` | `{id, save?}` → gotowy projekt demo |
| POST | `/api/generate` | `{idea, options, config}` → `{jobId, stream}` (zadanie w tle) |
| POST | `/api/refine` | `{projectId, project, instruction, config}` → `{jobId, stream}` |
| GET | `/api/jobs/:id` | stan zadania + postęp + zdarzenia (to odpytuje wtyczka Studio) |
| GET | `/api/jobs/:id/stream` | **SSE**: `open, stage, progress, warn, done, project, error, end` |
| POST | `/api/jobs/:id/cancel` | przerwanie zadania |
| GET | `/api/library` | lista projektów w bibliotece |
| GET | `/api/library/:id` | wczytanie projektu + walidacja |
| GET | `/api/versions/:id/:index` | konkretna wersja projektu (0 = najstarsza) |
| POST | `/api/library/:id/delete` | usunięcie projektu |
| POST | `/api/export` | `{project, format: zip\|rbxmx\|place\|plugin\|rojo, serverUrl?}` → plik do pobrania |
| GET | `/api/thumbnail?project=…&size=512` | proceduralna ikona gry (PNG) |
| POST | `/api/audit` | `{project}` → audyt całego projektu (ocena + lista sprawdzeń) |
| GET | `/api/projects/:id/diff?since=N` | zmienione pliki od rewizji N (live sync wtyczki) |
| GET | `/api/library/:id/versions` | historia wersji projektu |
| POST | `/api/library/:id/restore` | `{index}` → rollback (jako nowa wersja) |
| POST | `/api/library/:id/file` | `{path, content}` → edycja pojedynczego pliku |
| GET | `/api/assets?q=&kind=&genre=` | katalog darmowych assetów + starter dla gatunku |
| GET | `/api/assets/used?project=` | znaczniki `placeholder:` użyte w projekcie |
| GET | `/api/pricing?provider=&model=` | stawki i przykładowy koszt |
| POST | `/api/validate`, `/api/test`, `/api/models`, `/api/chat` | walidacja, test klucza, modele, surowy czat |

Przykład: wygeneruj grę i śledź postęp z konsoli

```bash
JOB=$(curl -s localhost:5173/api/generate -H 'content-type: application/json' \
      -d '{"idea":"horror w szkole","config":{"provider":"openai","apiKey":"sk-...","model":"gpt-4.1-mini"}}' \
      | python3 -c 'import sys,json;print(json.load(sys.stdin)["jobId"])')
curl -N localhost:5173/api/jobs/$JOB/stream     # strumień zdarzeń w czasie rzeczywistym
curl -s localhost:5173/api/jobs/$JOB | head -c 400
```

---

## Architektura repozytorium

```
server/
  index.js        serwer HTTP: UI, zadania, biblioteka, eksporty, ikony (zero zależności)
  jobs.js         kolejka zadań generate/refine + strumienie SSE dla wtyczki i UI
  audit.js        audyt całego projektu (plan vs kod, require, remotes, autorytet serwera)
  assets.js       katalog darmowych assetów + konwencja znaczników placeholder:<tag>
  pricing.js      cennik modeli, licznik kosztów i budżet (MAX_COST_USD)
  studioPaths.js  mapowanie plików Luau na instancje Studia (używane przez live sync)
  projects.js     biblioteka .projects/ z wersjonowaniem (5 wersji na projekt)
  pipeline.js     orkiestracja: design → world → plan → code → walidacja → auto-naprawa → refine
  providers.js    klienci LLM (3 protokoły, 10 dostawców, BYOK)
  prompts.js      zasady Luau, schemat świata, prompty etapów, kontrakt projektu, prompty naprawy i zmian
  validate.js     linter + sanity świata + statystyki
  png.js          enkoder PNG (zlib + CRC32, bez zależności)
  thumbnail.js    proceduralny rasteryzer ikon gier (palety per gatunek, font 5×7)
  zip.js          writer ZIP (store + deflate, UTF-8)
  rbxmx.js        eksport .rbxmx / .rbxlx i konfiguracja Rojo
  plugin.js       generator wtyczki Studio (osadza projekt + konfigurację)
  pluginRuntime.js  silnik i UI wtyczki w Luau: budowanie miejsca, refine, zaślepki, assety, ikona
  exporters.js    składanie artefaktów do pobrania
  util.js         slugi, XML, klasyfikacja właściwości, parser JSON-a z LLM
  games.js        rejestr dem offline
  demos/          obby.js, towerDefense.js, arena.js, tycoon.js, horror.js (pełne gry w Luau)
public/           interfejs webowy (bez frameworków): generator, czat zmian, biblioteka, ikony
tests/run.js      68 testów: zip, png, rbxmx, wtyczka, walidator, audyt, koszty, assety,
                  zadania, biblioteka, live sync (diff/rollback), strumieniowanie, HTTP, CLI
plugin/           miejsce na lokalnie zainstalowaną wtyczkę (Twoje pliki)
examples/         przykładowy wygenerowany projekt (Rojo + ZIP + .rbxmx + .plugin.luau)
.projects/        biblioteka projektów tworzona w runtime (poza repo)
```

---

## Testy

```bash
npm install   # tylko devDependency: luau-parser
npm test
```

CI: gotową konfigurację GitHub Actions znajdziesz w `.github/ci.yml.example`
(skopiuj do `.github/workflows/ci.yml`, jeśli chcesz uruchamiać testy na push/PR).

Testy nie wykonują żadnych połączeń sieciowych i nie potrzebują klucza API (strumieniowanie jest
testowane na lokalnych atrapach trzech protokołów SSE). Sprawdzają m.in. round-trip
ZIP-a, poprawność nagłówka i CRC ikony PNG, XML `.rbxmx`, escapowanie literałów Luau we wtyczce,
obecność panelu UI (refine, zaślepki, assety, ikona), kolejkę zadań i strumienie SSE, wersjonowanie
biblioteki, pełny przepływ HTTP oraz to, że **każdy plik Luau z dem i wygenerowana wtyczka przechodzą
prawdziwy parser Luau** (`luau-parser`). Bez devDependencies testy nadal przechodzą — pomijają tylko
kontrolę składni.

---

## Bezpieczeństwo i prywatność

* Klucz API trafia wyłącznie do wybranego dostawcy w nagłówku `Authorization`/`x-api-key`.
* Nic nie jest zapisywane do plików, logów ani wysyłane do autora projektu. Klucz **nie** jest osadzany
  w pliku wtyczki (chyba że sam go tam wpiszesz) — wtyczka zna tylko adres lokalnego buildera.
* Biblioteka projektów leży lokalnie w `.projects/`; katalog zmienisz zmienną `PROJECTS_DIR`.
* Serwer nasłuchuje na `0.0.0.0`, żeby działał w kontenerze/preview; w sieciach publicznych uruchamiaj go z `--host 127.0.0.1`.
* Wygenerowany kod nie ładuje żadnych assetów z Toolboxa ani `require(assetId)` — geometria, UI i efekty powstają proceduralnie,
  a wtyczka ma osobne narzędzie do wstawiania darmowych assetów, gdy sam ich chcesz.

---

## Ograniczenia (uczciwie)

* AI pisze gry z **prymitywów** (Part, GUI, dźwięki proceduralne) — nie wygeneruje customowych modeli 3D ani animacji R15 kręconych w Blenderze.
* Modele czasem się mylą: dlatego każde generowanie kończy walidator, auto-naprawa i (w razie potrzeby) refine. Zawsze przetestuj grę w Studio przed publikacją.
* Zmiany przez AI, live sync, historia wersji i podmiana assetów wymagają działającego `npm start` na tej samej maszynie co Studio i włączonego `Allow HTTP Requests`. Budowanie gry, skan zaślepków i ikona działają offline.
* Katalog assetów to publiczne, darmowe pozycje z biblioteki Robloxa — biblioteka się zmienia, więc wtyczka zawsze pokazuje, co wstawi, i nic nie robi bez kliknięcia. ID możesz podmienić w `server/assets.js`.
* Ceny w `server/pricing.js` to szacunek na podstawie publicznych cenników — jeśli Twój rachunek się różni, popraw tabelę (albo nie ustawiaj limitu).
* Wielkie projekty („epic”) kosztują więcej tokenów — to Twoje konto u dostawcy.
* `luau-parser` to zewnętrzna biblioteka tylko do testów (devDependency); runtime pozostaje bez zależności.

## Licencja

MIT — rób z tym, co chcesz, także komercyjnie. Wygenerowane gry należą do Ciebie.
