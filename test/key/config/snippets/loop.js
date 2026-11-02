// id: mine.loop
// label: Loop
// intent: Call itself until the depth limit stops it.
// matches: http://127.0.0.1/*
await fetch(location.origin + "/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page_id: new URLSearchParams(location.search).get("id"), type: "snippet_level", word: args.word, top: window === window.top }) });
await oasisfox.run("mine.loop");
