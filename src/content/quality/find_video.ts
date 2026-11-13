// Looks for a video in a document or an open shadow root, without making a wrapper for every element.

// The names of the elements that are not custom elements and need no look for a shadow root. The `:not` selector below returns only the other elements, so a page of 20,000 plain elements costs the content script nothing but the match.
const PLAIN_ELEMENTS =
  "html,head,body,a,abbr,address,area,article,aside,audio,b,base,bdi,bdo,blockquote,br,button,canvas,caption,cite,code,col,colgroup,data,datalist,dd,del,details,dfn,dialog,div,dl,dt,em,embed,fieldset,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,header,hgroup,hr,i,iframe,img,input,ins,kbd,label,legend,li,link,main,map,mark,menu,meta,meter,nav,noscript,object,ol,optgroup,option,output,p,picture,pre,progress,q,rp,rt,ruby,s,samp,script,section,select,slot,small,source,span,strong,style,sub,summary,sup,table,tbody,td,template,textarea,tfoot,th,thead,time,title,tr,track,u,ul,var,wbr,svg,g,path,circle,rect,line,polyline,polygon,ellipse,text,tspan,defs,use,symbol";

// An open shadow root hides its video from a document query, and media events do not cross it. Only a custom element (a hyphenated name) is searched for one.
export function has_video_in(root: ParentNode): boolean {
  if (root.querySelector("video") !== null) return true;
  for (const element of Array.from(root.querySelectorAll(`:not(${PLAIN_ELEMENTS})`))) {
    if (element.localName.includes("-") && element.shadowRoot !== null && has_video_in(element.shadowRoot)) return true;
  }
  return false;
}

// The handles the drivers match on (`youtube.ts`, `hls.ts`), so a frame with a site player and no video element of its own still counts. `page` is the window as the page sees it.
export type PlayerHandlePage = { document: { getElementById: (id: string) => unknown }; html5player?: { hlsobj?: { levels?: { length?: unknown } } } };

export function has_player_handle(page: PlayerHandlePage): boolean {
  const player = page.document.getElementById("movie_player") as { getAvailableQualityLevels?: unknown } | null;
  return typeof player?.getAvailableQualityLevels === "function" || typeof page.html5player?.hlsobj?.levels?.length === "number";
}
