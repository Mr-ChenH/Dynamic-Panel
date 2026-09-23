const net = require('node:net');

function normalizeAddresses(value) {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  return rows.map((row) => typeof row === 'string' ? row : row && row.address).filter(Boolean);
}

function isLoopback(address) {
  const value = String(address || '').toLowerCase().split('%')[0];
  return value === '::1' || value.startsWith('127.');
}

function isPrivateOrReserved(address) {
  const value = String(address || '').toLowerCase().split('%')[0];
  if (isLoopback(value)) return true;
  if (net.isIPv4(value)) {
    const [a, b, c] = value.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 0 && c === 2))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113);
  }
  if (net.isIPv6(value)) {
    if (value.startsWith('::ffff:')) return isPrivateOrReserved(value.slice(7));
    return value === '::' || value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value) ||
      value.startsWith('ff') || value.startsWith('2001:db8:');
  }
  return true;
}

async function validateSyncBaseUrl(input, { lookup, allowLoopbackHttp = false } = {}) {
  let url;
  try { url = new URL(input); } catch (error) { throw new TypeError('invalid_sync_url'); }
  if (url.username || url.password || url.search || url.hash) throw new TypeError('sync_url_contains_credentials_or_parameters');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TypeError('sync_url_requires_http_transport');
  if (url.pathname !== '/' && url.pathname !== '') throw new TypeError('sync_url_must_be_origin');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  let addresses;
  if (net.isIP(hostname)) addresses = [hostname];
  else {
    if (typeof lookup !== 'function') throw new TypeError('dns_lookup_required');
    addresses = normalizeAddresses(await lookup(hostname, { all: true, verbatim: true }));
  }
  if (addresses.length === 0) throw new TypeError('sync_host_unresolved');
  const allLoopback = addresses.every(isLoopback);
  const localhostName = hostname === 'localhost' || hostname.endsWith('.localhost');
  if (url.protocol === 'http:') {
    if (!allowLoopbackHttp || (!localhostName && !net.isIP(hostname)) || !allLoopback) throw new TypeError('sync_http_requires_explicit_loopback_dev');
  } else if (addresses.some(isPrivateOrReserved) && !(allowLoopbackHttp && allLoopback && (localhostName || net.isIP(hostname)))) {
    throw new TypeError('sync_host_is_not_public');
  }
  url.pathname = '/';
  return Object.freeze({ url: url.toString(), hostname, addresses: Object.freeze([...addresses]), loopback: allLoopback });
}

function assertPinnedAddress(policy, address) {
  if (!policy || !Array.isArray(policy.addresses) || !policy.addresses.includes(address)) throw new TypeError('sync_address_not_pinned');
  if (policy.loopback !== isLoopback(address)) throw new TypeError('sync_address_policy_changed');
  return true;
}

module.exports = { validateSyncBaseUrl, assertPinnedAddress, isLoopback, isPrivateOrReserved };
