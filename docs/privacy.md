# Privacy policy

DesertFox collects no data. It has no account, no telemetry, no analytics and no ads. The developer receives nothing from your browser.

This file is the privacy policy of the DesertFox add-on. The same text is the privacy policy on its addons.mozilla.org page. It uses plain paragraphs and lists so it reads the same in both places.

## What stays on your device

DesertFox keeps its settings, keymap, quickmarks, macros, registers, command history and closed-tab list in Firefox storage on your device. It reads your tabs, history, bookmarks, cookies, downloads and clipboard only to run a command you typed or a key you pressed, and it sends none of that anywhere.

## Requests the add-on makes by itself

DesertFox makes two kinds of request on its own, both from the built-in new tab page. Each is a card you can switch off, and neither sends anything from a private window.

### Weather card (Open-Meteo)

The card is the setting `newtab_weather`. It sends nothing until you allow it. Its button, "Show the weather here", asks Firefox for two permissions: the optional data collection permission "location information" and the optional `geolocation` permission. Setting `newtab_weather_city` does not replace this step. Until you accept, the card draws only the button.

After you accept, the card asks Open-Meteo (`api.open-meteo.com`) for the forecast. With a position it sends the coordinates rounded to two decimals, about one kilometre. With a city it first sends the city text to Open-Meteo's geocoder (`geocoding-api.open-meteo.com`), then the rounded coordinates of the answer. When you open the More panel, it asks Open-Meteo's air quality host (`air-quality-api.open-meteo.com`) with the same rounded coordinates.

The requests carry no cookies and no referrer. Open-Meteo sees your IP address as any server does, and Firefox adds an `Origin` header that holds a random address of your DesertFox install, the same for every request from that install. The answer stays in local storage for 30 minutes at most. Turning the card off deletes the stored answer. You can withdraw both permissions in `about:addons`, on the Permissions tab of DesertFox.

### IP info line (Cloudflare)

The line is the setting `newtab_ip_info`. It is off by default. When you turn it on, each new tab asks Cloudflare (`https://1.1.1.1/cdn-cgi/trace`) for your public IP address and country code, and shows those two values. Cloudflare sees your IP address, as any server does. The request carries no cookies and no referrer. The answer stays in local storage for one hour at most. Turning the line off deletes the stored answer. DesertFox declares no data collection category for this line, because it sends no data of its own beyond the request.

## Requests you cause

- A search command sends the text you typed to the search engine you set. The default is DuckDuckGo.
- A command that copies or saves an image fetches that image from the page it came from.
- Opening a link or a page loads it, as in any browser.

## The optional native host (Linux)

The native host is a helper program you install yourself. It talks to DesertFox through Firefox only, and it has no network code of its own. It reads your config folder and writes one file there, `autoconfig.toml`.

Two paths download files from GitHub over HTTPS. The `:native.install` command shows an install command that you paste into a terminal yourself. It downloads a script from this project's GitHub releases and checks it against a hash that comes from the signed add-on. The setting `host_auto_update` is off by default. When you turn it on, DesertFox asks the host to replace itself with the host of the same release from GitHub, and the host checks each script against the same hashes. GitHub sees these downloads as it sees any download.

## Permissions

DesertFox asks for `nativeMessaging`, `browsingData`, `geolocation` and the location information data collection permission only when you click the button that needs them.

## Changes and contact

This file lives in the project repository and its history is public. Report a problem or ask a question at https://github.com/uhs-robert/desertfox/issues.
