// Firefox 149 added `tabs.Tab.splitViewId`, which the bundled `@types/firefox-webext-browser` does not declare yet.
// -1 (`SPLIT_VIEW_ID_NONE`) means the tab is in no split view. The two tabs of a split view share one id.
declare namespace browser.tabs {
  interface Tab {
    splitViewId?: number | undefined;
  }
}
