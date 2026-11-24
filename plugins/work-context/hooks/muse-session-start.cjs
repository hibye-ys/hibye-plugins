#!/usr/bin/env node
'use strict'
// Muse refuses two hook capabilities sharing one source file, so each event gets this thin entry.
process.argv[2] = 'session-start'
require('./muse-hook.cjs')
