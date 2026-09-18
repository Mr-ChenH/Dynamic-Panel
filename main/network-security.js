function createNetworkSecurity({ dns, https, readable, isPrivateAddress }) {
  async function validatePublicHttpUrl(value) {
    let url;
    try {
      url = new URL(value);
    } catch (error) {
      return null;
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase();
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.local')) return null;
    let addresses;
    try {
      addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    } catch (error) {
      return null;
    }
    if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) return null;
    return url;
  }

  async function resolvePinnedAIEndpoint(value) {
    let url;
    try { url = new URL(value); } catch (error) { return null; }
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase();
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.local')) return null;
    let addresses;
    try { addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true }); }
    catch (error) { return null; }
    const publicAddresses = addresses.filter((item) => !isPrivateAddress(item.address));
    if (!publicAddresses.length || publicAddresses.length !== addresses.length) return null;
    return { url: url.toString(), address: publicAddresses[0].address, family: publicAddresses[0].family };
  }

  function fetchPinnedAIEndpoint(endpoint, options = {}) {
    if (!endpoint || typeof endpoint !== 'object' || !endpoint.url || !endpoint.address) {
      return fetch(String(endpoint || ''), options);
    }
    const url = new URL(endpoint.url);
    return new Promise((resolve, reject) => {
      const request = https.request({
        protocol: 'https:',
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: options.method || 'GET',
        headers: options.headers,
        servername: url.hostname,
        lookup: (_hostname, lookupOptions, callback) => {
          if (lookupOptions?.all) callback(null, [{ address: endpoint.address, family: endpoint.family }]);
          else callback(null, endpoint.address, endpoint.family);
        },
      }, (response) => {
        const headers = { get: (name) => response.headers[String(name || '').toLowerCase()] || null };
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode || 0,
          headers,
          body: readable.toWeb(response),
        });
      });
      request.once('error', reject);
      const onAbort = () => request.destroy(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (options.signal) {
        if (options.signal.aborted) { onAbort(); return; }
        options.signal.addEventListener('abort', onAbort, { once: true });
        request.once('close', () => options.signal.removeEventListener('abort', onAbort));
      }
      if (options.body) request.write(options.body);
      request.end();
    });
  }

  return { validatePublicHttpUrl, resolvePinnedAIEndpoint, fetchPinnedAIEndpoint };
}

module.exports = { createNetworkSecurity };
