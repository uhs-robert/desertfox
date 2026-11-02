// id: mine.elsewhere
// label: Elsewhere
// intent: Report from a page the snippet does not name.
// matches: https://example.invalid/*
await fetch(location.origin + "/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page_id: new URLSearchParams(location.search).get("id"), type: "snippet_wrong_site", word: args.word, top: window === window.top }) });
