(function exposeTodoApiController(global) {
  function createTodoApiController(options = {}) {
    const priorities = Array.isArray(options.priorities) ? options.priorities : ['P0', 'P1', 'P2', 'P3'];
    const domain = options.domain || global.NotchDomain;
    const getData = options.getData || (() => ({}));
    const setData = options.setData || (() => {});
    const getTimeScope = options.getTimeScope || (() => 'today');
    const setTimeScope = options.setTimeScope || (() => false);
    const getCategoryNames = options.getCategoryNames || (() => ({}));
    const generateId = options.generateId || (() => `${Date.now()}-${Math.random()}`);
    const saveData = options.saveData || (() => true);
    const renderAll = options.renderAll || (() => {});
    const syncWorkspaceSnapshot = options.syncWorkspaceSnapshot || (async () => false);

    function snapshot() {
      const data = getData();
      return Object.fromEntries(priorities.map((priority) => [
        priority,
        (data[priority] || []).map((todo) => ({ ...todo })),
      ]));
    }

    function chatContexts() {
      const data = getData();
      const categoryNames = getCategoryNames();
      return priorities.flatMap((priority) => (data[priority] || []).map((todo) => ({
        sourceType: 'todo',
        sourceId: todo.id,
        sourceTitle: todo.text,
        sourceRevision: String(todo.updatedAt || todo.createdAt || ''),
        text: [
          `状态：${todo.done ? '已完成' : '未完成'}`,
          `责任领域：${categoryNames[priority] || priority}`,
          todo.deadline ? `截止时间：${todo.deadline}` : '截止时间：未设置',
        ].join('\n'),
        detail: `${categoryNames[priority] || priority} · ${todo.done ? '已完成' : '未完成'}`,
        updatedAt: todo.updatedAt || todo.createdAt || 0,
      })));
    }

    async function applyAIBatch(candidates) {
      const applied = global.NotchAIDomain?.createTodoBatch(
        getData(), candidates, () => generateId(), Date.now()
      );
      if (!applied?.ok) return applied || { ok: false, error: 'invalid_candidates' };
      const previous = getData();
      setData(applied.next);
      if (!saveData(applied.next)) {
        setData(previous);
        return { ok: false, error: 'save_failed' };
      }
      renderAll();
      const workspaceSynced = await syncWorkspaceSnapshot();
      return { ok: true, count: applied.added.length, undo: applied.added, workspaceSynced };
    }

    async function undoAIBatch(added) {
      const result = global.NotchAIDomain?.undoTodoBatch(getData(), added);
      if (!result) return { ok: false, error: 'invalid_undo' };
      const previous = getData();
      setData(result.next);
      if (!saveData(result.next)) {
        setData(previous);
        return { ok: false, error: 'save_failed' };
      }
      renderAll();
      const workspaceSynced = await syncWorkspaceSnapshot();
      return {
        ok: true,
        removed: result.removed.length,
        conflicts: result.conflicts.length,
        workspaceSynced,
      };
    }

    return {
      getTimeScope,
      setTimeScope,
      getScopeCounts: () => ({ ...domain.todoTimeScopeCounts(priorities.flatMap((priority) => getData()[priority] || [])) }),
      snapshot,
      chatContexts,
      applyAIBatch,
      undoAIBatch,
    };
  }

  global.NotchTodoApi = { createTodoApiController };
})(window);
