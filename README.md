# Live MiLB Scores — Stream Deck Plugin

<img src="screenshots/LIVE_MiLB_SCORES.png" width=250 height=250>


A Stream Deck plugin that shows live Minor League Baseball scores directly on your buttons. Each button tracks one team and updates automatically every 30 seconds.

![Live MLB Scores Plugin](https://img.shields.io/badge/Stream%20Deck-Plugin-blue) ![Version](https://img.shields.io/badge/version-1.0.1-green)

---

## Features

- **Live scores** — shows away score, home score, and current inning while a game is in progress
- **Pre-game** — shows the matchup (e.g. `CLT @ JAX`) and scheduled start time
- **Final scores** — shows the final score with a "Final" label
- **Score-change flash** — when your team scores, the button flashes in that team's MLB parent organization's color
- **Browser shortcut** — press any button to open that game on MiLB Gameday or MiLB Live Stream
- **No-flicker updates** — buttons only redraw when the display actually changes
- **Multi-button support** — add as many team buttons as you want, each refreshes independently
- **Always up-to-date team list** — teams are loaded live from the MiLB API, so affiliate changes between seasons are reflected automatically

---

## Recent Updates

**v1.0.1**
- Added custom icons

---

## Requirements

- [Elgato Stream Deck](https://www.elgato.com/stream-deck) hardware
- [Stream Deck software](https://www.elgato.com/downloads) version 6.0 or later (Mac or Windows)
- No account required for scores — the plugin uses MLB/MiLB's free public stats API

---

## Installation

1. Download the latest **`Live MiLB Scores.streamDeckPlugin`** from the [Releases](../../releases) page
2. Double-click the file — Stream Deck will install it automatically
3. The plugin will appear in the Stream Deck action picker under **Live MiLB Scores**

---

## Setup

1. Drag the **Live MiLB Scores** action onto any button
2. In the settings panel on the right, pick how you want to browse for your team:

**Browse by League** — drill down by level, then league, then team:

| Level | Leagues |
|-------|---------|
| Triple-A | International League, Pacific Coast League |
| Double-A | Eastern League, Southern League, Texas League |
| High-A | Midwest League, Northwest League, South Atlantic League |
| Single-A | California League, Carolina League, Florida State League |

![Browse by League](screenshots/LiveMiLBScoresSettingsSelectByLeague.png)

**Browse by MLB Organization** — pick an MLB parent club to see all of their affiliates grouped by level.

![Browse by MLB Organization](screenshots/LiveMiLBScoresSettingsSelectByOrg.png)

3. Choose what happens when you press the button:
   - **MiLB Gameday (free)** — opens the game's Gameday page on MiLB.com
   - **MiLB Live Stream (subscription)** — opens the live stream page on MiLB.com

That's it. The button will load your team's game within a few seconds and refresh every 30 seconds from there.

---

## What the Button Shows

**Before the game:**
```
CLT @ JAX
 7:05 PM
```

**Live game:**
```
CLT 3
JAX 1
 ▲5
```

**Final score:**
```
CLT 3
JAX 1
Final
```

**Off day:**
```
 CLT
No Game
```

---

## Supported Teams

All four levels of affiliated Minor League Baseball are supported — 120 teams across 12 leagues. The team list is fetched live from the MiLB API each time you open the settings panel, so it stays accurate as affiliates change from season to season.

| Level | Leagues |
|-------|---------|
| Triple-A | International League · Pacific Coast League |
| Double-A | Eastern League · Southern League · Texas League |
| High-A | Midwest League · Northwest League · South Atlantic League |
| Single-A | California League · Carolina League · Florida State League |

---

## How It Works

The plugin polls [MLB's free public Stats API](https://statsapi.mlb.com) once every 30 seconds per button using sport IDs for all four MiLB levels (Triple-A through Single-A). No API key or account is required. The plugin is fully self-contained — it uses only Node.js built-in modules and requires no external dependencies.

---

## Uninstalling

Open Stream Deck → Preferences → Plugins, select **Live MiLB Scores**, and click the **−** button.

---

## Contributing

Bug reports and feature requests are welcome — open an [Issue](../../issues) to get started.

---

## Credits

Created by **T.J. Lauerman aka ThatSportsGamer**

Created with Claude Cowork by Anthropic

Data provided by the [MLB Stats API](https://statsapi.mlb.com)
