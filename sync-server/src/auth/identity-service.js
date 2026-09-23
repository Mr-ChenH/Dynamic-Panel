import { createHmac } from 'node:crypto';
import { errors } from '../errors.js';
import {
  clientKey as generateClientKey,
  hashSecret,
  keyedFingerprint,
  normalizeName,
  opaqueToken,
  sessionFingerprint,
  shortId,
  verifySecret
} from './crypto.js';

const ACTIVE_LIMIT = 10;
const KEY_PREFIX = 'dpk_v1_';

function iso(value) { return new Date(value).toISOString(); }
function publicAccount(row) {
  return { accountId: row.accountId, username: row.username, status: row.status, mustChangePassword: row.mustChangePassword, createdAt: row.createdAt };
}
function publicSpace(row) {
  return { spaceId: row.spaceId, name: row.name, status: row.status, restoreEpoch: row.restoreEpoch, createdAt: row.createdAt, updatedAt: row.updatedAt, recoverableUntil: row.recoverableUntil };
}
function publicClient(row, generations = []) {
  const activeKey = generations.some((key) => !key.revokedAt && (!key.expiresAt || Date.parse(key.expiresAt) > Date.now()));
  return {
    clientId: row.clientId,
    shortId: row.shortId,
    name: row.name,
    status: row.status,
    keyStatus: activeKey ? 'active' : 'revoked',
    binding: { status: row.installationId ? 'bound' : 'unbound', firstConnectedAt: row.firstConnectedAt },
    platform: row.platform,
    appVersion: row.appVersion,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt
  };
}

export class IdentityService {
  constructor({ store, config, clock = () => new Date(), connections = { closeClient() {}, closeAccount() {}, closeSpace() {} } }) {
    this.store = store;
    this.config = config;
    this.clock = clock;
    this.connections = connections;
  }

  now() { return this.clock(); }
  csrfFor(token) { return createHmac('sha256', this.config.cookieSecret).update(`csrf:${token}`).digest('base64url'); }

  async createAccount({ username, password, mustChangePassword = false }) {
    this.assertPassword(password);
    const { displayName, normalizedName } = normalizeName(username);
    if (!displayName || displayName.length > 128) throw errors.invalid();
    return publicAccount(await this.store.createAccount({ username: displayName, normalizedUsername: normalizedName, passwordHash: await hashSecret(password), mustChangePassword }));
  }

  async listAccounts() { return (await this.store.listAccounts()).map(publicAccount); }

  async setAccountStatus(accountId, status, requestId = 'admin') {
    if (!['active', 'disabled', 'deleting'].includes(status)) throw errors.invalid({ field: 'status' });
    const account = await this.store.getAccount(accountId);
    if (!account) throw errors.notFound();
    const authEpoch = account.authEpoch;
    const updated = await this.store.updateAccount(accountId, { status, authEpoch });
    if (status !== 'active') {
      await this.store.revokeAccountSessions(accountId, null, iso(this.now()));
      this.connections.closeAccount(accountId);
    }
    await this.audit({ accountId, actorType: 'admin', action: `account.${status}`, targetType: 'account', targetId: accountId, result: 'success', requestId });
    return publicAccount(updated);
  }

  async disableAccount(accountId, requestId) { return this.setAccountStatus(accountId, 'disabled', requestId); }
  async enableAccount(accountId, requestId) { return this.setAccountStatus(accountId, 'active', requestId); }
  async deleteAccount(accountId, requestId) { return this.setAccountStatus(accountId, 'deleting', requestId); }

  async resetPassword(accountId, password, requestId = 'admin') {
    this.assertPassword(password);
    const account = await this.store.getAccount(accountId);
    if (!account) throw errors.notFound();
    const updated = await this.store.updateAccount(accountId, { passwordHash: await hashSecret(password), mustChangePassword: true, authEpoch: account.authEpoch + 1 });
    await this.store.revokeAccountSessions(accountId, null, iso(this.now()));
    this.connections.closeAccount(accountId);
    await this.audit({ accountId, actorType: 'admin', action: 'account.password_reset', targetType: 'account', targetId: accountId, result: 'success', requestId });
    return publicAccount(updated);
  }

  assertPassword(password) {
    if (typeof password !== 'string' || password.length < this.config.passwordMinLength || password.length > 1024) throw errors.invalid({ field: 'password' });
  }

  async login({ username, password, ipPrefix = null, userAgent = null, requestId }) {
    const normalized = normalizeName(username).normalizedName;
    const account = await this.store.findAccountByUsername(normalized);
    const dummyHash = this.dummyPasswordHash ??= hashSecret('not-a-real-account-password');
    const valid = account ? await verifySecret(account.passwordHash, password) : await verifySecret(await dummyHash, password);
    if (!account || !valid || account.status !== 'active') throw errors.authentication();
    const token = opaqueToken(32);
    const now = this.now();
    const csrfToken = this.csrfFor(token);
    const session = await this.store.createSession({
      accountId: account.accountId,
      tokenFingerprint: sessionFingerprint(token),
      csrfFingerprint: sessionFingerprint(csrfToken),
      authEpoch: account.authEpoch,
      createdAt: iso(now),
      lastSeenAt: iso(now),
      absoluteExpiresAt: iso(now.getTime() + this.config.sessionAbsoluteMs),
      idleExpiresAt: iso(now.getTime() + this.config.sessionIdleMs),
      ipPrefix,
      userAgent: userAgent?.slice(0, 256) ?? null
    });
    await this.audit({ accountId: account.accountId, actorType: 'account', actorId: account.accountId, action: 'session.login', targetType: 'session', targetId: session.sessionId, result: 'success', requestId });
    return { account: publicAccount(account), token, csrfToken, session };
  }

  async authenticateSession(token, { touch = true } = {}) {
    if (!token) throw errors.authentication();
    const session = await this.store.findSessionByFingerprint(sessionFingerprint(token));
    if (!session || session.revokedAt) throw errors.authentication();
    const account = await this.store.getAccount(session.accountId);
    const now = this.now();
    if (!account || account.status !== 'active' || account.authEpoch !== session.authEpoch) throw errors.authentication();
    if (Date.parse(session.absoluteExpiresAt) <= now.getTime() || Date.parse(session.idleExpiresAt) <= now.getTime()) {
      await this.store.updateSession(session.sessionId, { revokedAt: iso(now) });
      throw errors.sessionExpired();
    }
    if (touch) {
      const idleExpiresAt = iso(Math.min(Date.parse(session.absoluteExpiresAt), now.getTime() + this.config.sessionIdleMs));
      Object.assign(session, await this.store.updateSession(session.sessionId, { lastSeenAt: iso(now), idleExpiresAt }));
    }
    return { actorType: 'account', accountId: account.accountId, sessionId: session.sessionId, account, session, token };
  }

  assertCsrf(context, csrfToken, origin) {
    if (origin !== this.config.consoleOrigin || !csrfToken || sessionFingerprint(csrfToken) !== context.session.csrfFingerprint) throw errors.csrf();
  }

  assertRecent(context) {
    if (!context.session.recentAuthAt || Date.parse(context.session.recentAuthAt) + this.config.recentAuthMs <= this.now().getTime()) throw errors.recentAuth();
  }

  async reauthenticate(context, password) {
    if (!await verifySecret(context.account.passwordHash, password)) throw errors.authentication();
    const recentAuthAt = iso(this.now());
    context.session = await this.store.updateSession(context.sessionId, { recentAuthAt });
    return { recentAuthUntil: iso(Date.parse(recentAuthAt) + this.config.recentAuthMs) };
  }

  async logout(context, requestId) {
    await this.store.updateSession(context.sessionId, { revokedAt: iso(this.now()) });
    await this.audit({ accountId: context.accountId, actorType: 'account', actorId: context.accountId, action: 'session.logout', targetType: 'session', targetId: context.sessionId, result: 'success', requestId });
  }

  async listSessions(context) {
    return (await this.store.listSessions(context.accountId)).map((row) => ({ sessionId: row.sessionId, current: row.sessionId === context.sessionId, createdAt: row.createdAt, lastSeenAt: row.lastSeenAt, expiresAt: row.absoluteExpiresAt, revokedAt: row.revokedAt, ipPrefix: row.ipPrefix, userAgent: row.userAgent }));
  }

  async revokeOtherSessions(context) { await this.store.revokeOtherSessions(context.accountId, context.sessionId, iso(this.now())); }

  async changePassword(context, currentPassword, newPassword) {
    if (!await verifySecret(context.account.passwordHash, currentPassword)) throw errors.authentication();
    this.assertPassword(newPassword);
    await this.store.updateAccount(context.accountId, { passwordHash: await hashSecret(newPassword), mustChangePassword: false });
    await this.store.revokeAccountSessions(context.accountId, context.sessionId, iso(this.now()));
  }

  async listSpaces(context) {
    const spaces = await this.store.listSpaces(context.accountId);
    return { spaces: spaces.map(publicSpace), activeCount: spaces.filter((row) => row.status === 'active').length, activeLimit: ACTIVE_LIMIT };
  }

  async createSpace(context, name, requestId) {
    const normalized = this.validName(name);
    const row = await this.store.createSpace(context.accountId, { name: normalized.displayName, normalizedName: normalized.normalizedName }, ACTIVE_LIMIT);
    await this.audit({ accountId: context.accountId, spaceId: row.spaceId, actorType: 'account', actorId: context.accountId, action: 'space.create', targetType: 'space', targetId: row.spaceId, result: 'success', requestId });
    return publicSpace(row);
  }

  async getSpace(context, spaceId) {
    const row = await this.store.getSpace(context.accountId, spaceId);
    if (!row) throw errors.notFound();
    return publicSpace(row);
  }

  async updateSpace(context, spaceId, patch, requestId) {
    const update = {};
    if (patch.name !== undefined) {
      const normalized = this.validName(patch.name);
      update.name = normalized.displayName; update.normalizedName = normalized.normalizedName;
    }
    if (patch.status !== undefined) update.status = patch.status;
    const row = await this.store.updateSpace(context.accountId, spaceId, update, ACTIVE_LIMIT);
    if (patch.status && patch.status !== 'active') this.connections.closeSpace(spaceId);
    await this.audit({ accountId: context.accountId, spaceId, actorType: 'account', actorId: context.accountId, action: 'space.update', targetType: 'space', targetId: spaceId, result: 'success', requestId });
    return publicSpace(row);
  }

  async deleteSpace(context, spaceId, confirmationName, requestId) {
    this.assertRecent(context);
    const row = await this.store.getSpace(context.accountId, spaceId);
    if (!row) throw errors.notFound();
    if (normalizeName(confirmationName).normalizedName !== row.normalizedName) throw errors.invalid({ field: 'confirmationName' });
    const now = this.now();
    const updated = await this.store.updateSpace(context.accountId, spaceId, { status: 'deleting', deletedAt: iso(now), recoverableUntil: iso(now.getTime() + 30 * 86400000) }, ACTIVE_LIMIT);
    this.connections.closeSpace(spaceId);
    await this.audit({ accountId: context.accountId, spaceId, actorType: 'account', actorId: context.accountId, action: 'space.delete', targetType: 'space', targetId: spaceId, result: 'success', requestId });
    return publicSpace(updated);
  }

  async restoreSpace(context, spaceId, requestId) {
    const row = await this.store.getSpace(context.accountId, spaceId);
    if (!row || row.status !== 'deleting' || Date.parse(row.recoverableUntil) <= this.now().getTime()) throw errors.notFound();
    const updated = await this.store.updateSpace(context.accountId, spaceId, { status: 'active', deletedAt: null, recoverableUntil: null, restoreEpoch: row.restoreEpoch + 1 }, ACTIVE_LIMIT);
    await this.audit({ accountId: context.accountId, spaceId, actorType: 'account', actorId: context.accountId, action: 'space.restore', targetType: 'space', targetId: spaceId, result: 'success', requestId });
    return publicSpace(updated);
  }

  async listClients(context, spaceId) {
    await this.getSpace(context, spaceId);
    const rows = await this.store.listClients(context.accountId, spaceId);
    const data = await Promise.all(rows.map(async (row) => publicClient(row, await this.store.listKeyGenerations(context.accountId, spaceId, row.clientId))));
    return { clients: data, activeCount: rows.filter((row) => row.status === 'active').length, activeLimit: ACTIVE_LIMIT };
  }

  async createClient(context, spaceId, name, requestId) {
    this.assertRecent(context);
    await this.getSpace(context, spaceId);
    const normalized = this.validName(name);
    const material = await this.newKeyMaterial(context.account.authEpoch);
    const row = await this.store.createClient(context.accountId, spaceId, { name: normalized.displayName, normalizedName: normalized.normalizedName, shortId: shortId() }, material.generation, ACTIVE_LIMIT);
    await this.audit({ accountId: context.accountId, spaceId, clientId: row.clientId, actorType: 'account', actorId: context.accountId, action: 'client.create', targetType: 'client', targetId: row.clientId, result: 'success', requestId });
    return { ...(await this.clientProjection(row)), clientKey: material.key };
  }

  async updateClient(context, spaceId, clientId, name) {
    const normalized = this.validName(name);
    const row = await this.store.updateClient(context.accountId, spaceId, clientId, { name: normalized.displayName, normalizedName: normalized.normalizedName });
    return this.clientProjection(row);
  }

  async rotateKey(context, spaceId, clientId, overlapSeconds, requestId) {
    this.assertRecent(context);
    const client = await this.requireClient(context.accountId, spaceId, clientId);
    if (client.status !== 'active') throw errors.notFound();
    const now = this.now();
    const generations = (await this.store.listKeyGenerations(context.accountId, spaceId, clientId))
      .filter((row) => !row.revokedAt && (!row.expiresAt || Date.parse(row.expiresAt) > now.getTime()));
    const retirements = generations.map((generation, index) => {
      const keepForOverlap = overlapSeconds > 0 && index === generations.length - 1;
      return { generationId: generation.generationId, patch: keepForOverlap ? { expiresAt: iso(now.getTime() + overlapSeconds * 1000) } : { revokedAt: iso(now) } };
    });
    const material = await this.newKeyMaterial(context.account.authEpoch);
    await this.store.replaceClientKey(context.accountId, spaceId, clientId, {
      retirements,
      generation: { ...material.generation, accountId: context.accountId, spaceId, clientId }
    });
    this.connections.closeClient(clientId);
    await this.audit({ accountId: context.accountId, spaceId, clientId, actorType: 'account', actorId: context.accountId, action: 'client.key_rotate', targetType: 'client', targetId: clientId, result: 'success', requestId });
    return { ...(await this.clientProjection(client)), clientKey: material.key, overlapEndsAt: overlapSeconds ? iso(now.getTime() + overlapSeconds * 1000) : null };
  }

  async revokeClient(context, spaceId, clientId, requestId) {
    this.assertRecent(context);
    const client = await this.requireClient(context.accountId, spaceId, clientId);
    const revokedAt = iso(this.now());
    for (const generation of await this.store.listKeyGenerations(context.accountId, spaceId, clientId)) await this.store.updateKeyGeneration(generation.generationId, { revokedAt });
    const row = await this.store.updateClient(context.accountId, spaceId, clientId, { status: 'revoked', revokedAt });
    this.connections.closeClient(clientId);
    await this.audit({ accountId: context.accountId, spaceId, clientId, actorType: 'account', actorId: context.accountId, action: 'client.revoke', targetType: 'client', targetId: clientId, result: 'success', requestId });
    return this.clientProjection(row);
  }

  async resetInstallation(context, spaceId, clientId, requestId) {
    this.assertRecent(context);
    const client = await this.requireClient(context.accountId, spaceId, clientId);
    const revokedAt = iso(this.now());
    const retirements = (await this.store.listKeyGenerations(context.accountId, spaceId, clientId))
      .map((generation) => ({ generationId: generation.generationId, patch: { revokedAt } }));
    const material = await this.newKeyMaterial(context.account.authEpoch);
    const clientPatch = { status: 'active', revokedAt: null, installationId: null, firstConnectedAt: null, lastSeenAt: null, platform: null, appVersion: null };
    const result = await this.store.replaceClientKey(context.accountId, spaceId, clientId, {
      retirements,
      generation: { ...material.generation, accountId: context.accountId, spaceId, clientId },
      clientPatch
    });
    this.connections.closeClient(clientId);
    await this.audit({ accountId: context.accountId, spaceId, clientId, actorType: 'account', actorId: context.accountId, action: 'client.installation_reset', targetType: 'client', targetId: clientId, result: 'success', requestId });
    return { ...(await this.clientProjection(result.client)), clientKey: material.key };
  }

  async authenticateClient(key) {
    if (typeof key !== 'string' || !key.startsWith(KEY_PREFIX)) throw errors.authentication();
    const generation = await this.store.findKeyByFingerprint(keyedFingerprint(key, this.config.keyLookupSecret));
    const now = this.now();
    if (!generation || generation.revokedAt || (generation.expiresAt && Date.parse(generation.expiresAt) <= now.getTime()) || !await verifySecret(generation.verifier, key)) throw errors.authentication();
    const account = await this.store.getAccount(generation.accountId);
    const space = await this.store.getSpace(generation.accountId, generation.spaceId);
    const client = await this.store.getClient(generation.accountId, generation.spaceId, generation.clientId);
    if (!account || account.status !== 'active' || generation.authEpoch !== account.authEpoch || !space || space.status !== 'active' || !client || client.status !== 'active') throw errors.authentication();
    return { actorType: 'client', accountId: account.accountId, spaceId: space.spaceId, clientId: client.clientId, restoreEpoch: space.restoreEpoch, keyGenerationId: generation.generationId, account, space, client };
  }

  async bindClient(context, installationId, metadata, requestId) {
    const result = await this.store.bindClient(context.accountId, context.spaceId, context.clientId, installationId, metadata, iso(this.now()));
    if (result.status !== 'ok') {
      await this.audit({ accountId: context.accountId, spaceId: context.spaceId, clientId: context.clientId, actorType: 'client', actorId: context.clientId, action: 'client.binding_mismatch', targetType: 'client', targetId: context.clientId, result: 'failure', errorCode: 'authentication_failed', requestId });
      throw errors.authentication();
    }
    return result.client;
  }

  async requireClient(accountId, spaceId, clientId) {
    const row = await this.store.getClient(accountId, spaceId, clientId);
    if (!row) throw errors.notFound();
    return row;
  }

  async clientProjection(row) { return publicClient(row, await this.store.listKeyGenerations(row.accountId, row.spaceId, row.clientId)); }

  validName(name) {
    if (typeof name !== 'string') throw errors.invalid({ field: 'name' });
    const normalized = normalizeName(name);
    if (!normalized.displayName || normalized.displayName.length > 128) throw errors.invalid({ field: 'name' });
    return normalized;
  }

  async newKeyMaterial(authEpoch) {
    const key = generateClientKey();
    return { key, generation: { lookupFingerprint: keyedFingerprint(key, this.config.keyLookupSecret), verifier: await hashSecret(key), authEpoch } };
  }

  async audit({ targetId, ...event }) {
    await this.store.audit({ ...event, targetIdPrefix: targetId?.slice(0, 8) ?? null });
  }
}
