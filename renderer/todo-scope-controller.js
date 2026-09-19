(function exposeTodoScopeController(global) {
  function createTodoScopeController(options = {}) {
    const priorities = Array.isArray(options.priorities) ? options.priorities : ['P0', 'P1', 'P2', 'P3'];
    const scopes = Array.isArray(options.scopes) ? options.scopes : ['today', 'week', 'later', 'all'];
    const documentRef = options.document || global.document;
    const windowRef = options.window || global;
    const getData = options.getData || (() => ({}));
    const getScope = options.getScope || (() => 'today');
    const setScope = options.setScope || (() => {});
    const getSelections = options.getSelections || (() => ({}));
    const getSelectionAnchors = options.getSelectionAnchors || (() => ({}));
    const getCompletedExpanded = options.getCompletedExpanded || (() => ({}));
    const setEditingTodo = options.setEditingTodo || (() => {});
    const closeTodoEditor = options.closeTodoEditor || (() => {});
    const applyDefaultDeadline = options.applyDefaultDeadline || (() => {});
    const renderAll = options.renderAll || (() => {});
    const showOverdueFocus = options.showOverdueFocus || (() => {});

    function refreshDraftDeadlines(now = new Date()) {
      documentRef.querySelectorAll('.todo-deadline-trigger[data-deadline-priority]').forEach((trigger) => {
        if (trigger.dataset.deadlineSource === 'manual') return;
        delete trigger.dataset.deadline;
        delete trigger.dataset.deadlineSource;
        applyDefaultDeadline(trigger, now);
      });
    }

    function setTimeScope(scope, { focusOverdue = false } = {}) {
      if (!scopes.includes(scope)) return false;
      setScope(scope);
      setEditingTodo(null);
      priorities.forEach((priority) => {
        getSelections()[priority]?.clear();
        setSelectionAnchor(priority, null);
        getCompletedExpanded()[priority] = false;
      });
      closeTodoEditor();
      refreshDraftDeadlines();
      renderAll();
      if (focusOverdue) windowRef.requestAnimationFrame(showOverdueFocus);
      return true;
    }

    function setSelectionAnchor(priority, value) {
      getSelectionAnchors()[priority] = value;
    }

    function bindControls() {
      const buttons = Array.from(documentRef.querySelectorAll('[data-todo-scope]'));
      buttons.forEach((button, index) => {
        button.addEventListener('click', () => setTimeScope(button.dataset.todoScope));
        button.addEventListener('keydown', (event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const offset = event.key === 'ArrowRight' ? 1 : -1;
          const next = buttons[(index + offset + buttons.length) % buttons.length];
          next.focus({ preventScroll: true });
          setTimeScope(next.dataset.todoScope);
        });
      });
      documentRef.getElementById('todo-overdue-jump')?.addEventListener('click', () => {
        setTimeScope('today', { focusOverdue: true });
      });
    }

    return {
      refreshDraftDeadlines,
      setTimeScope,
      bindControls,
    };
  }

  global.NotchTodoScope = { createTodoScopeController };
})(window);
