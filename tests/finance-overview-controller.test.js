const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../renderer/finance-overview-controller.js'), 'utf8');
const window = {};
vm.runInNewContext(source, { window });

function createView() {
  const elements = { overviewMarketSummaries: { innerHTML: '' } };
  const controller = window.NotchFinanceOverview.createController({
    getState: () => ({}),
    getElements: () => elements,
    overviewMarkets: (result) => result.markets,
    emptyState: (title) => title,
    escapeHtml: (value) => String(value),
    providerStateLabel: (market) => market.state,
    errorLabel: (error) => error,
    formatCompact: (value) => `compact:${value}`,
    formatPrice: (value, currency) => `${value.toFixed(2)} ${currency}`,
    formatQuotePrice: () => 'quote',
    formatPercent: (value) => `${value}%`,
    changeClass: (value) => value > 0 ? 'positive' : 'negative',
    marketLabel: (market) => market,
  });
  return { controller, elements };
}

test('finance overview renders the Shanghai Composite benchmark for A shares', () => {
  const { controller, elements } = createView();
  controller.renderMarketSummaries({ markets: [{ market: 'cn', label: 'A 股', state: 'available', benchmark: '上证指数', value: 3200, changePercent: 1, provider: '东方财富' }] }, []);
  assert.match(elements.overviewMarketSummaries.innerHTML, /A 股 · 上证指数/);
  assert.match(elements.overviewMarketSummaries.innerHTML, /3200\.00 CNY/);
  assert.match(elements.overviewMarketSummaries.innerHTML, /1%/);
});
