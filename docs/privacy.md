# Privacy policy

DesertFox collects no data. It has no account, no telemetry, no analytics and no ads. The developer receives nothing from your browser.

This file is the privacy policy of the DesertFox add-on. The same text is the privacy policy on its addons.mozilla.org page. It uses plain paragraphs and lists so it reads the same in both places.

## What stays on your device

DesertFox keeps its settings, keymap, quickmarks, macros, registers, command history and closed-tab list in Firefox storage on your device. It reads your tabs, history, bookmarks, cookies, downloads and clipboard only to run a command you typed or a key you pressed. The add-on sends none of that to a server. The one exception is the optional desktop link described below, which hands tab titles and addresses to programs on your own computer.

## Requests the add-on makes by itself

DesertFox makes two kinds of request on its own, both from the built-in new tab page. Each is a card you can switch off, and neither sends anything from a private window.

### Weather card (Open-Meteo)

The card is the setting `newtab_weather`. It sends nothing until you allow it. Its button, "Show the weather here", asks Firefox for the optional data collection permission "location information". When no city is set, the same prompt also asks for the optional `geolocation` permission. Until you accept, the card draws only the button, even with a city set. With a city set, the card uses the city and never reads your position.

After you accept, the card asks Open-Meteo (`api.open-meteo.com`) for the forecast. With a city it first sends the city text to Open-Meteo's geocoder (`geocoding-api.open-meteo.com`), then the rounded coordinates of the answer. With no city it sends your position, with the coordinates rounded to two decimals, about one kilometre. When you open the More panel, it asks Open-Meteo's air quality host (`air-quality-api.open-meteo.com`) with the same rounded coordinates.

The requests carry no cookies and no referrer. Open-Meteo sees your IP address as any server does, and Firefox adds an `Origin` header that holds a random address of your DesertFox install, the same for every request from that install. DesertFox checks the consent again before every request, so withdrawing it stops later requests at once. The answers stay in local storage until a newer one replaces them. DesertFox refetches after 30 minutes and shows a stored answer for up to 6 hours. The stored answers hold the rounded coordinates, the place name and the forecast. Turning the card off, or a new tab that finds the consent withdrawn, deletes them. You can withdraw the permissions in `about:addons`, on the Permissions tab of DesertFox. A user with a city set holds the consent only.

### IP info line (Cloudflare)

The line is the setting `newtab_ip_info`. It is off by default. When you turn it on, each new tab asks Cloudflare (`https://1.1.1.1/cdn-cgi/trace`) for your public IP address and country code, and shows those two values. Cloudflare sees your IP address, as any server does. The request carries no cookies and no referrer. The answer stays in local storage until a newer one replaces it, and DesertFox shows it for up to one hour. Turning the line off deletes the stored answer. DesertFox declares no data collection category for this line, because it sends no data of its own beyond the request.

## Requests you cause

- A search command sends the text you typed to the search engine you set. The default is DuckDuckGo.
- A command that copies or saves an image fetches that image from the page it came from.
- The command line shows the icon of each open tab. For a tab whose icon has an http or https address, the add-on page loads that icon from the address the page gave, which can be any site you have open.
- Opening a link or a page loads it, as in any browser.

## The optional native host (Linux)

The native host is a helper program you install yourself. It talks to DesertFox through Firefox. Its only network use is the update download described below. It reads your config folder and writes these files there: `settings.toml` when you change a setting, a theme file under `themes/` when you import or remove a theme, the Search engines section's own files `search_engines.d/zz-desertfox.toml` and `keymap.d/zz-desertfox.toml`, an empty lock file `.settings.lock`, and `autoconfig.toml`, which holds only a copy of the key edits you made in the browser. Outside that folder it writes only the files of its own update, the scratch files of the external editor and the cache files of the desktop link. The last two are described below.

Two paths download files from GitHub over HTTPS. The `:native.install` command shows an install command that you paste into a terminal yourself. The install script downloads a script from this project's GitHub releases and checks it against a hash that comes from the signed add-on. The setting `host_auto_update` is off by default. When you turn it on, DesertFox asks the host to replace itself, and the host itself downloads the scripts of the same release from GitHub over HTTPS and checks each script against the same hashes. GitHub sees these downloads as it sees any download.

The external editor sends the text of a page field to a program you chose in `editor.toml`. The host writes that text to a scratch file (a temporary file the editor opens) in `$XDG_RUNTIME_DIR/desertfox/editor`. The host uses that folder only when it is a real folder that only you can write. When that folder is memory-backed (the usual case), the text does not reach the disk. Memory can still be written to swap (disk space that holds memory pages), as it can for Firefox itself. If the folder is not memory-backed, the text goes to the disk there. If the folder is missing or not trusted, the host uses `~/.cache/desertfox/editor` (or `$XDG_CACHE_HOME/desertfox/editor`) instead, and that folder is on disk. The host deletes the scratch file when the editor closes and DesertFox has read the result. If the editor never finishes, for example when you close the browser, the next editor start deletes files that are a day old. A text from a private window goes to the editor only when the folder is memory-backed. Otherwise the host refuses the request and writes no scratch file. The host cannot control your editor, so the swap, backup and undo files of the editor go where the editor puts them, often on the disk. Turn them off in the editor. The host deletes any such file left in its own scratch folder after a day. DesertBird, the Thunderbird add-on, uses the same editor path through its own host manifest and sends the text of a message you are composing to the same program from `editor.toml`. Thunderbird has no private windows, so it sends `private: false`.

## The optional desktop link

The setting `bridge_share_tabs` is off by default and needs the desktop link (bridge) to be on. When it is on, programs on your own computer that connect to the link's local socket (readable by your user only) can list your open tabs with their titles and addresses, switch to them, close them and capture them. Tabs in private windows never show. The host keeps a screenshot of a captured tab and the icon of a listed tab as files in `~/.cache/desertfox/` (or `$XDG_CACHE_HOME/desertfox/`), outside Firefox storage. These files stay on your computer, and the host deletes the files of tabs that are no longer open after 7 days, and deletes both folders when sharing is turned off. DesertFox sends none of this over the network.

The same host also serves DesertBird, the Thunderbird add-on. Its share settings are off by default and need its bridge setting on. With them on, programs on your computer that connect to its own local socket (readable by your user only) can list your mail folders, list messages with sender, subject and date, read a message body and list attachment names. The host passes each answer to the program that asked and keeps none of it. Nothing goes over the network.

## The optional browser module

The browser module is a script you install yourself, with administrator rights, into the folder where Firefox loads its own startup scripts. It is not part of the add-on, and DesertFox never installs or loads it. It stays off until you turn on the setting `browser_module`, which is off by default.

Key events stay on your device. The module sees your key presses in the browser window, because that is how it takes the tab and scroll keys on pages an extension cannot reach. It sends none of them to DesertFox and to nobody else. While the setting is on, DesertFox writes to its own session storage the on or off switch, at most 32 single-key bindings for tab and scroll commands, the mode of each tab and whether the setting `blur_on_load` is on. While the module draws the status bar, DesertFox also writes, for each tab, the keys you have half typed (at most 8), a typed count, whether pass-next is armed, the name of a macro register that is recording and, outside private windows, the label of a site mode, and it writes the mode colors of your theme and the bar's item lists and corner style from your settings. This stays in session storage on your device and leaves the browser at no point. The module sends DesertFox a hello that holds a protocol version number, its version text and whether it drew the status bar. It can also send a short list of typed requests, each naming one kind from a fixed list of requests that DesertFox handles. With only this setting on, DesertFox refuses every request. DesertFox also sends the module a short list of typed requests of its own, each naming one kind from a fixed list: split the window with a new tab or the next tab, unsplit, close both tabs of a split, resize the split by whole 5 percent steps, and move the focus to the sidebar, the page, the other pane or DevTools. These change the browser window only when you run a pane command, by its key or from the DesertFox command line. The module answers with a short refusal text. DesertFox sends the module no code, address, selector or page text for it to run, and the module makes no network request.

A second setting, `browser_module_pages`, is off by default too and works only with `browser_module` on. It lets the module run DesertFox's own page code, the same code that runs on web pages, inside the PDF viewer and Reader View. There it gets no more privilege than on a web page. While both settings are on, DesertFox writes to its session storage a copy of your keymap with the patterns of your site rules, your settings in force, your theme and the which-key list, so that the page code can read them there. The messages between that page code and DesertFox pass through the same storage, and the module only hands them on. They can hold text from those pages, such as the link text that hints show, the text you copy and page addresses. Code with browser privileges can read this storage. DesertFox removes the copies when you turn either setting off. None of it leaves your device.

## Permissions

DesertFox asks for `nativeMessaging`, `browsingData`, `geolocation` and the location information data collection permission only when you click the button that needs them.

## Changes and contact

This file lives in the project repository and its history is public. Report a problem or ask a question at https://github.com/uhs-robert/desertfox/issues.
