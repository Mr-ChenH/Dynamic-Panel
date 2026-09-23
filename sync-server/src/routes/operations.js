import { randomUUID } from 'node:crypto';
import { accountContext, data, idParams, protectedAccountContext, strictObject } from './helpers.js';

function publicJob(job) {
  return { jobId: job.jobId, state: job.state, createdAt: job.createdAt, completedAt: job.completedAt ?? null, errorCode: job.errorCode ?? null };
}

export async function operationalRoutes(app, options = {}) {
  const operations = options.operations ?? app.operations ?? {};
  const jobs = new Map();
  const saveJob = async (job) => operations.saveExportJob ? operations.saveExportJob(job) : (jobs.set(job.jobId, job), job);
  const loadJob = (accountId, jobId) => operations.getExportJob ? operations.getExportJob(accountId, jobId) : Promise.resolve(jobs.get(jobId));

  app.get('/api/v1/spaces/:spaceId/conflicts', {
    schema: { params: idParams('spaceId'), querystring: strictObject({ status: { type: 'string', enum: ['unresolved', 'resolved'] } }) }
  }, async (request, reply) => {
    const context = await accountContext(request);
    await app.identity.getSpace(context, request.params.spaceId);
    const conflicts = await operations.listConflicts?.({ accountId: context.accountId, spaceId: request.params.spaceId, status: request.query.status ?? 'unresolved' }) ?? [];
    return data(reply, request, conflicts, { noStore: true });
  });

  app.post('/api/v1/spaces/:spaceId/conflicts/:conflictId/resolve', {
    schema: {
      params: strictObject({ spaceId: { type: 'string', format: 'uuid' }, conflictId: { type: 'string', minLength: 1, maxLength: 160 } }, ['spaceId', 'conflictId']),
      body: strictObject({ resolution: { type: 'string', enum: ['current', 'incoming', 'manual'] }, payload: {}, baseRevision: { type: 'integer', minimum: 0 } }, ['resolution', 'baseRevision'])
    }
  }, async (request, reply) => {
    const context = await protectedAccountContext(request);
    await app.identity.getSpace(context, request.params.spaceId);
    if (!operations.resolveConflict) throw app.errors.notFound();
    const result = await operations.resolveConflict({ accountId: context.accountId, spaceId: request.params.spaceId, ...request.params, ...request.body });
    await app.identity.audit({ accountId: context.accountId, spaceId: request.params.spaceId, actorType: 'account', actorId: context.accountId, action: 'conflict.resolve', targetType: 'conflict', targetId: request.params.conflictId, result: 'success', requestId: request.id });
    return data(reply, request, result, { noStore: true });
  });

  app.post('/api/v1/spaces/:spaceId/exports', { schema: { params: idParams('spaceId'), body: strictObject({}) } }, async (request, reply) => {
    const context = await protectedAccountContext(request);
    app.identity.assertRecent(context);
    await app.identity.getSpace(context, request.params.spaceId);
    if (!operations.createExport) throw app.errors.notFound();
    const job = { jobId: randomUUID(), state: 'running', accountId: context.accountId, spaceId: request.params.spaceId, createdAt: new Date().toISOString() };
    await saveJob(job);
    try {
      const result = await operations.createExport({ scope: { type: 'space', accountId: context.accountId, spaceId: request.params.spaceId }, reason: 'console-export' });
      Object.assign(job, { state: 'verified', completedAt: new Date().toISOString(), result });
    } catch (error) {
      Object.assign(job, { state: 'failed', completedAt: new Date().toISOString(), errorCode: error.code ?? 'EXPORT_FAILED' });
    }
    await saveJob(job);
    reply.code(202);
    return data(reply, request, publicJob(job), { noStore: true });
  });

  app.get('/api/v1/exports/:jobId', { schema: { params: idParams('jobId') } }, async (request, reply) => {
    const context = await accountContext(request);
    const job = await loadJob(context.accountId, request.params.jobId);
    if (!job || job.accountId !== context.accountId) throw app.errors.notFound();
    return data(reply, request, publicJob(job), { noStore: true });
  });

  app.get('/api/v1/exports/:jobId/download', { schema: { params: idParams('jobId') } }, async (request, reply) => {
    const context = await accountContext(request);
    const job = await loadJob(context.accountId, request.params.jobId);
    if (!job || job.accountId !== context.accountId || job.state !== 'verified' || !operations.downloadExport) throw app.errors.notFound();
    const result = await operations.downloadExport(job.result);
    reply.type(result.contentType ?? 'application/octet-stream').header('content-disposition', `attachment; filename="${result.filename ?? `dynamic-panel-${job.jobId}.backup`}"`).header('cache-control', 'private, no-store');
    return reply.send(result.body);
  });
}
