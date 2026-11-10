type TitledNode = { url?: string | undefined; type?: string | undefined; title?: string | undefined; unmodifiable?: string | undefined };

// The title that prefills a rename. Firefox's search ignores case and a trailing slash, so the address is checked again.
// A managed bookmark cannot be renamed, so it gives its title only when no other bookmark has the address.
export function title_for_address(nodes: readonly TitledNode[], url: string): string | undefined {
  const here = nodes.filter((node) => node.url === url && node.type !== "folder");
  return (here.find((node) => node.unmodifiable === undefined) ?? here[0])?.title;
}
