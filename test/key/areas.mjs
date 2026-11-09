// Which key-test pieces a src change can affect. A src file maps to feature areas, a piece lists the areas it exercises, and a change runs the pieces that share an area.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const key_test_dir = dirname(fileURLToPath(import.meta.url));

export const area_names = ["hints", "caret", "find", "whichkey", "cmdline", "help", "newtab", "tabs", "scroll", "config", "engines", "bundles", "keys", "ui", "toolbar"];

// Key path and command contract: any change here can break any piece.
const shared_files = [
  "src/manifest.json",
  "src/background/{availability,browser_deps,main,refusal,router,slots,startup}.ts",
  "src/commands/{command,copy,mode}.ts",
  "src/content/{cancelled_keys,context,editable,handler_map,invocation_args,key_flow,link_escape,main,mode_state,page_mode,run_content,shadow,site_rule}.ts",
  "src/content/handlers/{copy,focus,mode,stop,types}.ts",
  "src/shared/{command,index,load_commands,messages}.ts",
  "src/shared/registry/{builtin,define,index}.ts",
];

// First match wins, so order matters: the no-area rule sits before folder globs such as help/**, and find_* before caret/**.
export const area_rules = [
  // Docs and icons carry no behavior a key test reads.
  { globs: ["src/**/README.md", "src/icons/**"], areas: [] },
  // The schema validates the settings the help page edits and the config reads.
  { globs: shared_files, areas: area_names },
  { globs: ["src/content/hints/**", "src/commands/{hint,heading,page}.ts", "src/background/image_actions.ts", "src/content/handlers/page.ts"], areas: ["hints"] },
  { globs: ["src/content/run_content.ts", "src/commands/{caret,cmdline,copy,find,heading,help,hint,page,visual}.ts", "src/background/{bundle_loader,command_modules}.ts", "src/content/{bundle_host,bundles}.ts", "src/content/page/**", "src/shared/bundles.ts"], areas: ["bundles"] },
  { globs: ["src/content/caret/find_*.ts", "src/commands/find.ts", "src/background/{find_scan,find_worker,regex_scan}.ts"], areas: ["find"] },
  { globs: ["src/content/caret/**", "src/commands/{caret,visual}.ts"], areas: ["caret"] },
  { globs: ["src/content/whichkey/**", "src/background/list_keys.ts", "src/content/which_key_timer.ts"], areas: ["whichkey"] },
  { globs: ["src/commands/session.ts", "src/background/session_store.ts"], areas: ["cmdline", "tabs"] },
  {
    globs: ["src/cmdline/**", "src/commands/{cmdline,history,bookmark,open_target}.ts", "src/background/{cmdline_service,complete_items}.ts", "src/shared/{setting_completion,score}.ts"],
    areas: ["cmdline"],
  },
  {
    globs: [
      "src/help/**",
      "src/commands/{help,help_tab,settings,native}.ts",
      "src/background/{open_help,native_client}.ts",
      "src/shared/{settings_docs,settings_schema,settings_table,setting_list,table_constants,native_host}.ts",
    ],
    areas: ["help"],
  },
  { globs: ["src/newtab/**"], areas: ["newtab"] },
  // The storage watcher feeds the new tab and help redraws and the theme sheet of every content surface.
  { globs: ["src/shared/storage_watch.ts"], areas: ["help", "newtab", "ui"] },
  {
    globs: ["src/background/{tab_*,previous_tab,window_focus,count}.ts", "src/commands/{tab,window,url,url_build,browser,open}.ts", "src/shared/{tab_model_port,container_store}.ts"],
    areas: ["tabs"],
  },
  { globs: ["src/content/{scroll_*,align_target}.ts", "src/content/handlers/{scroll,align}.ts", "src/commands/{scroll,zoom}.ts"], areas: ["scroll"] },
  {
    globs: [
      "src/background/{config_*,autoconfig_mirror,snippets,storage_keys,first_install,load_log,settings_message,reload}.ts",
      "src/commands/config.ts",
      "src/shared/{config_build/**,theme/**,themes,theme_names,default_settings,config,match_pattern,site_key}.ts",
      "src/shared/registry/{check_args,check_shape,params,parse_binding,commands_file,print_command,summary,usage,command_line}.ts",
    ],
    areas: ["config"],
  },
  { globs: ["src/shared/engines/**", "src/commands/engine.ts"], areas: ["engines"] },
  { globs: ["src/background/{default_keymap,keymap_merge,compile,repeat_memory}.ts", "src/shared/{keys/**,keymap,prefix_tree,layers,invocation}.ts"], areas: ["keys"] },
  { globs: ["src/popup/**", "src/background/toolbar.ts"], areas: ["toolbar"] },
  { globs: ["src/content/{ui/**,toast,ui_proxy,surface,mode_indicator,mode_label,mode_report,badge_hosts}.ts"], areas: ["ui"] },
];

// Supports ** (any depth), * (within one path part) and {a,b}. Nothing else is special.
function glob_to_regex(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (glob.startsWith("**/", i)) {
      out += "(?:.*/)?";
      i += 2;
    } else if (glob.startsWith("**", i)) {
      out += ".*";
      i += 1;
    } else if (ch === "*") out += "[^/]*";
    else if (ch === "{") out += "(?:";
    else if (ch === "}") out += ")";
    else if (ch === ",") out += glob.slice(0, i).lastIndexOf("{") > glob.slice(0, i).lastIndexOf("}") ? "|" : ",";
    else out += ch.replace(/[.+?^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

const compiled_rules = area_rules.map((rule) => ({ ...rule, patterns: rule.globs.map(glob_to_regex) }));

// The areas of one src path, or null when no rule matches (the unit test fails on that).
export function areas_of_file(path) {
  const rule = compiled_rules.find((candidate) => candidate.patterns.some((pattern) => pattern.test(path)));
  return rule ? rule.areas : null;
}

// Reads the one-line `export const areas = [...]` as text, so listing the areas loads no piece and no harness.
export function read_piece_areas() {
  const pieces = new Map();
  for (const file of readdirSync(key_test_dir).filter((name) => /^p\d+_.*\.mjs$/.test(name)).sort()) {
    const match = /^export const areas = (\[.*\]);$/m.exec(readFileSync(join(key_test_dir, file), "utf8"));
    pieces.set(file.replace(/\.mjs$/, ""), match ? JSON.parse(match[1]) : []);
  }
  return pieces;
}

// A change to these runs every piece: they are the test machinery and the build the pieces load.
const harness_globs = ["test/key/{harness,run,server,rdp,timings,areas,session}.mjs", "test/key/{launch_firefox.sh,user.js,keyboard.py,us.xkb}", "test/key/config/**", "tools/{build,write_commands_json}.mjs", "tools/render_docs.ts"];
const harness_patterns = harness_globs.map(glob_to_regex);

// Pieces to run for a list of changed paths. A changed piece file selects that piece, a harness file selects every piece, and so does an unplaced src file (the safe side). Other paths are ignored.
export function select_pieces(changed_paths, piece_areas) {
  const src_paths = changed_paths.filter((path) => path.startsWith("src/"));
  const piece_files = changed_paths.map((path) => /^test\/key\/(p\d+_.*)\.mjs$/.exec(path)?.[1]).filter((name) => piece_areas.has(name));
  const harness_changed = changed_paths.some((path) => harness_patterns.some((pattern) => pattern.test(path)));
  const hit = new Set();
  for (const path of src_paths) for (const area of areas_of_file(path) ?? area_names) hit.add(area);
  const chosen = ([name, areas]) => harness_changed || piece_files.includes(name) || areas.some((area) => hit.has(area));
  const pieces = [...piece_areas].filter(chosen).map(([name]) => name);
  return { src_paths, harness_changed, piece_files, areas: area_names.filter((area) => hit.has(area)), pieces };
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
}

// With head, the commits base..head. Without it, everything since the merge base: commits, working tree and new files.
function changed_paths_since(base, head) {
  if (head) return git("diff", "--name-only", "--no-renames", `${base}...${head}`);
  const merge_base = git("merge-base", base, "HEAD")[0];
  return [...git("diff", "--name-only", "--no-renames", merge_base), ...git("ls-files", "--others", "--exclude-standard", "--", "src", "test/key", "tools")];
}

// node test/key/areas.mjs <base> [head]: prints the choice on stderr and the comma-separated pieces on stdout (empty for none).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base = "origin/main", head] = process.argv.slice(2);
  const piece_areas = read_piece_areas();
  const { src_paths, harness_changed, piece_files, areas, pieces } = select_pieces(changed_paths_since(base, head), piece_areas);
  if (pieces.length === 0 && src_paths.length === 0) console.error(`key-test-changed: no src, piece or harness change against ${base}, so no piece runs.`);
  else {
    console.error(`key-test-changed: against ${base}: ${src_paths.length} src file(s), ${piece_files.length} piece file(s), harness ${harness_changed ? "changed" : "unchanged"}; areas: ${areas.join(", ") || "none"}`);
    console.error(`key-test-changed: ${pieces.length} of ${piece_areas.size} pieces: ${pieces.join(", ")}`);
    console.log(pieces.join(","));
  }
}
