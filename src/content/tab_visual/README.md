# tab_visual

The `tab_visual` bundle. It loads on the first `gv`.

| File | Owns |
| --- | --- |
| `main.ts` | The `tab.visual_enter` handler and the sink of tab range mode. The sink's `exit` asks the background to end the range. |

The range is kept in the background (`src/background/tab_visual.ts`). Behavior: `docs/design/interfaces_tabs.md`, "Tab range".
