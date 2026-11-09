#!/usr/bin/env bash
# Install the CLI and guide Claude Code / Codex Skill installation.
set -euo pipefail
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' ; then
  echo 'WDB requires Node.js >=22 and npm. Install Node 24 LTS from https://nodejs.org/ then rerun.' >&2
  exit 1
fi
WDB_INSTALL_TMP=$(mktemp -d "${TMPDIR:-/tmp}/wdb-install.XXXXXXXX")
trap 'rm -rf -- "$WDB_INSTALL_TMP"' EXIT
node - "$WDB_INSTALL_TMP/install-skill.cjs" <<'NODE'
const fs=require('node:fs');
(async()=>{
  const url='https://raw.githubusercontent.com/guoxiucai/wdb/main/scripts/install-skill.js';
  const r=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error(`Download failed: HTTP ${r.status} (${url})`);
  const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>1024*1024)throw Error('Installer exceeds size limit');
  fs.writeFileSync(process.argv[2],bytes,{flag:'wx',mode:0o600});
})().catch(e=>{console.error(e.message);process.exitCode=1;});
NODE
node "$WDB_INSTALL_TMP/install-skill.cjs" "$@"
