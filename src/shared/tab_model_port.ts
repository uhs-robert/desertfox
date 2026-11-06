// The port names of the live tab model. The plain name states no privacy, so a page with no sender tab (a sidebar)
// connects as `:normal` or `:private`: the page knows its own context, and the background cannot read it from such a port.
export const TAB_MODEL_PORT_NAME = "desertfox_tab_model";
export const TAB_MODEL_PORT_NORMAL = `${TAB_MODEL_PORT_NAME}:normal`;
export const TAB_MODEL_PORT_PRIVATE = `${TAB_MODEL_PORT_NAME}:private`;
