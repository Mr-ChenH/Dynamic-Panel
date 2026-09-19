(function exposeTodoMutationController(global) {
  function createTodoMutationController(options = {}) {
    const priorities = Array.isArray(options.priorities) ? options.priorities : ['P0', 'P1', 'P2', 'P3'];
    const documentRef = options.document || global.document;
    const windowRef = options.window || global;
    const domain = options.domain || windowRef.NotchDomain;
    const getData = options.getData || (() => ({}));
    const saveData = options.saveData || (() => true);
    const generateId = options.generateId || (() => `${Date.now()}-${Math.random()}`);
    const captureTodoPositions = options.captureTodoPositions || (() => new Map());
    const renderList = options.renderList || (() => {});
    const renderAll = options.renderAll || (() => {});
    const updateCount = options.updateCount || (() => {});
    const todosVisibleInScope = options.todosVisibleInScope || ((priority) => getData()[priority] || []);
    const getTimeScope = options.getTimeScope || (() => 'today');
    const getSelections = options.getSelections || (() => ({}));
    const getSelectionAnchors = options.getSelectionAnchors || (() => ({}));
    const setSelection = options.setSelection || ((priority, value) => { getSelections()[priority] = value; });
    const setSelectionAnchor = options.setSelectionAnchor || ((priority, value) => { getSelectionAnchors()[priority] = value; });
    const getCompletedExpanded = options.getCompletedExpanded || (() => ({}));
    const getEditingTodo = options.getEditingTodo || (() => null);
    const setEditingTodo = options.setEditingTodo || (() => {});
    const openTodoEditor = options.openTodoEditor || (() => {});
    const closeTodoEditor = options.closeTodoEditor || (() => {});
    const applyDefaultTodoDeadline = options.applyDefaultTodoDeadline || (() => {});
    const resetTodoDraftDeadline = options.resetTodoDraftDeadline || (() => {});
    const getTodoEditorContext = options.getTodoEditorContext || (() => null);
    const showStatusToast = options.showStatusToast || (() => {});
    const reduceMotion = () => windowRef.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function flashItemClass(priority, id, cls) {
      const item = documentRef.querySelector(
        `.todo-item[data-priority="${priority}"][data-id="${id}"]`
      );
      if (!item) return;
      item.classList.add(cls);
      item.addEventListener('animationend', () => item.classList.remove(cls), { once: true });
    }

    function flashCheckboxPop(priority, id) {
      const checkbox = documentRef.querySelector(
        `.todo-item[data-priority="${priority}"][data-id="${id}"] .checkbox`
      );
      if (!checkbox) return;
      checkbox.classList.add('pop');
      checkbox.addEventListener('animationend', () => checkbox.classList.remove('pop'), { once: true });
    }

    function addTodo(priority, text, deadline) {
      const item = domain.createTodo(text, deadline, generateId(), Date.now());
      if (!item) return false;
      const previousPositions = captureTodoPositions(priority);
      getData()[priority].push(item);
      saveData(getData());
      renderList(priority, { previousPositions });
      updateCount(priority);
      flashItemClass(priority, item.id, 'enter');
      const added = documentRef.querySelector(
        `.todo-item[data-priority="${priority}"][data-id="${item.id}"]`
      );
      if (added) {
        windowRef.requestAnimationFrame(() => {
          added.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
        });
      }
      return true;
    }

    function editTodo(priority, id, text, deadline) {
      const list = getData()[priority] || [];
      const index = list.findIndex((item) => item.id === id);
      if (index < 0) return false;
      const updated = domain.updateTodo(list[index], text, deadline);
      if (!updated) return false;
      const previousPositions = captureTodoPositions(priority);
      list[index] = updated;
      saveData(getData());
      renderList(priority, { previousPositions, focusId: id, focusAction: 'edit' });
      updateCount(priority);
      return true;
    }

    function toggleTodo(priority, id) {
      const list = getData()[priority] || [];
      const index = list.findIndex((todo) => todo.id === id);
      if (index === -1) return;
      const previousPositions = captureTodoPositions(priority);
      const restoreFocus = documentRef.activeElement?.closest('.todo-item')?.dataset.id === id;
      list[index].done = !list[index].done;
      const nowDone = list[index].done;
      if (nowDone) getCompletedExpanded()[priority] = true;
      saveData(getData());
      renderList(priority, {
        previousPositions,
        focusId: restoreFocus ? id : '',
        focusAction: 'toggle',
      });
      updateCount(priority);
      if (nowDone) windowRef.requestAnimationFrame(() => flashCheckboxPop(priority, id));
    }

    function deleteTodo(priority, id) {
      const list = getData()[priority] || [];
      const index = list.findIndex((todo) => todo.id === id);
      if (index === -1) return;
      const [removed] = list.splice(index, 1);
      const item = documentRef.querySelector(
        `.todo-item[data-priority="${priority}"][data-id="${global.CSS.escape(id)}"]`
      );
      const shouldRestoreFocus = !!(item && item.contains(documentRef.activeElement));
      const nearbyId = item && (item.nextElementSibling || item.previousElementSibling)?.dataset.id;
      saveData(getData());
      renderList(priority);
      updateCount(priority);
      if (shouldRestoreFocus) {
        const nextFocus =
          (nearbyId && documentRef.querySelector(`.todo-item[data-id="${global.CSS.escape(nearbyId)}"] [data-action="toggle"]`))
          || documentRef.querySelector(`.add-row input[data-priority="${priority}"]`);
        if (nextFocus) nextFocus.focus({ preventScroll: true });
      }
      const summary = removed.text.length > 18 ? `${removed.text.slice(0, 18)}…` : removed.text;
      showStatusToast(`已删除“${summary}”`, {
        actionLabel: '撤销',
        duration: 5000,
        onAction: () => {
          if (list.some((todo) => todo.id === removed.id)) return;
          list.splice(Math.min(index, list.length), 0, removed);
          saveData(getData());
          renderList(priority);
          updateCount(priority);
          const restored = documentRef.querySelector(
            `.todo-item[data-priority="${priority}"][data-id="${global.CSS.escape(id)}"] [data-action="toggle"]`
          );
          if (restored) restored.focus({ preventScroll: true });
          showStatusToast('已撤销删除');
        },
      });
    }

    function submitTodo(priority, input, deadlineInput) {
      const value = input.value;
      if (!value.trim()) return;
      if (!deadlineInput || !deadlineInput.dataset.deadline) {
        deadlineInput?.classList.add('invalid');
        openTodoEditor(priority);
        return;
      }
      if (!addTodo(priority, value, deadlineInput.dataset.deadline)) {
        deadlineInput.classList.add('invalid');
        showStatusToast('截止时间格式不正确');
        return;
      }
      input.value = '';
      const editorContext = getTodoEditorContext();
      if (editorContext?.mode === 'add' && editorContext.priority === priority) closeTodoEditor();
      resetTodoDraftDeadline(deadlineInput);
      deadlineInput.classList.remove('invalid');
      input.focus({ preventScroll: true });
    }

    function bindAddRows() {
      priorities.forEach((priority) => {
        const input = documentRef.querySelector(`.add-row input[data-priority="${priority}"]`);
        const deadlineInput = documentRef.querySelector(`.todo-deadline-trigger[data-deadline-priority="${priority}"]`);
        if (!input) return;
        applyDefaultTodoDeadline(deadlineInput);
        input.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          if (event.repeat) return;
          submitTodo(priority, input, deadlineInput);
        });
        deadlineInput?.addEventListener('click', () => openTodoEditor(priority));
      });
    }

    function bindLists() {
      priorities.forEach((priority) => {
        const list = documentRef.querySelector(`.todo-list[data-priority="${priority}"]`);
        if (!list) return;
        list.addEventListener('click', (event) => {
          const completedToggle = event.target.closest('[data-todo-completed-toggle]');
          if (completedToggle) {
            const targetPriority = completedToggle.dataset.todoCompletedToggle;
            getCompletedExpanded()[targetPriority] = !getCompletedExpanded()[targetPriority];
            renderList(targetPriority);
            windowRef.requestAnimationFrame(() => documentRef.querySelector(
              `[data-todo-completed-toggle="${targetPriority}"]`
            )?.focus({ preventScroll: true }));
            return;
          }
          const item = event.target.closest('.todo-item');
          if (!item) return;
          const id = item.dataset.id;
          if (event.shiftKey) {
            event.preventDefault();
            const result = domain.updateRangeSelection(
              todosVisibleInScope(priority).map((todo) => todo.id),
              [...(getSelections()[priority] || [])],
              id,
              getSelectionAnchors()[priority],
              true
            );
            setSelection(priority, new Set(result.selected));
            setSelectionAnchor(priority, result.anchor);
            renderList(priority);
            return;
          }
          const target = event.target.closest('[data-action]');
          if (!target) return;
          const action = target.dataset.action;
          if (action === 'toggle') {
            toggleTodo(priority, id);
          } else if (action === 'edit') {
            const todo = (getData()[priority] || []).find((candidate) => candidate.id === id);
            if (todo) {
              setEditingTodo({ priority, id });
              renderList(priority);
              windowRef.requestAnimationFrame(() => documentRef.querySelector(
                `.todo-item[data-id="${global.CSS.escape(id)}"] .todo-inline-name`
              )?.focus({ preventScroll: true }));
            }
          } else if (action === 'edit-deadline') {
            const todo = (getData()[priority] || []).find((candidate) => candidate.id === id);
            if (todo) openTodoEditor(priority, todo, target);
          } else if (action === 'save-edit') {
            const todo = (getData()[priority] || []).find((candidate) => candidate.id === id);
            const name = item.querySelector('.todo-inline-name')?.value.trim() || '';
            if (!todo || !name || !todo.deadline) return;
            setEditingTodo(null);
            editTodo(priority, id, name, todo.deadline);
          } else if (action === 'reschedule-today') {
            const todo = (getData()[priority] || []).find((candidate) => candidate.id === id);
            const deadline = domain.defaultTodoDeadlineForScope('today', new Date());
            if (!todo || !deadline) return;
            editTodo(priority, id, todo.text, deadline);
            showStatusToast('已移到今天');
          } else if (action === 'delete') {
            deleteTodo(priority, id);
          }
        });
        list.addEventListener('keydown', (event) => {
          const item = event.target.closest('.todo-item');
          if (!item || !event.target.matches('.todo-inline-name')) return;
          if (event.key === 'Escape') {
            setEditingTodo(null);
            renderList(priority);
          } else if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            item.querySelector('[data-action="save-edit"]')?.click();
          }
        });
      });
    }

    function bindBulkDelete() {
      documentRef.querySelectorAll('.todo-bulk-delete[data-bulk-priority]').forEach((button) => {
        button.addEventListener('click', () => {
          const priority = button.dataset.bulkPriority;
          const selected = getSelections()[priority];
          if (!selected || !selected.size) return;
          const list = getData()[priority] || [];
          getData()[priority] = list.filter((item) => !selected.has(item.id));
          selected.clear();
          setSelectionAnchor(priority, null);
          saveData(getData());
          renderList(priority);
          updateCount(priority);
          showStatusToast('已删除所选待办');
        });
      });
    }

    return {
      addTodo,
      editTodo,
      toggleTodo,
      deleteTodo,
      submitTodo,
      bindAddRows,
      bindLists,
      bindBulkDelete,
    };
  }

  global.NotchTodoMutation = { createTodoMutationController };
})(window);
