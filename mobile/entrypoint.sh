#!/bin/sh
set -eu

if [ ! -x node_modules/.bin/expo ]; then
  npm install
fi

exec "$@"
