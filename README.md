# luci-app-status-light

Internet status on the RGB status LED of the Askey/Spectrum SBE1V1K, with a LuCI page
(System > LED Configuration > Status Light). Self-use package, built for my own firmware.

## What it does

A small daemon (`status-light`) checks IPv4, IPv6 and DNS on their own and shows one of
eight cases on the status LED. Each case has its own look (Solid, Flashing, Follow system
settings; scenario 1 can also be Easing (breathing)); the page has four tabs:

- Current state: the LED as it is now, and what the last check found
- Scenario lights: the look of the eight cases
- Detection: intervals, hosts, DNS checks
- Breathing light: colour, timing and white balance of the breathing light (shown when
  scenario 1 is set to Easing, or when the breathing entries already exist)

The state is written to `/tmp/status-light.json`, the settings are in `/etc/config/status_light`.

## Needs in the firmware

- `kmod-ledtrig-pattern` (the pattern LED trigger)
- the pattern hook for `/etc/init.d/led` and `led-pattern-sync`
  (`/usr/libexec/led-trigger/pattern`, `/usr/libexec/led-pattern-sync`), see sync-bot patch 0008
- `ip-full` (installed with the package)

## Picture of the device

The Current state and Breathing light tabs show a picture of the device with the light laid
over it (`device.png`, drawn for this package). Without the picture an icon is shown.
