#!/bin/sh
set -eu
umask 022
SOURCE_ROOT=$(CDPATH= cd -P -- "$(dirname -- "$0")/.." && pwd)
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo 'Build and verify on an Apple Silicon Mac.' >&2; exit 1
fi
OUTPUT=${1:-$SOURCE_ROOT/dist/wdb-client-macos-arm64}
mkdir -p "$(dirname -- "$OUTPUT")"
OUTPUT_PARENT=$(CDPATH= cd -P -- "$(dirname -- "$OUTPUT")" && pwd)
OUTPUT=$OUTPUT_PARENT/$(basename -- "$OUTPUT")
if [ -e "$OUTPUT" ] || [ -L "$OUTPUT" ]; then
  echo "Output already exists; move it aside or choose another directory: $OUTPUT" >&2; exit 1
fi
NODE_VERSION=24.15.0
NODE_ARCHIVE=node-v$NODE_VERSION-darwin-arm64.tar.gz
NODE_SHA256=372331b969779ab5d15b949884fc6eaf88d5afe87bde8ba881d6400b9100ffc4
ARCHIVE=${WDB_NODE_ARCHIVE:-$SOURCE_ROOT/.runtime/$NODE_ARCHIVE}
if [ ! -f "$ARCHIVE" ]; then
  if [ -n "${WDB_NODE_ARCHIVE:-}" ]; then echo "Archive not found: $ARCHIVE" >&2; exit 1; fi
  mkdir -p "$(dirname -- "$ARCHIVE")"
  DOWNLOAD=$(mktemp "$ARCHIVE.XXXXXX")
  trap 'rm -f "$DOWNLOAD"' EXIT HUP INT TERM
  curl --fail --location --retry 2 --output "$DOWNLOAD" "https://nodejs.org/download/release/v$NODE_VERSION/$NODE_ARCHIVE"
  ACTUAL=$(shasum -a 256 "$DOWNLOAD"); ACTUAL=${ACTUAL%% *}
  [ "$ACTUAL" = "$NODE_SHA256" ] || { echo 'Node archive checksum mismatch.' >&2; exit 1; }
  mv "$DOWNLOAD" "$ARCHIVE"
  trap - EXIT HUP INT TERM
fi
ACTUAL=$(shasum -a 256 "$ARCHIVE"); ACTUAL=${ACTUAL%% *}
[ "$ACTUAL" = "$NODE_SHA256" ] || { echo 'Node archive checksum mismatch.' >&2; exit 1; }
STAGE=$(mktemp -d "$OUTPUT_PARENT/.wdb-client.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT HUP INT TERM
mkdir -p "$STAGE/runtime" "$STAGE/src" "$STAGE/bin" "$STAGE/scripts" "$STAGE/docs" "$STAGE/skills"
tar -xzf "$ARCHIVE" -C "$STAGE/runtime" --strip-components 2 "node-v$NODE_VERSION-darwin-arm64/bin/node"
tar -xOf "$ARCHIVE" "node-v$NODE_VERSION-darwin-arm64/LICENSE" > "$STAGE/runtime/NODE-LICENSE.txt"
for FILE in cli.js client-transport.js device-id.js client-stream.js stream-channel.js stream-flow.js stream-protocol.js stream-tcp.js forward-client.js terminal-client.js; do cp "$SOURCE_ROOT/src/$FILE" "$STAGE/src/"; done
node "$SOURCE_ROOT/scripts/copy-ws.js" "$STAGE"
cp "$SOURCE_ROOT/package.json" "$STAGE/"
cp "$SOURCE_ROOT/bin/wdb" "$STAGE/bin/"
for FILE in validate-lan.js verify-package.js; do cp "$SOURCE_ROOT/scripts/$FILE" "$STAGE/scripts/"; done
cp -R "$SOURCE_ROOT/skills/wdb" "$STAGE/skills/"
cp "$SOURCE_ROOT"/docs/*.md "$STAGE/docs/"
cp "$SOURCE_ROOT/docs/MACOS-CLIENT.md" "$STAGE/README.md"
chmod 755 "$STAGE" "$STAGE/bin/wdb" "$STAGE/runtime/node"
"$STAGE/runtime/node" - "$SOURCE_ROOT" "$STAGE" "$NODE_SHA256" <<'JS'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const [source, output, archiveSha256] = process.argv.slice(2);
const git = (...args) => execFileSync('/usr/bin/git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
const metadata = {
  product: 'wdb', version: JSON.parse(fs.readFileSync(path.join(source, 'package.json'))).version,
  protocolVersion: 1, kind: 'Client', platform: process.platform, architecture: process.arch,
  nodeVersion: process.version, nodeArchiveSha256: archiveSha256,
  sourceCommit: git('rev-parse', 'HEAD'), sourceDirty: !!git('status', '--porcelain'), builtAt: new Date().toISOString()
};
fs.writeFileSync(path.join(output, 'BUILD-INFO.json'), JSON.stringify(metadata, null, 2) + '\n');
const lines = [];
function walk(dir) {
  for (const entry of fs.readdirSync(path.join(output, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const relative = path.posix.join(dir, entry.name), file = path.join(output, relative);
    if (entry.isDirectory()) walk(relative);
    else if (entry.isFile()) lines.push(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') + '  ' + relative);
    else throw Error('Unexpected package entry: ' + relative);
  }
}
walk(''); fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
JS
"$STAGE/runtime/node" "$STAGE/scripts/verify-package.js" "$STAGE"
# Claim the destination exclusively, including against another concurrent build.
mkdir "$OUTPUT"
mv "$STAGE"/* "$OUTPUT/"
rmdir "$STAGE"
trap - EXIT HUP INT TERM
echo "Built $OUTPUT"
