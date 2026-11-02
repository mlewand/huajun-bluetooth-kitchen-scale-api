# Wozi capture notes

The scale advertises `NSCALE`, the same name as HUAJUN, and sends the same 8-byte `AC 05` frames on `FFB2`. There are two Wozi scales, similar but with slight hardware differences, and these runs don't record which one was used. Capacity and model ID aren't known yet.

The display values below come from the file names; no other notes were supplied.

| File | Unit | Display | Frames |
|---|---|---|---|
| `idle` | g | 0 | Empty scale throughout. |
| `g-438` | g | 438 | Item on, then off. Settled bytes 3-6: `01 B6 00 CA`. |
| `oz_7.5` | oz | 7.5 | Item on, then off. Settled `00 4B 32 CA`: magnitude 75, byte 5 bits 1-3 = 1. |
| `lb.oz-0_7.5` | lb:oz | 0 lb 7.5 oz | Item on, then off. Settled `00 4B 22 CA`. Under 1 lb, so it doesn't show how pounds are sent. |
| `69g_into_tare_into_minus68_into_2123` | g | 69, 0, -68, 2123 | 69 g item on, TARE (frames go to 0), item off (`00 44 01 CA`: byte 5 bit 0 set), then a heavier load (`08 4B 00 CA`). Byte 2 stayed `00`. |

Compared with HUAJUN, byte 5 bits 1-3 are one lower (g 0 instead of 1, oz 1 instead of 2) and byte 7 is a checksum: the low byte of the sum of bytes 2-6, in all 237 frames.

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

- `Scale.setNutrition` (`AD 01`): the display showed the values sent, for example 96 kcal, protein 2.9 g, fat 1.8 g, carbohydrate 14.9 g.
- The display also has fiber, sugar, cholesterol, potassium, sodium, trans fat and saturated fat. They stayed at 0.
- SmartApple on an iPad connected and showed correct readings. SmartApple on Android didn't find the scale.
