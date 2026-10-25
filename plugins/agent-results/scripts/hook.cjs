#!/usr/bin/env node
'use strict';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; if (input.length > 4194304) { process.stderr.write('AGENT_RESULTS_CAPTURE_FAILED: oversized hook payload\n'); process.exit(0); } });
process.stdin.on('end', () => {
  try {
    let host = process.argv[2];
    if (!host) {
      const fs = require('node:fs');
      const path = require('node:path');
      const root = fs.realpathSync(path.resolve(__dirname, '..'));
      const matches = candidate => { try { return candidate && fs.realpathSync(candidate) === root; } catch { return false; } };
      if (matches(process.env.PLUGIN_ROOT) && matches(process.env.CLAUDE_PLUGIN_ROOT)) host = 'codex';
      else if (!process.env.PLUGIN_ROOT && matches(process.env.CLAUDE_PLUGIN_ROOT)) host = 'claude';
      else throw new Error('Native host proof unavailable; use an explicit codex|claude adapter');
    }
    const output = require('./host.cjs').hook(host, JSON.parse(input));
    process.stdout.write(JSON.stringify(output) + '\n');
  } catch (error) {
    // Visible collection failure; never block or continue the user's task.
    process.stderr.write(`AGENT_RESULTS_CAPTURE_FAILED: ${error.message}\n`);
    process.stdout.write(JSON.stringify({ systemMessage: '실행 결과 수집에 실패했습니다. agent-results 기록의 누락 여부를 확인해 주세요.' }) + '\n');
  }
});
