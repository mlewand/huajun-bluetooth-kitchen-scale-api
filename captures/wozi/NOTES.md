# Wozi capture notes

There are two Wozi scales, similar but with slight hardware differences. Both send the same 8-byte `AC 05` frames on `FFB2` as HUAJUN and report the same model ID (21), but they have different GATT layouts and one has a different name. The capacities aren't known.

| | Scale A | Scale B |
|---|---|---|
| Advertised name | `NSCALE`, the same as HUAJUN | `SCALE` |
| Model ID reply | `AC 05 FE 1D 00 15 CC FC` | `AC 05 FE 1D 00 15 CC FC` |
| Service `FFB0` | `FFB1` [writeWithoutResponse, write], `FFB2` [notify], `FFB3` [writeWithoutResponse], `FFB4` [notify], `FFB5` [indicate], `FFB6` [read, write] | `FFB2` [notify], `FFB1` [writeWithoutResponse] |
| Other services | `181D`: `2A9E` [read], `2A9D` [indicate] | `180A`: `2A29`, `2A24`, `2A25`, `2A26`, `2A27` [read] |
| Manufacturer data, empty scale | `AC 05 00 00 00 00 CE CE` + 6 bytes | `AC 05 00 00 00 00 CE CE` + 6 other bytes |
| Advertised services | none | none |

## Weight captures (scale A)

Every `.jsonl` file here is from scale A. The display values come from the file names; no other notes were supplied. Scale B has only sent idle frames in grams so far (console output, below).

| File | Unit | Display | Frames |
|---|---|---|---|
| `idle` | g | 0 | Empty scale throughout. |
| `g-438` | g | 438 | Item on, then off. Settled bytes 3-6: `01 B6 00 CA`. |
| `oz_7.5` | oz | 7.5 | Item on, then off. Settled `00 4B 32 CA`: magnitude 75, byte 5 bits 1-3 = 1. |
| `lb.oz-0_7.5` | lb:oz | 0 lb 7.5 oz | Item on, then off. Settled `00 4B 22 CA`. Under 1 lb, so it doesn't show how pounds are sent. |
| `69g_into_tare_into_minus68_into_2123` | g | 69, 0, -68, 2123 | 69 g item on, TARE (frames go to 0), item off (`00 44 01 CA`: byte 5 bit 0 set), then a heavier load (`08 4B 00 CA`). Byte 2 stayed `00`. |

Compared with HUAJUN, byte 5 bits 1-3 are one lower (g 0 instead of 1, oz 1 instead of 2) and byte 7 is a checksum: the low byte of the sum of bytes 2-6, in all 237 frames and in the model ID reply. Scale B's idle frames and reply have the same checksum.

## Nutrition (`npm run try-nutrition`)

No JSONL reached the repo; this is from the console output and display readings the user reported. Each scale got one run with the defaults, with no resend:

- `AC 05 FE 1D 00 00 CC E7`, the model ID query, about 0.8-1 s after subscribing.
- `AD 01 00 03 E8 00 00 14 00 00 1E 00 00 28 00 01 0E 00 00 32`, about 3.3-3.5 s after subscribing.
- `AD 02 00 00 6E 00 00 78 00 00 82 00 00 8C 00 00 96 00 00 A0`, 1 s later.

| Field | Frame | Sent | Scale A | Scale B |
|---|---|---|---|---|
| Calories | `AD 01` 1 | 100 | 100.0 kcal | 100.0 kcal |
| Protein | `AD 01` 2 | 2 | 2.0 g | 2.0 g |
| Fat | `AD 01` 3 | 3 | 3.0 g | 3.0 g |
| Carbohydrate | `AD 01` 4 | 4 | 4.0 g | 4.0 g |
| Cal from Fat | `AD 01` 5 | 27 (fat × 9) | 27.0 kcal | 27.0 kcal |
| Fiber | `AD 01` 6 | 5 | 5.0 g | 5.0 g |
| Sodium | `AD 02` 1 | 11 | 11.0 mg | 11.0 mg |
| Sugar | `AD 02` 2 | 12 | 12.0 g | no counter |
| Cholesterol | `AD 02` 3 | 13 | 13.0 mg | 13.0 mg |
| Potassium | `AD 02` 4 | 14 | 14.0 mg | no counter |
| Trans fat | `AD 02` 5 | 15 | 15.0 g | no counter |
| Saturated fat | `AD 02` 6 | 16 | 16.0 g | no counter |

Not noted: how long the values stayed. Not tried: `AD 02` less than 1 s after `AD 01`.

## Earlier observations, no frames saved

Reported by the user before these captures, while the library still used fixed divisors (g and ml ÷10, oz and fl.oz ÷100):

| Display | Library said |
|---|---|
| 100 g | 10 g |
| 439 g | 43.9 g |
| 650 g | 65 g |
| 439 ml | 43.9 ml |
| 15.5 oz | 1.6 oz |
| 15.5 fl.oz | 1.6 fl.oz |

- These were reported for both scales, which is the only evidence so far for scale B with a load on it.
- SmartApple on an iPad connected and showed correct readings. SmartApple on Android didn't find the scale.
