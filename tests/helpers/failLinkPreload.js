// tests/helpers/failLinkPreload.js
// Used with `node --require` for the throw-away second backend of Module 42 ONLY. While the flag file named in
// RT42_FAIL_LINK_FLAG exists, fs.promises.link() fails like a link across volumes (EXDEV) would; otherwise it behaves normally.
// This lets the test prove the "could not make a named link -> use the stored file path" fallback without any hook in the app.
const fs = require('fs');
const flag = process.env.RT42_FAIL_LINK_FLAG;
const realLink = fs.promises.link;
fs.promises.link = async function (...args) {
  if (flag && fs.existsSync(flag)) {
    const err = new Error('EXDEV: cross-device link not permitted (simulated by the regression test)');
    err.code = 'EXDEV';
    throw err;
  }
  return realLink.apply(this, args);
};
