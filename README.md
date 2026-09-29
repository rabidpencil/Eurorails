# Eurorails — board data and opening planner

Companion planner for Mayfair *Eurorails* as played in **Empire Builder – Europe** on Steam,
and a sibling of [Empire-Builder](https://github.com/rabidpencil/Empire-Builder).
The app is `eurorails_planner.html` — a single file, served from GitHub Pages.

Unlike the Empire Builder data, nothing here was detected from photos: every number comes
from the Steam game's own files, and the cost rules come from its code.

## Contents

```
Map/    er-map.json      full board: nodes, crossings, rivers, cities, ports, ferries, goods
        er-cities.json   the 60 cities (EB cities format)
Cards/  er-demand-cards.json   146 demand cards (EB card format), numbered 1-146
        er-event-cards.json    22 event cards (147-168) with the mileposts/river each affects
Tools/  parse_mapdataso.py  decodes the game's MapDataSO asset
        er_export.py        MapDataSO -> the data files + planner graph + rules
        er-plan-graph.json  planner graph
        er-rules.json       rule constants
        er_core.js          planning core (fork of EB core.js)
        er_build_app.py     builds eurorails_planner.html
        er_test.js          regression checks:  node Tools/er_test.js
```

## Where the data comes from

The game is Unity (Mono). The board lives in a ScriptableObject in
`Empire Builder - Digital_Data/resources.assets`. The game ships three:

| Resources path | path_id | |
|---|---|---|
| `games/europe/maps/map` | 19462 | **the current game — used here** |
| `games/europe-2026/maps/map` | 19461 | newer revision: Oslo and Stockholm become 2-milepost cities |
| `games/eurorails-2004/maps/map` | 19463 | older layout: Calais–Dover ferry, no Chunnel, 120 cards |

The exported data was cross-checked against the 2009 Eurorails rulebook: build costs, ferry
costs (Dublin 6, Belfast 4, Chunnel 20), 146 + 22 cards, 60 cities / 8 majors, and all 73
city–good supply pairs and chip counts match. The game spells a few names differently
(Fruit for Oranges, Kobenhaven, Cherboug); the files keep the game's spellings.

The cost model was validated against a real save: it prices the 52 track segments in
`checkpoint_1_Sample.json` at 85M, exactly the amount the save records as spent.

## Rebuilding

```
python Tools/parse_mapdataso.py resources_assets_19462_MapDataSO.bin
python Tools/er_export.py resources_assets_19462_MapDataSO.json [checkpoint.json] .
cd Tools && python er_build_app.py
```

To get the `.bin`, run the extraction scripts from the original session against the game
folder (object 19462 in `resources.assets`). If a game update moves you to the 2026 map,
extract that object instead and rerun the two commands.

## Coordinate frame

Game coordinates `(x, y)`: rows are horizontal, **y increases northward**, odd rows are
shifted half a step east, and rows are 0.8725 column-spacings apart. Neighbours of `(x, y)`
are `(x±1, y)`, `(x, y±1)`, and `(x+1, y±1)` on odd rows / `(x-1, y±1)` on even rows — the same
rule as the game's `Grid.CalculateNodeNeighbors`. `er-plan-graph.json` also carries `xy`
drawing positions.

## Cost model (from the game's code)

Build cost is charged for the milepost you build **into** (`Node.GetBuildCost`):

- clear 1, mountain 2, alpine 5, small / medium city 3
- major city 5 to enter from outside; moving within a major city is free
- river +2, lake +3, ocean inlet +3 (`MapNodeData.GetWaterCrossingCost`)
- ferry port or Chunnel port: the route's cost (4-16, Chunnel 20) replaces terrain and water;
  crossing to the far port is then free

Graph edges are `[u, v, surcharge, kind]` (kind 0 normal, 1 ferry, 2 Chunnel, 3 inside a major).
Building into `v` costs `cost[v] + surcharge`, exactly as in the EB graph. Ferry, Chunnel and
major-internal edges carry a negative surcharge that cancels `cost[v]`, so the existing
Dijkstra/Steiner code works unchanged.

## Planner changes from the Empire Builder app

- **Ferries**: moving onto a ferry ends your turn and the next turn runs at half speed. The
  planner charges a ferry crossing its *expected* movement cost: half a turn's leftover moves
  plus what half speed loses (8 moves at speed 9, 12 at speed 12). This is an average, not a
  turn-by-turn simulation.
- **Chunnel**: an un-upgraded Freight (9 moves / 2 loads) may neither build nor ride it — the
  digital game enforces this. Its movement cost is 1.
- **Circus**: off by default (the digital game has none). "Rulebook" is the printed variant —
  cards divisible by 10, chips start in Kaliningrad and Paris, the lowest demand is replaced.
  "House" is the Empire Builder house rule — multiples of 5, circus as an extra option.
- Money is shown in millions (M), not dollars; the win target stays 250M. The planner never
  tracked major-city connections, so the 7-of-8 rule needs no change.
- Browser storage keys use an `er_` prefix so this app and the EB app (same github.io origin)
  don't overwrite each other.

## Known approximations

- 6 river crossings are recorded on only one side in the game data, so the game charges them in
  one direction only; 7 water crossings next to ferry ports are skipped by the game when
  building into the port. The graph is undirected and charges both directions (listed in
  `er-map.json` as `one_sided_crossings`).
- Rulebook differences: the printed rules treat a ferry port as a clear milepost if you don't
  use the ferry; the digital game charges the ferry cost for building into the port regardless.
  This data follows the game.
- Events are exported but not yet used by the planner.
