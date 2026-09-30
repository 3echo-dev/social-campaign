#!/usr/bin/env node

// The old entry point is retained so stale instructions fail clearly.
// Platform-result imports are not part of the production-only build and this command never
// reads an export or creates a metrics file.

const UNSUPPORTED = 'Platform metrics import is not included in this build. Existing metrics remain readable; no files were written.';

function main() {
  console.error('UNSUPPORTED: ' + UNSUPPORTED);
  process.exit(4);
}

module.exports = { UNSUPPORTED, main };
if (require.main === module) main();
