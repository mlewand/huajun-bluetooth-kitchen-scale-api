# TODO

## HUAJUN (`NSCALE`)

- **lb:oz values are not decoded.** The unit is recognised (byte 5 high nibble) but `Reading.value` is absent and only `raw` is available. `00 0C 22` showed 0 lb 1.2 oz, which fits both "total ounces ×10" and "byte 3 = lb, byte 4 = oz ×10"; a capture above 1 lb would tell them apart.
- Negative sign (byte 5 bit 0) is only confirmed for grams.
- Byte 7 is unknown (not a checksum of bytes 0-6; it changes between otherwise identical frames, including control frames); frames are not integrity-checked.
- **Control frames** (byte 2 `FE`): `AC 05 FE 1E 03 00 00` is `+Plate` and `AC 05 FE 1E 04 00 00` is `Total` (`captures/huajun/rev1/buttons`), delivered by `Scale.onButton`. The vendor app's handler also knows codes `01` and `02`, and the app writes other control frames, but none was captured, so any other control frame is rejected as `control-frame`. Buttons aren't decoded for the alpha scale: its captures only pressed TARE, which sent no frame of its own.
- **Battery and tare icon:** nothing in bytes 5-7 changed at 1 of 5 battery bars (rev1) compared with the earlier runs, whose battery level is unknown. The tare icon's state was never recorded, so it's unknown whether either is sent.
- **Unconfirmed layout from a decompiled vendor app** (an analysis of the SmartApple 3.3.0 Android app, kept outside the repo; not capture evidence, so not applied). It reads the weight as 24 bits over bytes 2-4 and the unit as `byte5 & 0x70`. Every capture fits both this and the 16 bits used now: byte 2 can't be non-zero below 6553.6 g (the scale tops out at 5000 g). The app also lists unit codes `5x` (kg) and `6x` (ml with a 0.972 density factor), never seen on this scale. Its decimal count (byte 5 bits 1-3) is applied now, because the Wozi captures confirm it. A transient `AC 05 00 00 00 14 CA` while switching oz → ml has ml with 2 decimals instead of the usual 1, at weight 0.
- `FFB4` never sent data in any capture.
- **Nutrition writes** (`setNutrition`): only `AD 01` fields 1-4 are confirmed (on model ID 21). Not exposed or not tried: `AD 02` (sodium, sugar, cholesterol, potassium, trans and saturated fat; no counter for them was seen on the display), `AE 01`/`AE 02` plate totals (model 21 is on the vendor app's plate-total list, so the `Total` page probably uses them), and the page/indicator command `AC 05 FE 20 …`. Whether the counters clear on disconnect or only stop updating wasn't noted precisely. The scale ignores nutrition sent too soon after connecting; the cutoff lies between 0.7 s and 2.7 s after subscribing, and the library waits 3 s.
- **alpha nutrition** (`D5`): confirmed with calories, fat, carbohydrate and protein, the four types this scale lists in its `A0` device info. Unknown: whether the food ID (the library sends 1) matters, and whether other alpha models list other types (cholesterol, sodium, sugar, …), which would need the `A0` frame, sent only after a `D0` time/user command the library doesn't send.
- **Model ID reply** `AC 05 FE 1D 00 15 CC C4` (model 21, `Nk965bt` in the vendor app): bytes 6-7 are unexplained. `CC` matches the constant in the app's commands, but `C4` isn't their checksum (the sum of bytes 2-6 ends in `FC`). The library never sends the query; `parseFrame` rejects the reply as `control-frame`.

## Wozi (`NSCALE`)

Same protocol as HUAJUN; `captures/wozi/NOTES.md` has what's confirmed.

- **Nutrition counters:** the display also has fiber, sodium, sugar, cholesterol, potassium, trans fat and saturated fat, which stay at 0. The library sends fiber as 0 in `AD 01` and never sends `AD 02`, whose six fields in the decompiled vendor app are exactly the other six (sodium, sugar, cholesterol, potassium, trans fat, saturated fat, in that order, packed like `AD 01`). `npm run try-nutrition` tests this; nothing is confirmed yet. Also open: whether `AD 02` can follow `AD 01` directly (the vendor app leaves about 1 s), the units (inferred: mg for sodium, potassium and cholesterol, g for the rest), and whether HUAJUN ignores `AD 02` harmlessly (the vendor app sends it to model 21 too). If the counters stay at 0, the next things to try are resending every 6 s, the page command `AC 05 FE 20 …`, and the FitDays SDK's 8-byte per-fact commands (`AC xx <u32 value> <type> <sum>`), a weaker fit because they have no potassium, trans fat or saturated fat.
- **ml and fl.oz weren't captured.** The display showed 439 ml and 15.5 fl.oz when the fixed divisors gave 43.9 and 1.55, which fits 0 and 1 decimals, and the decoder takes the decimals from the frame. A capture of each would confirm it.
- **lb:oz above 1 lb** wasn't captured, so this has the same open question as HUAJUN (`00 4B 22` showed 0 lb 7.5 oz).
- **Which scale:** there are two Wozi scales with slight hardware differences. The captures don't record which one was used, and the other may differ. Their model IDs and capacities are unknown; 2123 g is the heaviest seen.
- **Byte 7** is a checksum here (the low byte of the sum of bytes 2-6, every captured frame) but not on HUAJUN, so it isn't checked. Over several frames it could tell the two apart if the library ever needs to.
- **Buttons:** `+Plate` and `Total` frames weren't captured.
- **Negative sign** is confirmed for grams only (`00 44 01`, tare then item removed).
- **SmartApple on Android doesn't find the scale, on an iPad it does.** Per the decompile, the Android 3.3.0 scan accepts only a name containing `SWAN` with service `FFB0` advertised, or manufacturer data with company `0x05AC` and exactly 12 bytes. The scale's advertisement wasn't captured, so this isn't confirmed as the cause.

## alpha (`MY_SCALE`)

- **lb:oz has no `value`.** The weight is known (`rawWeight`, milligrams), but how a single signed number should represent pounds and ounces isn't decided.
- **Display resolutions** (`DEVICE_RESOLUTION`) come from the displays in the captures: g 1, ml 1 (44.07 g shown as 44), oz 0.1 (1.738 oz shown as 1.7). The 67.49 g capture shown as 67 fits rounding to the nearest gram. Confirm with more captures near a .5 boundary.
- **ml assumes water** (`value` = grams). Only one capture (44.07 g shown as 44 ml). The scale can't know the liquid, so confirm it doesn't apply a density.
- **oz conversion** (÷ 28.349523125 g) is checked only against the 1.7 oz and 0 lb 2.4 oz displays. A heavier item in oz mode would make it solid.
- **fl.oz** (unit code 4 on HUAJUN) was never captured on this scale; `unit` and `value` are absent for any code other than 0-3.
- **Negative sign** (byte 2 bit 7) comes from one capture (`0x81`: stable, negative, after tare with the item removed). A changing negative frame (`0x80`) is inferred, not captured.
- Byte 2 bits 1-6 never appeared; `stable` and `value` are absent if one is set (`negative` is still read from bit 7, because `ParsedFrame.negative` is a required boolean).
- Byte 1 (`41`), byte 3 low nibble, bytes 7-17 (always 0) and byte 18 (always `A6`, indistinguishable from a constant in the checksum) are unexplained.
- Touching the TARE button registers as a weight on the scale's touch sensor (38.61 g and 5.66 g were seen); that is hardware behaviour, not decodable.
- The tare offset isn't reported, only the net weight.
- Advertisement data wasn't captured, so it's unknown whether `MY_SCALE` advertises service `FFB0`. If it does (and so does HUAJUN), `CapacitorTransport` could filter by service instead of showing an unfiltered picker.
- The alpha scale stops sending after about five stable frames until the weight changes; no keepalive is known or used.
- `captures/huajun/alpha1.jsonl` holds alpha frames (3 idle frames) in the HUAJUN folder.
