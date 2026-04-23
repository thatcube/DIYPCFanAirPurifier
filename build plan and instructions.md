# DIY Air Purifier — Build Plan and instructions

---

## Box dimensions

| | Size |
|---|---|
| Interior width (void between filters) | 5.44" |
| Interior height | 19.69" |
| Interior depth (front to back) | 24.69" |
| Exterior width | 7.0" (interior 5.44" + 2 × filter thickness 0.78") |
| Exterior height | 20.69" (interior + top/bottom ½" ply each) |
| Exterior depth | 25.69" (interior + front/back ½" ply each) |
| Fan panel width | 7.0" (spans full exterior width, including filter overlap) |
| Fan layout | 3 fans per panel (front + back), evenly spaced with 1.5" buffer at top/bottom |

The box is an open-sided rectangle — **4 plywood panels** (top, bottom, front, back) with the left and right sides left open for the filters to slide in. There are no side panels.

---

## Component list

### Electronics

| Status | Item | Notes |
|---|---|---|
| ✅ Have | ADS-25-12 power supply (12V 2.1A) | Main power source |
| ✅ Have | 6× Arctic P12 Pro ARGB fans | 3 front + 3 back |
| ✅ Have | 5.5×2.1mm 1-to-2 DC power splitter cable | Splits PSU output — one feed for fans, one for step-down |
| ✅ Have | 12V→5V 3A step-down module (USB-C output) | Powers ESP32 via USB-C; also provides 5V for ARGB LEDs |
| ✅ Have | ESP32-C6-N16 dev board | Controls fan speed (PWM) + ARGB via HomeKit/ESPHome |
| ✅ Have| 5× Dupont F-F jumper wires 26AWG | For connecting ESP32 GPIO pins to fan PWM + ARGB data |
| ❌ Need | 5V 3-pin ARGB extension cable (~$3–5) | See ARGB wiring section below |
| ❌ Need (maybe) | 74AHCT125 level shifter chip (~$1–2) | Only needed if ARGB LEDs flicker — try without first |

### Wood & hardware

| Status | Item | Notes |
|---|---|---|
| ✅ Have | ½" plywood — 1 sheet (4×8 ft) | Box panels: top, bottom, front, back |
| ✅ Have | ~½"×⅜" wood strip, ~8 ft | Cut into 4 ledge strips for filter retention (mounted on top/bottom panel inner edges) |
| ❌ Need | Closed-cell EPDM foam tape — ½" wide × 3/32" thick | Seals between fan panels and top/bottom panels; runs as a continuous ring around all 4 inner faces |
| ❌ Need (Do we ???) | Wood glue | Corner joints | (???)
| ✅ Have | Screws (1¼" wood screws) + finish nails | Panel assembly |
| ❌ Need | Feet — pick one: | See options below |

**Feet options (all mount at the 4 corners of the bottom panel):**
- **Round wooden bun feet** — 2.5" tall, ~1.1" diameter. Gives good ground clearance for bottom airflow. Inset ~0.68" from panel edges.
- **Tapered peg legs** — 0.75" tall, ~0.6" diameter, tapers slightly. Low profile.
- **Rubber stick-on bumper feet** — 0.75" tall. Easiest, non-slip. Good for desk or shelf.

### Misc

| Status | Item | Notes |
|---|---|---|
| ✅ Have | Zip ties or cable clips | Route fan cables cleanly inside the void |
| ❌ Need | WAGO lever connectors 3-port (optional) | No-solder way to join wires — highly recommended if you don't want to solder |

---

# How to wire the ARGB LEDs — plain English
 
The ARGB LEDs in the fans need three things: **power (+5V), ground (−), and a data signal** that tells them what color to show. Here's how each piece connects:
 
### Step 1 — split the 12V supply
 
The DC splitter cable you ordered takes the one output from your power brick and splits it into two:
- **Output A** → into the PWM fan adapter → powers all the fan motors at 12V
- **Output B** → into the step-down module → converts 12V to 5V
 
### Step 2 — power the ESP32
 
The step-down module's only output is a USB-C port. Plug that directly into the ESP32-C6's USB-C port. Done — board is powered.
 
### Step 3 — get 5V to the ARGB LEDs
 
The step-down module has no exposed 5V wire leads on the output side — just the USB-C port. But you don't need them. When the ESP32 is powered via USB-C, it exposes the 5V bus on a pin on its header labeled **`5V`** or **`VIN`**. You can pull current right back out of that pin to power the LEDs. The step-down is rated 3A and the ARGB LEDs across all 6 fans draw maybe 0.3A at full brightness — plenty of headroom.
 
**Buy a cheap 5V 3-pin ARGB extension cable** (~$3 on Amazon — search "5V ARGB 3-pin extension cable"). Cut it roughly in the middle. You now have:
- A plug end (male 3-pin connector) — this plugs into fan #1's ARGB input port
- A loose wire end — this is where you connect power and data
 
The loose end has 3 wires:
 
- **Red (5V power)** → ideally connect to the step-down module's output pads directly (check the back of your board for bare +/− solder points). This bypasses the ESP32's onboard polyfuse, which could otherwise limit you to ~500mA–1A. If no pads exist, use a USB-C breakout board to tap 5V from the cable. As a last resort, the ESP32 5V pin will work at moderate LED brightness.
- **Black (GND)** → any GND pin on the ESP32, or the step-down's GND pad
- **Data wire** (usually green or white) → through a **74AHCT125 level shifter** chip, then to an ESP32 GPIO pin. The ESP32 outputs 3.3V; WS2812B LEDs expect a 5V data signal. Skipping the level shifter often works but can cause flickering — the chip costs $1–2 and guarantees clean signal.
 
To connect without soldering most of it: use **WAGO lever connectors** (3-port). The level shifter chip does require soldering four pins, but it's the simplest possible solder job.
 
### Step 4 — daisy-chain the fans
 
Each P12 Pro has an ARGB **input** and an ARGB **output** port. Chain them like Christmas lights:
 
```
[your cable] → fan 1 in ... fan 1 out → fan 2 in ... fan 2 out → fan 3 in ... and so on
```
 
One ESP32 GPIO pin controls all 6 fans' colors at once.
 
### Step 5 — daisy-chain fan power/PWM (PST)
 
The P12 Pro also PST-daisy-chains the 12V power and PWM speed signal. Same idea — chain all fans on each panel together, then one PWM signal wire from the ESP32 GPIO controls speed for all of them. You can run both fan clusters (front + back) on the same PWM channel since you want them at the same speed anyway.
 
**Getting the cable across the 25" span (front panel fans → back panel fans):** route the cable through the interior void. Drop it down along the inside of the bottom panel and zip-tie it flat so it's out of the airflow path.
 
---
 
## Filter retention — how the ledges work

The left and right sides of the box are **open** — there are no side panels. Filters slide straight in from the sides.

1. On the **inside** of the top and bottom panels, glue and nail a ~½"×⅜" wood strip along each side edge (4 strips total — 2 on top panel, 2 on bottom). These run about 70% of the panel depth, centered front-to-back.
2. The strips sit inboard so filters rest against them and sit roughly flush with the exterior edge.
3. A continuous ring of **foam tape** (~½" wide × 3/32" thick) runs around the inner faces of all 4 panels (front, back, top, bottom) to seal the gap between the plywood and the filter frame.
4. The filters are held in by the ledge strips above and below, and by friction/foam compression. Slide them in from the side.
 
---
 
## Firmware plan
 
Use **ESPHome** flashed to the ESP32-C6. It natively supports:
- `fan` component with speed percentage → mapped to PWM duty cycle on the fan header
- `light` component with `WS2812B` driver → controls ARGB chain
- HomeKit bridge via Home Assistant, or native Matter (the C6 supports Matter without a hub on iOS 16.2+)
 
This gives you Siri speed control, RGB scenes tied to fan speed, and full Home app integration.
 
---
 
## Build order

1. Cut all 4 plywood panels to dimension (top: 7.0"×25.69", bottom: same, front: 7.0"×19.69", back: same)
2. Cut fan openings in front and back panels (3 × 120mm circles per panel, evenly spaced with 1.5" buffer at top and bottom)
3. Glue and assemble the box — attach top, bottom, front, and back panels. Sides are left open for filters
4. Install ledge strips on the inner faces of the top and bottom panels (2 per panel, along each side edge)
5. Apply foam tape around all 4 inner panel faces as a continuous seal ring
6. Mount fans into front and back panels (3 per panel); daisy-chain PST cables
7. Run ARGB and PWM cables through interior; secure with zip ties along the bottom panel
8. Wire up electronics per the wiring plan above (PSU, step-down, ESP32)
9. Flash ESPHome to ESP32-C6, configure fan + light entities
10. Slide filters in from the sides, test airflow and ARGB
11. Attach feet to bottom panel corners

---

# ✅ Proven build reference (what actually worked)

This section documents the exact steps that worked on the first build, so the next one is plug-and-play.

## Parts that actually worked

| Part | Notes |
|---|---|
| ADS-25-12 (12V 2.1A) | ~1.85A worst case for 6 fans + ESP32 + ARGB. Plenty of headroom. |
| 5.5×2.1mm 1-to-2 DC splitter cable | One barrel feeds the fan daisy-chain, the other gets cut open for the step-down. |
| 12V→5V step-down with USB-C output (3A) | Powers ESP32-C6 directly via USB-C. |
| ESP32-C6 dev board (2× USB-C: CH343 + ESP32C6) | Use the **ESP32C6** USB-C port for power. |
| 6× Arctic P12 Pro ARGB | Daisy-chain both PWM (4-pin) and ARGB (3-pin) — no hub needed. |
| Female-to-female Dupont jumpers | For GPIO → fan PWM / ARGB data. |
| Optional: 8-channel level shifter (TXS0108E-based) | For ARGB data if flickering appears. Skip BSS138 boards — too slow for WS2812. |
| USB-C power meter (optional but useful) | Verifies 5V output before plugging in ESP32. |

## Wiring recipe (no soldering)

### Step A — Power path
1. Plug the ADS-25-12 into the 1-to-2 DC splitter.
2. **Barrel A** of the splitter → plugs into the first fan's 12V input (the daisy-chain handles the rest).
3. **Barrel B** of the splitter → cut the barrel plug off, strip the two wires ~½".

### Step B — Identify polarity (DO NOT SKIP)
1. Plug PSU into wall. Barrel B's bare wires hanging in free air.
2. Multimeter set to DC volts.
3. Red probe to one wire, black probe to the other.
   - **+12V reading** → red-probed wire is +12V. The other is GND.
   - **−12V reading** → swap. Black-probed wire is +12V.
4. Mark the +12V wire (tape, sharpie, knot).
5. Unplug PSU before continuing.

### Step C — Splice to the step-down's IN side
- Splitter +12V ↔ step-down's **red (IN+)**
- Splitter GND ↔ step-down's **black (IN−)**

Technique for mismatched wire gauges (splitter is thin ~24AWG, step-down is thick ~20AWG):
1. Lay thick wire straight.
2. Wrap the thin wire around the thick wire tightly, 6–8 turns.
3. Fold the last bit of the thick wire back over the wrapped section.
4. Insulate each joint **individually** with heat-shrink or electrical tape before doing the next.
5. Never leave two bare joints exposed at the same time.

### Step D — Verify before plugging in anything sensitive
1. Plug PSU into wall.
2. Measure the step-down's **USB-C output** (USB meter, sacrificed cable, or just plug in a junk USB-C powered gadget).
3. Should read **4.9–5.1V**.
4. If good: plug USB-C from step-down → **ESP32C6 port** on the ESP32 dev board.
5. ESP32 boots, connects to WiFi, appears at `air-purifier.local`.

### Step E — Fan control wiring (per fan cluster)
Arctic P12 Pro has a 4-pin PWM connector (pin 3 hole is physically absent — this is normal):

| Pin | Wire color | Signal | Goes to |
|---|---|---|---|
| 1 | Black | GND | ESP32 GND pin |
| 2 | Yellow | +12V | **Barrel A from PSU** (not ESP32) |
| 3 | (empty) | tach | Not connected |
| 4 | Blue | **PWM** | **ESP32 GPIO4** (female Dupont pushed into the lone pin-4 slot) |

**PST daisy-chain means you only connect the above once.** All 6 fans share the same PWM signal and same 12V through the passthrough connectors.

### Step F — ARGB wiring (once extension cable arrives)
1. Cut a 5V 3-pin ARGB extension cable in half.
2. Plug the male end into fan #1's ARGB input.
3. On the cut end, identify the three wires: **5V / Data / GND**.
4. Twist/tape splice:
   - 5V → step-down's 5V output (piggyback on ESP32's 5V pin is fine for 72 LEDs at moderate brightness)
   - GND → ESP32 GND (shared ground is critical)
   - Data → ESP32 **GPIO5**
5. If LEDs flicker or show wrong colors: insert the TXS0108E level shifter between GPIO5 and the Data wire.

## ESPHome config that works (fan speed only, ARGB to be added)

File: [air-purifier.yaml](air-purifier.yaml)

Key sections:

```yaml
esp32:
  board: esp32-c6-devkitc-1
  framework:
    type: esp-idf

# 25 kHz PWM on GPIO4 for PC fan speed control
output:
  - platform: ledc
    id: fan_pwm_output
    pin: GPIO4
    frequency: 25000Hz

fan:
  - platform: speed
    id: purifier_fan
    name: "Purifier Fan"
    output: fan_pwm_output
    speed_count: 100
```

Flashing (OTA over WiFi, no USB cable needed after first flash):

```bash
esphome run air-purifier.yaml --device air-purifier.local --no-logs
```

## Home Assistant integration

- HA is running on the Unraid server at home.
- ESPHome auto-discovers via mDNS. Device appeared as **Air Purifier** in the ESPHome integration.
- Exposed entities:
  - `fan.purifier_fan` — on/off + 1–100% speed
  - `light.onboard_led` — dev board's RGB LED (breathe / random effects)
- For Siri/HomeKit: enable the **HomeKit Bridge** integration in HA → scan QR code with iPhone Home app → Siri works immediately.
  - "Hey Siri, set the air purifier to 40%"
  - "Hey Siri, turn off the air purifier"

**Why HomeKit Bridge over native Matter:** ESPHome native Matter support is still not shipped as of April 2026 — the `matter:` component page literally 404s on esphome.io. Community consensus is to stick with ESPHome + HA + HomeKit Bridge until native Matter lands in ESPHome.

## Recommended PWM presets

Based on P12 Pro characteristics (3000 RPM max, 25 dBA at max). Through two HEPA filters with 6 fans, these are the sweet spots:

| Mode | PWM % | Approx RPM | Notes |
|---|---|---|---|
| Sleep | 25% | ~750 | Near-inaudible. Great for a bedroom overnight. |
| Quiet (default) | 40% | ~1200 | Ambient background noise level. Good CADR (~180–220 CFM). |
| Normal | 60% | ~1800 | Equivalent to XL Ultra "normal" mode. |
| Boost | 85% | ~2550 | Cooking smoke, allergy flare-up, wildfire. |
| Max | 100% | ~3000 | Loud. Emergency only. |

The XL Ultra (commercial reference) uses 6× Cooler Master Mobius 120 (2400 RPM, 63.1 CFM, 2.69 mmH₂O). Your P12 Pros outperform those specs per-fan (3000 RPM, ~81 CFM, ~4.4 mmH₂O), so matching XL Ultra CADR happens around **65–75% PWM**.

## Finding the ESP32 on the network

```bash
# mDNS discovery
dns-sd -B _esphomelib._tcp .

# Resolve hostname
dscacheutil -q host -a name air-purifier.local

# Direct ping
ping air-purifier.local
```

Web UI: **http://air-purifier.local**

## Gotchas discovered during the build

1. **No power LED on ESP32-C6 dev board.** Can't visually confirm power — verify by checking mDNS or web UI.
2. **Two USB-C ports on the dev board.** One is labeled `ESP32C6` (native USB, use this one for power), the other is `CH343` (UART bridge, for flashing only).
3. **Pin 3 missing on P12 Pro PWM connector.** Totally normal. The lone 4th pin on the other side is the PWM signal.
4. **Mismatched wire gauges when splicing.** Wrap the thin wire around the thick one, not the other way around. Fold the thick wire's tip back over the wrap to lock it.
5. **Polarity is not guaranteed by wire color.** Always verify with a multimeter before connecting to the step-down.
6. **BSS138-based level shifters are bad for WS2812 ARGB data.** They work for I2C but cause flicker on LED strips. Use TXS0108E or 74AHCT125 instead.
7. **mDNS discovery on `air-purifier.local` is the single best debugging tool.** If that resolves, 95% of the wiring is correct.

## Shopping list for the next build (AliExpress)

Add these to your next order to have everything ready:

- [ ] 5V 3-pin ARGB extension cable (~$3)
- [ ] 8-channel TXS0108E level shifter module (~$3 for 2-pack)
- [ ] USB-C power meter dongle (optional, ~$3–5)
- [ ] Extra Dupont jumper kit (M-F and F-F, 20cm)
- [ ] Heat-shrink tubing assortment (nicer than electrical tape)
