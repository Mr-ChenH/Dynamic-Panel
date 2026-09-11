'use strict';
// Internal bootstrap: extensions do not need to implement the ready handshake.
const entry = process.argv[2];
const requestId = process.argv[3];
process.argv = [process.argv[0], entry];
process.stdout.write(JSON.stringify({ type: 'ready', requestId }) + '\n');
require(entry);
