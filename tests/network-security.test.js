const test = require('node:test');
const assert = require('node:assert/strict');
const { createNetworkSecurity } = require('../main/network-security');

function createSecurity(addressesByHost) {
  return createNetworkSecurity({
    dns: {
      promises: {
        lookup: async (hostname) => addressesByHost[hostname] || [],
      },
    },
    https: { request() { throw new Error('not used in validation tests'); } },
    readable: { toWeb() { throw new Error('not used in validation tests'); } },
    isPrivateAddress(address) {
      return address === '127.0.0.1' || address.startsWith('10.') || address.startsWith('192.168.');
    },
  });
}

test('public URL validation rejects unsafe protocols, credentials and private DNS results', async () => {
  const security = createSecurity({
    'public.test': [{ address: '203.0.113.10', family: 4 }],
    'private.test': [{ address: '192.168.1.20', family: 4 }],
  });

  assert.equal(await security.validatePublicHttpUrl('file:///tmp/a'), null);
  assert.equal(await security.validatePublicHttpUrl('https://user:pass@public.test/'), null);
  assert.equal(await security.validatePublicHttpUrl('http://localhost/'), null);
  assert.equal(await security.validatePublicHttpUrl('http://private.test/'), null);
  assert.equal((await security.validatePublicHttpUrl('https://public.test/path')).hostname, 'public.test');
});

test('pinned endpoint resolution rejects mixed public and private DNS answers', async () => {
  const security = createSecurity({
    'public.test': [{ address: '203.0.113.10', family: 4 }],
    'mixed.test': [
      { address: '203.0.113.11', family: 4 },
      { address: '10.0.0.4', family: 4 },
    ],
  });

  const endpoint = await security.resolvePinnedAIEndpoint('https://public.test/v1');
  assert.deepEqual(endpoint, {
    url: 'https://public.test/v1',
    address: '203.0.113.10',
    family: 4,
  });
  assert.equal(await security.resolvePinnedAIEndpoint('https://mixed.test/v1'), null);
});
