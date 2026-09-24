# TODO

- **ml, fl.oz and lb:oz values are not decoded.** The unit is recognised (byte 5 high nibble) but `Reading.value` is absent and only `raw` is available. Needs captures with an item on the scale in each unit to confirm the decimal scale; for lb:oz also how pounds and ounces are packed above 1 lb.
- Negative sign (byte 5 bit 0) is only confirmed for grams.
- Byte 7 is unknown (not a checksum of bytes 0-6); frames are not integrity-checked.
- Bytes 1-2 (`05 00`) are constant and unexplained.
- `FFB4` never sent data in any capture.
