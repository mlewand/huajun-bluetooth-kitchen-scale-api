# Alpha capture notes

Scale advertises `MY_SCALE`, 5000 g capacity, display resolution 1 g. Frames arrive on `FFB2`; the JSONL `char` field is the dashless 128-bit UUID. Display values come from the user: most are only the value in the file name, the 132 g run was confirmed on the display, the 68 g run is uncertain, and the tare item was reported as "40 or 41 g".

| File | Unit | Display | Notes |
|---|---|---|---|
| `26_grams_put_and_remove` | g | 26 | Settled frame 26.11 g. |
| `26_grams_put_but_without_remove` | g | 26 | Item left on; the stream goes straight from 0 to the settled value. |
| `68_grams_put_and_remove` | g | file name says 68, display possibly 67 | Settled frame 67.49 g, which would display as 67. Unresolved; see `67g_v2`. |
| `67g_v2` | g | 67 | Repeat of the above. Settled frame 67.16 g. |
| `132g_multiple_items` | g | 132 | Several items. Settled frame 131.68 g. |
| `1539g` | g | labelled by file name only | Settled frame 1539.20 g. |
| `44ml_put` | ml | 44 | Settled frame 44.07 g. |
| `1.7oz_put_and_remove` | oz | 1.7 | Settled frame 49.27 g (1.74 oz). |
| `0_2_4lboz_put_and_remove` | lb:oz | 0 lb 2.4 oz | Settled frame 66.89 g (2.36 oz). Peak 67.62 g, equal to the `68_grams` run's peak. |
| `put_item_then_tare_and_remove_item` | g | item 40 or 41 | TARE pressed with the item on (frames go to 0), then the item removed: frames show 40.91 g with byte 2 = `81` (negative, stable). |
| `tare_with_nothing` | g | 0 | TARE pressed on an empty scale. The first light touches changed nothing; the last two, pressed harder, registered as weight (38.61 g, then 5.66 → 1.51 g). |
| `example_log.txt` | g | not noted | BLE scanner app log with GATT discovery and a few frames (24.67 g). |

`captures/huajun/alpha1.jsonl` also contains alpha frames (3 idle frames).
