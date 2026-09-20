# Neon Skyway Obby

## Koncept
Neon Skyway Obby to klasyk gatunku obby w wersji "neonowej": ciemne tło, jaskrawe platformy, 
proceduralny tor, który za każdym razem wygląda inaczej (bo seed zmieniasz jednym numerem), ale jest sprawiedliwy – 
wszystkie skoki są do policzenia z parametrów ruchu gracza.

## Pętla rozgrywki
1. Gracz spawnuje się w lobby i widzi tablicę z zasadami.
2. Wchodzi na tor: skok, skok, ryzyko, śmierć lub postęp.
3. Checkpoint co 6 etapów daje satysfakcjonujące "zapisano".
4. Monety po drodze tworzą drugi, opcjonalny cel.
5. Meta daje 100 monet i wpis w leaderstats.

## Systemy
| System | Rola | Parametry |
| --- | --- | --- |
| LevelBuilder | Generuje tor z seeda | 26 platform, gap 9-18 |
| CheckpointService | Zapamiętuje etap gracza | co 6 platform |
| Lawa | Kara za błąd | Y-6 pod platformami |
| Monety | Waluta | 14 monet, respawn 12 s |
| Ruchome platformy | Timing | co 5 platform |

## Balans
Przy WalkSpeed 18 i JumpPower 52 gracz przeskakuje ~9-13 studsów w poziomie. Największa szczelina (18) 
jest celowo na granicy – wymaga rozpędu, ale nie jest niemożliwa. Wysokość zmienia się maksymalnie o 2 studs na skok.

## Mapa
Liniowy tor wzdłuż osi Z, lobby na Z=0, meta około Z=450. Boczny rozrzut +/-7 studsów daje wrażenie swobody 
bez gubienia gracza. Światło: popołudniowe (ClockTime 15) + cienie (ShadowMap).

## UI
HUD w lewym górnym rogu: etap. Prawy górny: monety i timer. Dolny środek: toasty (checkpoint, meta, monety). 
Całe UI generowane w kodzie – zero plików graficznych, zero problemów z moderacją assetów.

## Onboarding gracza
Tablica z 3 krokami ("Skacz", "Zbieraj monety", "Dotrzyj do mety"), spawn na wygodnej platformie 12x12, 
pierwsze 4 platformy są szerokie i płaskie, trudność rośnie dopiero od 5. etapu.

## Ryzyka
* Gracz utknie między platformami → przycisk R (reset) i checkpoint co 6 etapów.
* Zbyt duże szczeliny → wszystkie limity w Config: GapMin/GapMax do zmiany bez czytania logiki.
* Spadki FPS od lawy → lawa to proste Part-y z Materiałem Neon, bez cząstek na każdej platformie.
