# Capture notes

Display was on grams (g) unless stated. No TARE used in any run. Empty scale at start of each run, item placed ~5-7 s in.

| Label | Unit shown | Settled display | Notes |
|---|---|---|---|
| test3 | g | 28.0 | item placed ~6-7 s in |
| test4 | g | 525.6 | some readings showed 525.7 |
| test5 | lb:oz | 0:1.2 | |
| test6 | oz | 2.43 | |
| test7 | g | 71.8 | |
| item-placed-and-lifted | g | (empty at start, item ~24.8 g by frames, unconfirmed) | item lifted between 6 and 7 s; returns to 0 |
| unit-cycle | g, lb:oz, oz, ml, fl.oz, g | empty scale | UNIT pressed to cycle in that order |
| item-insert-tare-remove | g | see frames | item on, TARE, item removed (display TBD) |

## rev1 (`rev1/`)

Recorded later, with the battery indicator at 1 of 5 bars (low) in every run. The battery level during the runs above is unknown.

| Label | Unit shown | Settled display | Notes |
|---|---|---|---|
| buttons | g, then lb:oz, then oz | empty scale | Two cycles of `+Plate` > `Total` > `UNIT` > `TARE`, a few seconds apart. The display gives no feedback for these buttons, so some presses might not have registered. Each cycle sent one `AC 05 FE 1E 03 …` (`+Plate`) and then one `AC 05 FE 1E 04 …` (`Total`), and `UNIT` advanced the unit (g → lb:oz, then lb:oz → oz). `TARE` sent nothing. |
| changed-g-to-ml | g, cycled to ml | 68.9 ml | UNIT pressed several times (g → lb:oz → oz → ml), then the item placed. The display showed other values briefly before settling. One frame between oz and ml was `AC 05 00 00 00 14 CA`: ml unit code with byte 5 bits 1-3 = 2. |
| changed-g-to-fl_oz | g, cycled to fl.oz | 2.32 fl.oz | Cycled g → lb:oz → oz → ml → fl.oz, then the item placed. |
| grams-heavy-load | g | 4770.0 | Weights added in four steps. Byte 2 stayed `00` and the frames kept one decimal throughout. |

## Writes (`npm run try-nutrition`)

No JSONL was saved; this is from the console output the user reported.

- Model ID query `AC 05 FE 1D 00 00 CC E7` → reply at 0.96 s: `AC 05 FE 1D 00 15 CC C4`, model ID 21 (`Nk965bt` in the vendor app, on its plate-total list).
- Nutrition frame `AD 01 00 03 E8 00 00 14 00 00 1E 00 00 28 00 01 0E 00 00 32` (100, 2, 3, 4, 27, 5), sent once. The display showed calories 100.0 kcal, protein 2.0 g, fat 3.0 g, carbohydrate 4.0 g. Fields 5-6 (27, 5) appeared nowhere. The values stayed for as long as the connection lasted, without resending.

### Timing (`npm run try-nutrition` flags, later session)

`npm run watch -- --nutrition 100,2,3,4` wrote the same kind of frame through the library right after the first reading (about 0.2 s after subscribing): the counters stayed at 0. Then, with the user reporting the display:

| Run | Model ID query | Write after subscribing | Counters |
|---|---|---|---|
| A: `try-nutrition` | yes | about 3.5 s | shown, a few seconds after the start |
| B: `--skip-query` | no | about 2.7 s | shown |
| C: `--skip-query --wait 0` | no | about 0.7 s | stayed at 0 |

So the query isn't needed, but the scale ignores nutrition sent too soon after connecting.
