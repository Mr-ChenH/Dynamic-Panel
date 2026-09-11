'use strict';
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  const result = request.type === 'execute'
    ? { id: 'done', title: '已转换', action: { type: 'copy-text', text: request.query.toUpperCase() || 'HELLO' } }
    : { id: 'uppercase', title: request.query.toUpperCase() || 'HELLO', subtitle: 'Enter 转换并复制', action: { type: 'execute' } };
  process.stdout.write(JSON.stringify({ type: 'result', requestId: request.requestId, items: [result] }) + '\n');
});
