# Neon Skyway Obby

Proceduralny tor parkour nad przepaścią z lawą. Każda platforma jest inna, część jeździ w bok, a każdy szósty etap to checkpoint, do którego wracasz po śmierci. Zbierasz monety i ścigasz się z czasem.

* Pliki Luau: **6**
* Gatunek: **Obby / Platformówka**
* Wygenerowano: 2026-09-20 (Roblox AI Game Builder)

---

## 1. Otwarcie w Roblox Studio (bez Rojo – najprościej)

1. W tym folderze znajdziesz plik `neon-skyway-obby.rbxmx` (jeśli użyłeś eksportu "Model .rbxmx").
2. Otwórz Roblox Studio → nowy Baseplate.
3. Przeciągnij plik `.rbxmx` do okna Studio (albo **Model → Import from file**).
4. Wszystkie skrypty i świat wylądują w odpowiednich usługach:
   * `Script` → ServerScriptService
   * `LocalScript` → StarterPlayer → StarterPlayerScripts
   * `ModuleScript` → ReplicatedStorage.Shared
5. Włącz **Game Settings → Security → Allow HTTP Requests** jeśli skrypty korzystają z HttpService.
6. Naciśnij **Play** (F5).

## 2. Otwarcie w Roblox Studio (Rojo – dla programistów)

```bash
# 1. Zainstaluj Rojo: https://rojo.space
aftman install   # lub: cargo install rojo
# 2. W tym folderze:
rojo serve
# 3. W Studio doinstaluj wtyczkę Rojo i kliknij "Connect".
```

Struktura katalogów pokrywa się z konfiguracją Rojo z `default.project.json`:

```
default.project.json
src/
  server/   -> ServerScriptService   (*.server.luau = Script, *.luau = ModuleScript)
  client/   -> StarterPlayerScripts  (*.client.luau = LocalScript)
  shared/   -> ReplicatedStorage.Shared (ModuleScript)
```

## 3. Szybka edycja w VS Code

1. `rojo serve` w tym folderze.
2. VS Code + rozszerzenie **Rojo** (lub **Luau LSP**) → *.luau ma podpowiedzi typów.
3. Zapisz plik → Studio dostaje zmianę natychmiast.

## 4. Checklist przed publikacją

- [ ] Sprawdź czy nie ma `print` debugowych (Ctrl+Shift+F: `print(`).
- [ ] Ustaw `Workspace.FilteringEnabled = true` (jest w `default.project.json`).
- [ ] Sprawdź `StarterGui.ResetPlayerGuiOnSpawn`, `Workspace.StreamingEnabled`.
- [ ] Przetestuj w trybie **Play → Server & Clients** (testy anty-exploitowe).
- [ ] Dodaj własne ikony, dźwięki i animacje (AI generuje geometrię z prymitywów).
- [ ] Uzupełnij ustawienia miejsca: **Game Settings → Avatar → Rig Type**, wiek odbiorcy.

## Notatki wygenerowane przez model

- Tor buduje się proceduralnie z seeda Config.Seed – zmiana liczby = nowy level, bez rysowania w Studio.
- Checkpointy to SpawnLocation-y ustawiane jako player.RespawnLocation, więc respawn działa "z pudelka" i jest po stronie serwera.
- Całe UI powstaje w kodzie, więc projekt nie zależy od żadnego assetu z Toolboxa.
