--[[
	Config – wszystkie liczby balansu w jednym miejscu.
	Zmiana tutaj wpływa na całą grę, dlatego trzymamy je z dala od logiki.
]]
local Config = {}

Config.Seed = 20240920          -- stały seed = powtarzalny level (łatwe testowanie)
Config.PlatformCount = 26       -- ile platform ma mieć wieża
Config.PlatformMinSize = 5
Config.PlatformMaxSize = 12
Config.GapMin = 9
Config.GapMax = 18
Config.LateralSpread = 7        -- na ile studsów platforma może odjechać w bok
Config.HeightStep = 2           -- maksymalna zmiana wysokości między platformami
Config.StartPoint = Vector3.new(0, 10, 60)
Config.CheckpointEvery = 6
Config.MovingEvery = 5
Config.MovingSpeed = 0.35       -- sekundy na 1 stud ruchu platformy
Config.CoinCount = 14
Config.LavaDrop = 6             -- jak nisko pod platformami jest lawa
Config.WalkSpeed = 18
Config.JumpPower = 52

Config.Colors = {
	Platform = "#4FC3F7",
	PlatformAlt = "#7E57C2",
	Lava = "#FF3B30",
	Checkpoint = "#FFD54F",
	CheckpointDone = "#66BB6A",
	Finish = "#00E5A0",
	Coin = "#FFC400",
	Lobby = "#2B2F45",
}

-- Nazwy RemoteEventów – muszą być identyczne po stronie klienta i serwera.
Config.Remotes = {
	Notify = "Notify",      -- serwer -> klient: komunikat UI
	Reset = "Reset",        -- klient -> serwer: poproszenie o respawn
}

Config.LevelFolderName = "GeneratedLevel"

return Config
