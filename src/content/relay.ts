// A bundle in a subframe asks the background to run one of its handlers in the top frame or in another frame of the tab. `shared/relay.ts` is the allow list.

import type { Outcome } from "../shared/messages/content.ts";
import type { RelayedBundle, RelayedId } from "../shared/relay.ts";
import { refused_as } from "../shared/swallow.ts";
import type { ArgsOf, BundleOf } from "./bundle_calls.ts";

declare const browser: MessagingBrowser;

// Compile-time only. Fails to compile when a relayed id is missing from the call map or the table and the map name different bundles.
type Mismatched = { [Id in RelayedId]: [BundleOf<Id>] extends [RelayedBundle<Id>] ? ([RelayedBundle<Id>] extends [BundleOf<Id>] ? never : Id) : Id }[RelayedId];
export type RelayTableMatchesMap = Must_be_never<Mismatched>;
type Must_be_never<Ids extends never> = Ids;

// What the handler answered over there, or undefined when the background refused or the frame never answered.
export const relay_outcome = <Id extends RelayedId>(to: "top" | number, id: Id, args: ArgsOf<Id>): Promise<Outcome | undefined> =>
  refused_as(browser.runtime.sendMessage({ type: "relay", to, id, args }), undefined);

// Whether the handler ran and did not fail. A caller that can draw in its own frame does so when this is false.
export const relay = async <Id extends RelayedId>(to: "top" | number, id: Id, args: ArgsOf<Id>): Promise<boolean> => (await relay_outcome(to, id, args))?.ok === true;
