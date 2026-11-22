# Live MiLB Scores: Stream Deck Plugin

![Live MiLB Scores in action](assets/LiveMiLBScoresThumbnail.png)

A Stream Deck plugin that shows live Minor League Baseball scores directly on your keys. Each key tracks one team and updates automatically every 30 seconds. Covers Triple-A through Single-A, the Arizona Fall League, and the winter leagues in Mexico, Venezuela, the Dominican Republic, Puerto Rico, and Australia, plus the Caribbean Series.

![Live MiLB Scores Plugin](https://img.shields.io/badge/Stream%20Deck-Plugin-blue) ![Version](https://img.shields.io/badge/version-1.0.39.2-green) [![Elgato Marketplace](https://img.shields.io/badge/Elgato-Marketplace-black)](https://marketplace.elgato.com/product/live-milb-scores-c8a87c49-0980-4d7a-b8a4-b93334414733)

---

## Features

- **Live scores:** shows away score, home score, and current inning while a game is in progress
- **Fall and winter ball:** follow Arizona Fall League clubs and teams in the Mexican Pacific League (LMP), the Venezuelan winter league (LVBP), the Dominican winter league (LIDOM), the Puerto Rican winter league (LBPRC), the Australian Baseball League (ABL), and the Caribbean Series, with the same live scores, run cards, and fireworks
- **Pregame:** the two teams stacked (`CLT` over `@ JAX`) and the start time; on off days, your team's next game with its day and time
- **Final scores:** shows the final score with a "Final" label
- **Score-change flash:** when your team scores, the key blinks in its MLB parent organization's color (gray when the opponent scores), then shows a short card with the scoring team and how many runs scored (e.g. SWB / +2 RUNS)
- **Browser shortcut:** press any key to open that game on MiLB Gameday, MiLB.TV, or a custom link of your choice (e.g. your regional sports network); switches to Gameday automatically 30 minutes after the final out
- **Doubleheader support:** automatically shows the first game, then switches to the second when it ends; the G1/G2 label keeps you oriented
- **Doubleheader toggle:** double-click a doubleheader key to peek at the other game; auto-reverts after 15 seconds
- **No-flicker updates:** keys only redraw when the display actually changes
- **Multi-key support:** add as many team keys as you want, each refreshes independently
- **Always up-to-date team list:** teams are loaded live from the MiLB API, so affiliate changes between seasons are reflected automatically
- **Search:** type a team, city, or mascot name to jump straight to it instead of drilling through League/Organization dropdowns
- **Next game on off days:** instead of a dead-end "No Game", the key shows your team's next scheduled game with its day and time
- **Custom key background color:** pick your own background color and opacity instead of the default black

![Custom key background colors](assets/LiveMiLBScoresCustomBackgroundColors.png)
*The Braves (left, Live MLB Scores) alongside four of their affiliates (Live MiLB Scores), each with its own custom key background color.*

---

## Recent Updates

**v1.0.39.2**
- Australian Baseball League streams: the stream option now opens the game on MLB.TV, and ABL teams get a second choice, **Baseball+**, the league's own streaming site (some games are free, the rest need an ABL or team pass). Both open that game's own stream page once it starts

**v1.0.39.1**
- Australian Baseball League keys now follow Sydney time. The day turns over at 5:00 AM in Sydney (about 1:00 PM Eastern), so the morning's finals stay up through the US morning, then the keys show that night's games with their start times instead of waiting until they go live. Every other league still rolls over at 5:00 AM Eastern

**v1.0.39.0**
- New: three more winter leagues — the Puerto Rican league (LBPRC), the Australian Baseball League (ABL) and the Caribbean Series. Pick Winter Leagues in the Level dropdown, or just search a team (e.g. Santurce, Perth, Dominican Republic). Live scores, run cards and fireworks work the same as the other winter leagues
- No stream link yet for the Puerto Rican league, the Australian Baseball League or the Caribbean Series: for those teams the stream option is greyed out with a note, and the key opens Gameday (Custom Link still works)
- The amber "not live" dot now shows only on keys whose own team's data is stale, instead of on every key when any one feed hiccups

## Requirements

- [Elgato Stream Deck](https://www.elgato.com/stream-deck) hardware
- [Stream Deck software](https://www.elgato.com/downloads) version 7.1 or later (Mac or Windows)
- No account required to view scores; the plugin uses MLB/MiLB's free public stats API
- A MiLB.TV subscription is required only if you choose the MiLB.TV link option; Gameday is free

---

## Installation

**Elgato Marketplace (recommended)**

1. Open **[Live MiLB Scores on the Elgato Marketplace](https://marketplace.elgato.com/product/live-milb-scores-c8a87c49-0980-4d7a-b8a4-b93334414733)** and install it from there
2. The plugin will appear in the Stream Deck action picker under **Live MiLB Scores**

**Manual install**

1. Download the latest **`Live MiLB Scores.streamDeckPlugin`** from the [Releases](../../releases) page
2. Double-click the file, and Stream Deck will install it automatically

---

## Setup

1. Drag the **Live MiLB Scores** action onto any key
2. In the settings panel on the right, either type your team into the **Search** box for autocomplete, or browse for it manually:

**Browse by League:** drill down by level, then league, then team:

| Level | Leagues |
|-------|---------|
| Triple-A | International League, Pacific Coast League |
| Double-A | Eastern League, Southern League, Texas League |
| High-A | Midwest League, Northwest League, South Atlantic League |
| Single-A | California League, Carolina League, Florida State League |
| Arizona Fall League | Arizona Fall League (October–November) |
| Winter Leagues | Mexican Pacific League (LMP), Venezuelan winter league (LVBP), Dominican winter league (LIDOM), Puerto Rican winter league (LBPRC), Australian Baseball League (ABL), Caribbean Series (October–February) |

![Browse by League](assets/LiveMiLBScoresSettingsSelectByLeague.png)

**Browse by MLB Organization:** pick an MLB parent club to see all of their affiliates grouped by level. (Arizona Fall League and winter league clubs aren't tied to a single MLB organization, so they're only under Browse by League and search.)

![Browse by MLB Organization](assets/LiveMiLBScoresSettingsSelectByOrg.png)

3. Choose what happens when you press the key:
   - **MiLB Gameday (free):** opens the game's Gameday page on MiLB.com (winter league teams open the game on MLB.com Gameday)
   - **MiLB.TV (subscription):** opens the live stream page on MiLB.com
     (for Arizona Fall League teams this option reads **AFL Live Stream (free on MLB.com)** and opens that game's free stream on MLB.com, or the AFL live-streams page if the stream isn't up yet; for Mexican, Dominican and Australian winter league teams it opens the game's MLB.TV stream once it starts; Venezuelan, Puerto Rican and Caribbean Series games have no stream link, so that option is greyed out for those teams)
   - **Baseball+ (subscription):** Australian Baseball League teams only. Opens the game's page on Baseball+, the league's streaming site, once it starts (some games are free, the rest need an ABL or team pass)
   - **Custom Link:** opens any URL you enter, such as your regional sports network's live-game page

That's it. The key will load your team's game within a few seconds and refresh every 30 seconds from there.

> **Note:** If MiLB.TV or Custom Link is selected but the game hasn't started yet, pressing the key opens Gameday instead. A Custom Link with no URL entered behaves the same way. After the final out, the key continues opening MiLB.TV or your custom link for 30 minutes to cover postgame coverage, then automatically switches to Gameday.

---

## What the Key Shows

![Live score key](assets/LiveMiLBScoresButtonStates.png)

**Before the game:**
```
CLT
@ JAX
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

**Off day** (your team's next game: the weekday, or the date when it's a week or more away):
```
CLT
@ JAX
Thursday
7:05 PM
```

---

## How It Works

The plugin polls [MLB's free public Stats API](https://statsapi.mlb.com) once every 30 seconds per key using sport IDs for all four MiLB levels (Triple-A through Single-A), the Arizona Fall League, the Mexican, Venezuelan, Dominican, Puerto Rican, and Australian winter leagues, and the Caribbean Series. No API key or account is required. The day rolls over at 5:00 AM Eastern, so late games and their finals stay on your keys overnight; Australian Baseball League keys use Sydney time instead (5:00 AM there, about 1:00 PM Eastern), since the ABL dates its games by the Australian date. The plugin is fully self-contained: it uses only Node.js built-in modules and requires no external dependencies.

---

## Uninstalling

Open Stream Deck → Preferences → Plugins, select **Live MiLB Scores**, and click the **−** key.

---

## Contributing

Bug reports and feature requests are welcome. Open an [Issue](../../issues) to get started.

---

## Disclaimer

This plugin is not affiliated with, endorsed by, or sponsored by Major League Baseball or MLB Advanced Media, L.P. All data is sourced from the MLB Stats API and is subject to MLBAM's terms of use. This plugin is intended for individual, personal, non-commercial use only.

---

## Credits

Created by **T.J. Lauerman aka ThatSportsGamer**

Created with Claude Cowork by Anthropic

Data provided by the [MLB Stats API](https://statsapi.mlb.com)
