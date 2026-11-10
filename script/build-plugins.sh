#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
for plugin in markdown svg html panorama sticky-note; do
    npm --prefix "plugins/canvas/$plugin" run build
done
