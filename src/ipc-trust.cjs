'use strict';
const path = require('node:path');
const { fileURLToPath } = require('node:url');
function isTrustedShellSender(event, webContents, shellFile) {
  if (!webContents || event.sender !== webContents || event.senderFrame !== webContents.mainFrame) return false;
  try {
    const url = new URL(event.senderFrame.url);
    if (url.protocol !== 'file:' || url.hostname || url.search || url.hash) return false;
    // Chromium and Node disagree about encoding '~' in Windows portable paths.
    // Compare exact decoded filesystem paths, NEVER URL prefixes or origins alone.
    const normalize = value => {
      const result = path.resolve(value);
      return process.platform === 'win32' ? result.toLowerCase() : result;
    };
    return normalize(fileURLToPath(url)) === normalize(shellFile);
  } catch { return false; }
}
module.exports = { isTrustedShellSender };
