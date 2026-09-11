const { performance } = require('node:perf_hooks');
const { searchLauncherResults } = require('../launcher/domain');
const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `note:${i}`, title: `Project note ${i}`, subtitle: '产品与开发', keywords: [`项目说明 ${i} ${'本地资料 '.repeat(50)}`] }));
const queries = ['Project', 'note 99', '项目', 'pnt', 'missing'];
function percentile(values, p) { return [...values].sort((a,b) => a-b)[Math.ceil(values.length*p)-1]; }
const start = performance.now(); searchLauncherResults(rows, 'Project'); const coldMs = performance.now()-start;
const times = [];
for (let i=0; i<200; i++) { const before = performance.now(); searchLauncherResults(rows, queries[i%queries.length]); times.push(performance.now()-before); }
console.log(JSON.stringify({ platform:process.platform, node:process.version, dataset:1000, samples:times.length, coldMs, p50Ms:percentile(times,.5), p95Ms:percentile(times,.95), maxMs:Math.max(...times), scope:'Pure domain search; excludes IPC, localStorage, DOM, application scanning and OS window activation.' }, null, 2));
