function createTaskNotificationDomain({ taskNotificationIdentity, now = () => Date.now(), random = Math.random }) {
  function pickValue(payload, keys) {
    for (const key of keys) {
      const value = payload[key];
      if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) return String(value);
    }
    return '';
  }

  function cleanText(value, maxLength) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    const firstLine = String(value)
      .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!firstLine) return '';
    const cleaned = firstLine
      .replace(/^[#>*`_~\-\s]+/, '')
      .replace(/[`*_~]/g, '')
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const characters = Array.from(cleaned);
    return characters.length > maxLength ? characters.slice(0, maxLength).join('') : cleaned;
  }

  function isSubagent(payload) {
    const agentType = pickValue(payload, ['agent_type', 'agent-type', 'agentType']).toLowerCase();
    const hookEvent = pickValue(payload, ['hook_event_name', 'hook-event-name', 'hookEventName']).toLowerCase();
    const agentId = pickValue(payload, ['agent_id', 'agent-id', 'agentId']);
    return Boolean(agentId)
      || hookEvent.includes('subagent')
      || agentType.includes('subagent')
      || payload.is_subagent === true
      || payload.isSubagent === true;
  }

  function normalize(payload, source) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    if (isSubagent(payload)) return null;
    const identity = taskNotificationIdentity(payload, source);
    const taskId = cleanText(pickValue(payload, [
      'turn_id', 'turn-id', 'turnId',
      'thread_id', 'thread-id', 'threadId',
      'session_id', 'session-id', 'sessionId',
      'task_id', 'task-id', 'taskId', 'id',
    ]), 160);
    const completedAtValue = Number(pickValue(payload, ['completed_at', 'completed-at', 'completedAt']));
    const completedAt = Number.isFinite(completedAtValue) && completedAtValue > 0 ? completedAtValue : now();
    return {
      eventId: `${now().toString(36)}-${random().toString(36).slice(2, 10)}`,
      source,
      taskId,
      title: identity.title,
      project: identity.project,
      completedAt,
    };
  }

  return { pickValue, cleanText, isSubagent, normalize };
}

module.exports = { createTaskNotificationDomain };
