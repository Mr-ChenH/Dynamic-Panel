const MAX_HISTORY_POINTS = 180;
const EASTMONEY_MAX_ROWS = 6_000;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boundedText(value, limit) {
  return String(value ?? '').slice(0, limit);
}

function parseTencentQuotes(text) {
  const rows = [];
  const source = boundedText(text, 2 * 1024 * 1024);
  const pattern = /v_(sh|sz|bj)(\d{6})\s*=\s*"([^"]*)"/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const values = match[3].split('~');
    if (values.length < 38) continue;
    rows.push({
      symbol: `${match[2]}.${match[1].toUpperCase()}`,
      name: values[1],
      price: values[3],
      previousClose: values[4],
      changeAmount: values[31],
      changePercent: values[32],
      high: values[33],
      low: values[34],
      timestamp: /^\d{14}$/.test(values[30]) ? `${values[30].slice(0, 4)}-${values[30].slice(4, 6)}-${values[30].slice(6, 8)} ${values[30].slice(8, 10)}:${values[30].slice(10, 12)}:${values[30].slice(12, 14)}` : '',
      volume: values[6] === '' ? null : Number(values[6]) * 100,
      amount: values[37] === '' ? null : Number(values[37]) * 10_000,
    });
  }
  return rows;
}

function parseSinaQuotes(text) {
  const rows = [];
  const source = boundedText(text, 2 * 1024 * 1024);
  const pattern = /hq_str_(sh|sz|bj)(\d{6})\s*=\s*"([^"]*)"/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const values = match[3].split(',');
    if (values.length < 12) continue;
    const dateIndex = values.findIndex((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
    const date = boundedText(dateIndex >= 0 ? values[dateIndex] : '', 16);
    const time = boundedText(dateIndex >= 0 ? values[dateIndex + 1] : '', 16);
    rows.push({
      symbol: `${match[2]}.${match[1].toUpperCase()}`,
      name: values[0],
      price: values[3],
      previousClose: values[2],
      high: values[4],
      low: values[5],
      volume: values[8],
      amount: values[9],
      timestamp: date && time ? `${date} ${time}` : '',
    });
  }
  return rows;
}

function parseEastmoneyKlines(payload) {
  if (!payload || typeof payload !== 'object' || (payload.rc !== undefined && Number(payload.rc) !== 0)) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  if (!Array.isArray(data.klines)) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
  return data.klines.slice(-MAX_HISTORY_POINTS * 2).map((value) => {
    const fields = boundedText(value, 512).split(',');
    return { at: fields[0], close: fields[2] };
  }).filter((row) => row.at && finiteNumber(row.close) !== null);
}

function eastmoneyScaled(value) {
  const number = finiteNumber(value);
  return number === null ? null : number / 100;
}

function parseEastmoneyQuotes(payload) {
  if (!payload || typeof payload !== 'object' || (payload.rc !== undefined && Number(payload.rc) !== 0)) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  if (!Array.isArray(data.diff) && (!data.diff || typeof data.diff !== 'object')) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
  const rawRows = Array.isArray(data.diff) ? data.diff : Object.values(data.diff);
  return rawRows.slice(0, EASTMONEY_MAX_ROWS).map((row) => {
    const value = row && typeof row === 'object' ? row : {};
    const code = boundedText(value.f12, 6);
    const market = finiteNumber(value.f13) === 1 ? 'SH' : finiteNumber(value.f13) === 2 || /^(?:4|8|92)/.test(code) ? 'BJ' : 'SZ';
    return {
      symbol: `${code}.${market}`,
      name: value.f14,
      price: eastmoneyScaled(value.f2),
      changePercent: eastmoneyScaled(value.f3),
      changeAmount: eastmoneyScaled(value.f4),
      volume: value.f5,
      amount: value.f6,
      high: eastmoneyScaled(value.f15),
      low: eastmoneyScaled(value.f16),
      timestamp: finiteNumber(value.f124),
    };
  }).filter((row) => /^\d{6}\.(?:SH|SZ|BJ)$/.test(row.symbol));
}

module.exports = {
  parseTencentQuotes,
  parseSinaQuotes,
  parseEastmoneyKlines,
  parseEastmoneyQuotes,
};
