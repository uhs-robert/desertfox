// The name a sender file uses in `declare const browser: MessagingBrowser;`. It is global, so the file needs no import: an import statement, even one for a type, moves the minified names of every bundle that holds the file.
type MessagingBrowser = import("./shared/messages/map.ts").MessagingBrowser;
