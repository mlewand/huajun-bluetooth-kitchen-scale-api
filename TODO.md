# TODO

## HUAJUN (`NSCALE`)

- **lb:oz values are not decoded.** The unit is recognised (byte 5 high nibble) but `Reading.value` is absent and only `raw` is available. `00 0C 22` showed 0 lb 1.2 oz, which fits both "total ounces ×10" and "byte 3 = lb, byte 4 = oz ×10"; a capture above 1 lb would tell them apart.
- Negative sign (byte 5 bit 0) is only confirmed for grams.
- Byte 7 is unknown (not a checksum of bytes 0-6; it changes between otherwise identical frames, including control frames); frames are not integrity-checked.
- **Control frames** (byte 2 `FE`): `AC 05 FE 1E 03 00 00` is `+Plate` and `AC 05 FE 1E 04 00 00` is `Total` (`captures/huajun/rev1/buttons`), delivered by `Scale.onButton`. The vendor app's handler also knows codes `01` and `02`, and the app writes other control frames, but none was captured, so any other control frame is rejected as `control-frame`. Buttons aren't decoded for the alpha scale: its captures only pressed TARE, which sent no frame of its own.
- **Battery and tare icon:** nothing in bytes 5-7 changed at 1 of 5 battery bars (rev1) compared with the earlier runs, whose battery level is unknown. The tare icon's state was never recorded, so it's unknown whether either is sent.
- **Unconfirmed layout from a decompiled vendor app** (an analysis of the SmartApple 3.3.0 Android app, kept outside the repo; not capture evidence, so not applied). It reads the weight as 24 bits over bytes 2-4, the decimal count from byte 5 bits 1-3 (divisor 10^n), and the unit as `byte5 & 0x70`. Every capture fits both this and the fixed per-unit divisors used now: byte 2 can't be non-zero below 6553.6 g (the scale tops out at 5000 g), and 4770.0 g still used one decimal. The one hint is a transient `AC 05 00 00 00 14 CA` while switching oz → ml: ml with bits 1-3 = 2 instead of the usual 1 (value 0 either way). The app also lists unit codes `5x` (kg) and `6x` (ml with a 0.972 density factor), never seen on this scale.
- `FFB4` never sent data in any capture.

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
