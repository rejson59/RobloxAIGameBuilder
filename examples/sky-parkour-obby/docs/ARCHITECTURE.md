# Architektura

Serwer jest autorytetem: buduje tor (LevelBuilder), pilnuje postępu (CheckpointService), trzyma walutę i leaderstats (Stats).
Klient (HUD, Effects) nie modyfikuje stanu gry – wysyła tylko prośbę o reset przez RemoteEvent "Reset".
Serwer wysyła komunikaty UI przez RemoteEvent "Notify" (tekst + kolor), które HUD pokazuje jako toast.
Config w ReplicatedStorage.Shared jest wspólny: te same kolory, te same nazwy remotów po obu stronach.
