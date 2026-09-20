# Folder wtyczki Roblox Studio

Tu wrzucasz pobrane wtyczki `*.plugin.luau` (albo kopiujesz je bezpośrednio
do folderu wtyczek Roblox Studio: **Plugins → Plugins Folder**).

## Szybka instrukcja

1. W aplikacji (`npm start` → http://localhost:5173) wygeneruj grę albo kliknij demo.
2. Zakładka **Wtyczka Studio** → **Pobierz .plugin.luau**.
3. Roblox Studio → **Plugins → Plugins Folder** → skopiuj plik do otwartego folderu.
4. Zrestartuj Studio. Na pasku pojawi się **Roblox AI Game Builder**.

## Co ma wtyczka

| Element | Działanie |
| --- | --- |
| **Buduj grę** | Buduje mapę i skrypty w otwartym miejscu (Ctrl+Z cofa, całość w ChangeHistoryService). |
| **AI Builder** (panel) | Zmiany przez AI: opisujesz zmianę, wtyczka wysyła projekt do lokalnego buildera i przebudowuje miejsce. Pasek postępu, przycisk „Przerwij”. |
| **Zaślepki assetów** | Znajduje Decal/Sound/MeshId/ImageLabel bez wartości i pokazuje ich ścieżki; klik zaznacza instancję. |
| **Darmowe assety** | Wstawia gotowe dźwięki i tekstury z biblioteki Robloxa (do podmiany jednym kliknięciem). |
| **Ikona gry** | Pobiera proceduralną ikonę PNG 512×512 i zapisuje ją w folderze wtyczek. |
| **Live sync** | Pilnuje rewizji projektu i podmienia w miejscu TYLKO zmienione skrypty (~2,5 s po zapisie w aplikacji). |
| **Napraw błędy z Play** | Zbiera błędy runtime z `LogService` podczas Twojego testu i wysyła je do modelu jako zadanie naprawcze. |
| **Podmień znaczniki placeholder:…** | Skanuje `placeholder:coin`, `placeholder:neon_grid` itd. i wstawia darmowe assety z katalogu. |
| **Historia wersji** | Lista wersji projektu z „Przywróć” — cofa nieudaną zmianę i przebudowuje miejsce. |

## Wymagania dla funkcji AI

* Lokalny builder uruchomiony na tej samej maszynie: `npm start` (domyślnie `http://127.0.0.1:5173`).
* W Studiu: **Game Settings → Security → Allow HTTP Requests**.
* Klucz API podajesz w aplikacji webowej — wtyczka nie przechowuje kluczy.

Budowanie gry, zaślepki, darmowe assety i ikona działają **bez** żadnego połączenia sieciowego
(cała gra jest osadzona w pliku wtyczki).

Adres serwera możesz zmienić w kodzie wtyczki: linia `local PROJECT_CONFIG = { serverUrl = "..." }`.
