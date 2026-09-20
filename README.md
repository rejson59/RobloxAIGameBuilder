# Roblox AI Game Builder

**Build games on Roblox Studio using your own API keys.**

Opisujesz grę po polsku (albo w dowolnym języku) → aplikacja prowadzi rozmowę z modelem AI
(OpenAI, Claude, Gemini, OpenRouter, DeepSeek, Groq, Mistral, xAI, Ollama…) i produkuje **kompletny,
grywalny projekt Roblox**: design, szkielet mapy, dziesiątki linii kodu Luau i eksport jednym kliknięciem
do Roblox Studio.

* **Zero zależności** w runtime — czysty Node.js (>=18), jeden `npm start`.
* **Własne klucze (BYOK)** — klucz nie opuszcza Twojej maszyny, nie jest nigdzie zapisywany.
* **Tryb demo bez klucza** — trzy gotowe gry (Obby, Tower Defense, Arena PvP) generowane w całości lokalnie.
* **Trzy drogi do Studia**: plik `.rbxmx` (przeciągnij i upuść), wtyczka Studio z wbudowaną grą (jeden przycisk), projekt Rojo (dla programistów).
* **Walidator jakości** — sprawdza przestarzałe API, placeholdery, brakujące `return`, spójność świata i **kompiluje każdy plik Luau prawdziwym parserem Luau** w testach.

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

> Klucz API trzymany jest wyłącznie w pamięci serwera tej sesji i wysyłany tylko do wybranego dostawcy.

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
     └─ 5. WALIDACJA   → linter + parser Luau + sanity świata → projekt + ostrzeżenia
```

Kod jest generowany **paczkami**, a nie jednym wielkim zapytaniem, dlatego projekty mają 7-18 plików
i nie urywają się w połowie z powodu limitu tokenów. Każda paczka widzi kontrakt pozostałych plików
(nazwy eksportów, nazwy RemoteEventów), więc moduły faktycznie się dogadują.

---

## Obsługiwani dostawcy (własne klucze)

| Dostawca | Identyfikator | Protokół | Przykładowe modele |
| --- | --- | --- | --- |
| OpenAI | `openai` | chat/completions | `gpt-4.1`, `gpt-4.1-mini`, `gpt-4o`, `o4-mini` |
| Anthropic | `anthropic` | messages | `claude-sonnet-4-5`, `claude-opus-4-1` |
| Google | `google` | generateContent | `gemini-2.5-pro`, `gemini-2.5-flash` |
| OpenRouter | `openrouter` | chat/completions | `anthropic/claude-sonnet-4.5`, `qwen/qwen3-coder` |
| DeepSeek | `deepseek` | chat/completions | `deepseek-chat`, `deepseek-reasoner` |
| Groq | `groq` | chat/completions | `llama-3.3-70b-versatile` |
| Mistral | `mistral` | chat/completions | `mistral-large-latest`, `codestral-latest` |
| xAI | `xai` | chat/completions | `grok-4`, `grok-3-mini` |
| Ollama (lokalnie) | `ollama` | chat/completions | `qwen2.5-coder:14b`, `llama3.1:8b` |
| Dowolny endpoint | `custom` | chat/completions | LM Studio, vLLM, własna brama |

Nazwy modeli zmieniają się co kilka tygodni — pole modelu jest edytowalne, a przycisk
**Pobierz modele** uzupełnia listę bezpośrednio od dostawcy. Wymagania: model musi umieć pisać kod
i zwracać JSON (wszystkie powyższe potrafią). **Rekomendacja na start:** `gpt-4.1-mini`,
`claude-sonnet-4-5`, `gemini-2.5-flash` lub lokalnie `qwen2.5-coder:14b`.

---

## Jak uruchomić wygenerowaną grę w Roblox Studio

### A. `.rbxmx` — najprościej (30 sekund)

1. Pobierz plik `nazwa-gry.rbxmx`.
2. Roblox Studio → **New → Baseplate**.
3. Przeciągnij plik `.rbxmx` do okna Studio (albo **Model → Import from file**).
4. Naciśnij **Play** (F5).

Skrypty lądują automatycznie w odpowiednich usługach: `Script` → ServerScriptService,
`LocalScript` → StarterPlayerScripts, `ModuleScript` → ReplicatedStorage.Shared, a mapa w Workspace.

### B. Wtyczka Studio z wbudowaną grą — jeden przycisk

1. Pobierz plik `nazwa-gry.plugin.luau`.
2. Studio → **Plugins → Plugins Folder** (otworzy folder).
3. Skopiuj tam plik i zrestartuj Studio.
4. Na pasku wtyczek pojawi się **Roblox AI Game Builder → Buduj grę**. Gra (i mapa, i skrypty) zbuduje się w otwartym miejscu, z wpisem w historii zmian (Ctrl+Z cofa).

### C. Rojo — dla programistów

```bash
# pobierz ZIP i rozpakuj, następnie:
aftman install        # albo: cargo install rojo
rojo serve            # w Studio: wtyczka Rojo → Connect
```

ZIP zawiera `default.project.json`, `README.md`, `docs/DESIGN.md`, `docs/ARCHITECTURE.md`,
`docs/world.json` oraz `ai-builder.json` (pozwala wrócić do projektu w aplikacji — przycisk
„Wczytaj projekt”).

---

## CLI

```bash
# demo offline → katalog z pełnym projektem Rojo, ZIP-em, .rbxmx i wtyczką
npm run demo:export
node server/cli.js --demo td --out examples/tower-defense

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
| GET | `/api/health` | status i wersja |
| GET | `/api/providers` | lista dostawców i modeli |
| GET | `/api/demos` | lista dem offline |
| POST | `/api/demo` | `{id}` → gotowy projekt demo |
| POST | `/api/generate` | **SSE**: `{idea, options, config}` → strumień postępu + zdarzenie `project` |
| POST | `/api/jobs/:id/cancel` | przerwanie generowania |
| POST | `/api/export` | `{project, format: zip\|rbxmx\|plugin\|rojo}` → plik do pobrania |
| POST | `/api/validate` | `{project}` → raport walidatora |
| POST | `/api/test`, `/api/models` | test klucza i lista modeli dostawcy |

---

## Architektura repozytorium

```
server/
  index.js        serwer HTTP + SSE (zero zależności)
  cli.js          interfejs wiersza poleceń
  pipeline.js     orkiestracja: design → world → plan → code → walidacja
  providers.js    klienci LLM (3 protokoły, 10 dostawców, BYOK)
  prompts.js      zasady Luau, schemat świata, prompty etapów
  validate.js     linter + sanity świata + statystyki
  zip.js          writer ZIP (store + deflate, UTF-8)
  rbxmx.js        eksport .rbxmx i konfiguracja Rojo
  plugin.js       generator wtyczki Studio z wbudowaną grą
  exporters.js    składanie artefaktów do pobrania
  util.js         slugi, XML, klasyfikacja właściwości, parser JSON-a z LLM
  games.js        rejestr dem offline
  demos/          obby.js, towerDefense.js, arena.js (pełne gry w Luau)
public/           interfejs webowy (bez frameworków)
tests/run.js      36 testów: zip, rbxmx, wtyczka, walidator, dema, HTTP, CLI
plugin/           miejsce na lokalnie zainstalowaną wtyczkę (Twoje pliki)
examples/         przykładowy wygenerowany projekt (Rojo + .rbxmx + wtyczka)
```

---

## Testy

```bash
npm install   # tylko devDependency: luau-parser
npm test
```

CI: gotową konfigurację GitHub Actions znajdziesz w `.github/ci.yml.example`
(skopiuj do `.github/workflows/ci.yml`, jeśli chcesz uruchamiać testy na push/PR).

Testy nie wykonują żadnych połączeń sieciowych i nie potrzebują klucza API. Sprawdzają m.in. round-trip
ZIP-a, poprawność XML-a `.rbxmx`, escapowanie literałów Luau we wtyczce, wykrywanie placeholderów,
pełny przepływ HTTP oraz to, że **każdy plik Luau z dem i wygenerowana wtyczka przechodzą prawdziwy parser Luau**
(`luau-parser`). Bez devDependencies testy nadal przechodzą — pomijają tylko kontrolę składni.

---

## Bezpieczeństwo i prywatność

* Klucz API trafia wyłącznie do wybranego dostawcy w nagłówku `Authorization`/`x-api-key`.
* Nic nie jest zapisywane do plików, logów, localStorage ani wysyłane do autora projektu.
* Serwer nasłuchuje na `0.0.0.0`, żeby działał w kontenerze/preview; w sieciach publicznych uruchamiaj go z `--host 127.0.0.1`.
* Wygenerowany kod nie ładuje żadnych assetów z Toolboxa ani `require(assetId)` — geometria, UI i efekty powstają proceduralnie.

---

## Ograniczenia (uczciwie)

* AI pisze gry z **prymitywów** (Part, GUI, dźwięki proceduralne) — nie wygeneruje customowych modeli 3D ani animacji R15 kręconych w Blenderze.
* Modele czasem się mylą: dlatego każde generowanie kończy walidator, a w UI widać ostrzeżenia. Zawsze przetestuj grę w Studio przed publikacją.
* Wielkie projekty („epic”) kosztują więcej tokenów — to Twoje konto u dostawcy.
* `luau-parser` to zewnętrzna biblioteka tylko do testów (devDependency); runtime pozostaje bez zależności.

## Licencja

MIT — rób z tym, co chcesz, także komercyjnie. Wygenerowane gry należą do Ciebie.
