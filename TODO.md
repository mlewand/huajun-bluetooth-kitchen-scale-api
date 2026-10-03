# TODO

- **ml, fl.oz and lb:oz values are not decoded.** The unit is recognised (byte 5 high nibble) but `Reading.value` is absent and only `raw` is available. Needs captures with an item on the scale in each unit to confirm the decimal scale; for lb:oz also how pounds and ounces are packed above 1 lb.
- Negative sign (byte 5 bit 0) is only confirmed for grams.
- Byte 7 is unknown (not a checksum of bytes 0-6); frames are not integrity-checked.
- Bytes 1-2 (`05 00`) are constant and unexplained.
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
