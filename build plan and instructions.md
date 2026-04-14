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
| ✅ Have| DC5521 to 4-pin PWM fan adapter cable | Delivers 12V + PWM signal to fans |
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