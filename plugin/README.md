# Katalog wtyczek Studio

Tu możesz wrzucać wygenerowane wtyczki (pliki `*.plugin.luau`), żeby mieć je w jednym miejscu
razem z repozytorium.

## Instalacja w Roblox Studio

1. W aplikacji kliknij **Pobierz wtyczkę** (albo w CLI: plik `nazwa-gry.plugin.luau`).
2. W Roblox Studio: **Plugins → Plugins Folder** — Studio otworzy folder wtyczek systemu.
3. Skopiuj plik `.plugin.luau` do tego folderu.
4. Zrestartuj Studio (albo **Plugins → Manage Plugins** i włącz wtyczkę).
5. Na pasku narzędzi pojawi się **Roblox AI Game Builder** → **Buduj grę**.

Wtyczka nie łączy się z internetem: cała gra (kod Luau + drzewo świata) jest osadzona w pliku.
Kliknięcie „Buduj grę" tworzy folder gry w Workspace, umieszcza skrypty w ServerScriptService /
StarterPlayerScripts / ReplicatedStorage.Shared i zapisuje operację w historii zmian (Ctrl+Z cofa).
