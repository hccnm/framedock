#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
npm --prefix web ci --legacy-peer-deps
npm --prefix canvas-agent ci
npm --prefix desktop ci
npm --prefix plugins/canvas/sdk ci
for plugin in markdown svg html panorama sticky-note; do
    npm --prefix "plugins/canvas/$plugin" ci
done
