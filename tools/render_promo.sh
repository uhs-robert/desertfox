#!/usr/bin/env bash
# Renders assets/promo/*.png from docs/images/desertfox-keycap.svg.
# Needs rsvg-convert (librsvg) and the DejaVu Sans Bold font; another font changes the text width and so the layout.
set -euo pipefail
cd "$(dirname "$0")/.."

keycap=docs/images/desertfox-keycap.svg
out=assets/promo
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# render width height keycap_size left_edge name: the keycap and the name sit side by side on a sand band with a terracotta bar.
render() {
  local w=$1 h=$2 k=$3 x=$4 name=$5
  cat > "$work/$name.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="$w" height="$h" viewBox="0 0 $w $h"><rect width="$w" height="$h" fill="#f4e4c1"/><rect y="$((h - h / 20))" width="$w" height="$((h / 20))" fill="#c8553a"/>
<svg x="$x" y="$(((h - k) / 2 - 10))" width="$k" height="$k" viewBox="0 0 96 96">$(sed -e 's/<svg[^>]*>//' -e 's#</svg>##' "$keycap")</svg>
<text x="$((x + k + k / 8))" y="$((h / 2 + k / 6 - 10))" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="$((k * 45 / 100))" fill="#3b2417">DesertFox</text></svg>
SVG
  rsvg-convert "$work/$name.svg" -o "$out/$name.png"
}

render 1280 640 260 150 social-preview
render 1400 560 336 84 amo-promo
