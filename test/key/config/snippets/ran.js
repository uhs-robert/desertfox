// id: mine.ran
// label: Ran
// intent: Report that the snippet ran on a matching page.
// matches: http://127.0.0.1/*
// param: word string main default=hi
await fetch(location.origin + "/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page_id: new URLSearchParams(location.search).get("id"), type: "snippet_ran", word: args.word, top: window === window.top }) });
