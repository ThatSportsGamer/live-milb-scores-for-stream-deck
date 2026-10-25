# Changelog

Full version history for Live MiLB Scores, newest first. The [README](README.md) lists the three most recent updates.

**v1.0.39.0**
- New: three more winter leagues — the Puerto Rican league (LBPRC), the Australian Baseball League (ABL) and the Caribbean Series. Pick Winter Leagues in the Level dropdown, or just search a team (e.g. Santurce, Perth, Dominican Republic). Live scores, run cards and fireworks work the same as the other winter leagues
- Puerto Rican games open the game's own MLB.TV stream once it starts, like the Mexican and Dominican leagues. Australian and Caribbean Series games aren't streamed on MLB.TV, so for those teams the stream option is greyed out with a note, and the key opens Gameday (Custom Link still works)
- The amber "not live" dot now shows only on keys whose own team's data is stale, instead of on every key when any one feed hiccups

**v1.0.38.0**
- Fixed: "today" is now read in Eastern time, which is how MLB dates its schedule. Outside the US the keys could ask for tomorrow's slate while tonight's games were still on. The day now changes at 5:00 AM Eastern (2:00 AM Pacific), so late games and their finals stay on the keys overnight everywhere
- If MLB's data stops responding for a moment, keys keep showing the last scores with a small amber dot instead of "Err" (after 10 minutes without an update they show "Err")

**v1.0.37.0**
- New: winter leagues — follow any team in the Mexican Pacific League (LMP), the Venezuelan league (LVBP) or the Dominican league (LIDOM). Pick Winter Leagues in the Level dropdown, or just search a team (e.g. Culiacan, Leones). Live scores, run cards and fireworks work the same as the AFL
- Winter league keys open the game on MLB.com Gameday; the stream option opens the game's own MLB.TV stream once it starts (LMP and LIDOM games; if the stream can't be found, MLB.TV's featured games list). Venezuelan games aren't on MLB.TV, so for those teams the stream option is greyed out with a note, and the key opens Gameday (Custom Link still works)
- Now runs on Node.js 24 and needs Stream Deck 7.1 or later (Elgato is retiring Node.js 20)

**v1.0.36.0**
- Pregame keys match the NFL, CFB, NHL and NBA plugins: the teams stack on two lines (away team on top, "@ home" below, with a small "@"), then the start time. On game day it's just the teams and the time; for a later day the day gets its own gray line above the time
- Off-day keys show your team's next game the same way: the "Next Game" label is gone, and the day line reads the weekday ("Thursday"), or the date when it's a week or more away
- Doubleheaders put the game number on the day line ("Game 2")
- Postponed, canceled, suspended, delayed and warmup keys use the same stacked teams

**v1.0.35.0**
- Score flash is now 5 solid blinks of the scoring color with no text, so it reads at a glance even on light team colors
- New: right after the flash, a 3-second card shows the scoring team and how many runs scored (e.g. ATL / +2 RUNS), then the score returns
- Settings help text now says "key" instead of "button"

**v1.0.34.0**
- Arizona Fall League keys set to "AFL Live Stream" now open that game's own stream on MLB.com once it starts, instead of the league's live-streams page. If the game's stream isn't posted yet (or can't be found), the key falls back to the live-streams page

**v1.0.33.0**
- Added the Arizona Fall League — follow any of its six clubs (Desert Dogs, Javelinas, Rafters, Saguaros, Scorpions, Solar Sox), playoffs and Championship Game included. Find them by search or under Level → Arizona Fall League
- AFL clubs draw players from several MLB organizations, so they don't appear under Browse by MLB Organization
- For AFL teams the stream option becomes "AFL Live Stream (free on MLB.com)" and opens MLB.com's AFL live-streams page (AFL games aren't on MiLB.tv)
- Picking a level with only one league (the AFL) now skips the League dropdown
- Search results are now ordered by level — Triple-A, Double-A, High-A, Single-A, then AFL — instead of alphabetically, so searching "Braves" lists Gwinnett → Columbus → Rome → Augusta

**v1.0.32.0**
- Rained-out games that the league cancels outright now show CANC instead of a 0-0 "Final" (doubleheaders included)

**v1.0.31.0**
- Added a high-resolution (2x) plugin icon so it stays sharp on Retina/high-DPI displays
- Settings panel's Custom Link hint now mentions the link stays active for 30 minutes after the final out, then reverts to Gameday
- Custom Link URLs are also tidied up by the plugin itself (spaces trimmed, https:// added if missing, non-web links ignored) — a backstop for links saved before the settings panel started doing this
- Turned off Node debug mode for release builds

**v1.0.30.0**
- Added a "Custom Link" option to Key Press Opens — enter any URL (e.g. your regional sports network's live-game page) and the key opens Gameday until the game actually starts, then switches to your link. Falls back to Gameday if the field is left blank. The URL field also auto-adds `https://` if you leave the scheme off

**v1.0.29.0**
- Added a custom key background color option (matching Live NFL Scores and Live CFB Scores) — pick a color and opacity in the settings panel instead of the default black

**v1.0.28.0**
- Fixed: pressing a key set to MiLB.tv during the Warmup state (right before first pitch, including right after a rain delay clears) fell back to Gameday instead of opening the stream — MiLB.tv already carries Warmup as pre-game coverage, so it now opens directly

**v1.0.27.0**
- Coming out of a rain delay, the key now shows `WARMUP` alongside the original scheduled time instead of just re-displaying that now-stale clock as if nothing happened

**v1.0.26.0**
- Added a search box to the settings panel (ported from Live CFB Scores) — type a team, city, or mascot name for autocomplete instead of drilling through the League/Organization dropdowns. Picking a result still syncs the dropdowns underneath, so both paths stay in sync
- Search results show each team's level (AAA/AA/A+/A) as a small badge on the right, matching the layout used in Live NHL Scores' search box
- That badge also shows the MLB parent org's abbreviation (e.g. "AAA · ATL")
- Search now also matches on the MLB parent org's name — searching "Braves" surfaces every Atlanta affiliate across all four levels, not just teams whose own name contains "Braves"

**v1.0.25.0**
- Fixed: a mid-game rain delay could link to `/gameday/away-vs-home/...` (literal placeholder text) instead of the real team names — the team slugs were missing from that specific state's data

**v1.0.24.0**
- Fixed: the postponed/suspended schedule-page fallback (added in v1.0.23.0) was linking to the wrong page — it used each team's literal home city (e.g. "Bridgewater," "Wappingers Falls") instead of the brand name MiLB.com actually uses in its URLs ("Somerset," "Hudson Valley")

**v1.0.23.0**
- Fixed: a postponed or suspended game whose gamePk gets reassigned to a new makeup date could send you into an infinite redirect loop on MiLB.com's Gameday page. Postponed/suspended keys now link to your tracked team's schedule page instead, which always resolves

**v1.0.22.0**
- Fixed: a pre-game weather delay (e.g. "Delayed Start") could be misread as a mid-game delay because MLB's linescore data pre-populates a "Top 1" shell before first pitch — this in turn caused the previous fix's MiLB.tv fallback check to think the game had started and open the stream early. Now checks the game's actual live/preview status instead

**v1.0.21.0**
- Fixed: pressing a key set to MiLB.tv for a game delayed past its scheduled start time no longer opens the stream early — the plugin now checks the game's actual status instead of the clock, so a rain delay correctly falls back to Gameday until the game actually begins

**v1.0.20.0**
- Fixed: Gameday links now use the correct calendar date for evening games — West Coast/Mountain affiliates whose game time crosses into the next UTC day were getting a link one day ahead of the real game

**v1.0.19.0**
- Fixed: Gameday links now use the correct URL suffix for the game's actual state — pressing a key for a preview, delayed, postponed, or "Next Game" matchup no longer sends you to a blank `/live` page (also fixed for the mid-game rain-delay state, which previously fell through to `/preview` instead of `/live`)

**v1.0.18.0**
- Trimmed the "Next Game" date to just month/day (e.g. `7/25`) instead of including the day of the week — the line was running out of room on the key

**v1.0.17.0**
- Fixed: keys could incorrectly show "No Game" (or, as of the previous release, the wrong "Next Game" info) during the 15-20 minute pre-game warmup window due to a bug in how the start time was read — the warmup countdown now displays correctly right up until first pitch
- Fixed: postponed, suspended, and pre-game delayed games now carry full team info so the Gameday link opens the correct game instead of a generic fallback URL

**v1.0.16.0**
- On off days, the key now shows your team's next scheduled game (matchup, date, and time) instead of a dead-end "No Game"

**v1.0.15.0**
- Fixed: the inning/out indicator row now stays centered when a G1 or G2 label is shown during doubleheaders

**v1.0.14.0**
- Pre-game delays now show the updated start time alongside the DELAY indicator — if the first pitch gets pushed back, the key reflects the new time within 30 seconds

**v1.0.13.0**
- Fixed: key no longer switches to "Top 1" during pre-game warmups before first pitch — the matchup and start time stay visible until the game actually begins

**v1.0.12.0**
- Out indicators: two dots appear to the left of the inning — gray for unrecorded outs, red for recorded outs (inspired by classic out-of-town scoreboards)

**v1.0.9.0**
- After a game ends, pressing a key set to MiLB.tv now opens Gameday instead — the MiLB.tv link stays active for 30 minutes post-game to cover any post-game coverage, then switches automatically
- If the plugin loads and the game is already final, pressing the key goes straight to Gameday

**v1.0.8.0**
- Double-click a doubleheader key to peek at the other game — when Game 1 is active, see Game 2's start time; when Game 2 is active, see Game 1's final score
- Double-click again to snap back to the active game, or wait 15 seconds to auto-revert
- Single-clicking while viewing the other game opens that game's Gameday page
- Score changes and end-of-game fireworks always return the key to the active game view

**v1.0.7.0**
- Doubleheader support: automatically shows Game 1 until it ends, then switches to Game 2
- G1/G2 label appears next to the inning indicator, start time, or final/PPD/SUSP status so you always know which game you're watching
- Game 2 start time TBD handled gracefully — shows "TBD" instead of a blank or wrong time

**v1.0.6.0**
- Updated Oakland Athletics to Athletics (ATH) to reflect team's relocation to Sacramento

**v1.0.5.0**
- Updated action and category icons to white on transparent background
- Added plugin category for Stream Deck action picker grouping

**v1.0.4.0**
- Schedule now holds on the current day's games until 2 AM local time, so late-running games stay on the key until they finish

**v1.0.3.0**
- PPD and SUSP now display in red — signals the game won't happen today
- Pre-game rain delay displays DELAY in blue
- Mid-game rain delay keeps the current score visible with DELAY in blue where the inning indicator normally sits

*Note: v1.0.2 was an internal build — all changes are included here.*

**v1.0.2.0**
- Inning indicator and "Final" label now display in yellow
- End-of-game fireworks animation with winning team's name and colors

**v1.0.1.0**
- Added custom icons
