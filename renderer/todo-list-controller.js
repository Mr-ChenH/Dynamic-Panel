(function exposeTodoListController(global) {
  function createTodoListController(options = {}) {
    const priorities = Array.isArray(options.priorities) ? options.priorities : ['P0', 'P1', 'P2', 'P3'];
    const documentRef = options.document || global.document;
    const windowRef = options.window || global;
    const domain = options.domain || windowRef.NotchDomain;
    const getData = options.getData || (() => ({}));
    const getTimeScope = options.getTimeScope || (() => 'today');
    const getEditingTodo = options.getEditingTodo || (() => null);
    const getSelections = options.getSelections || (() => ({}));
    const getCompletedExpanded = options.getCompletedExpanded || (() => ({}));

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function checkSvg() {
      return '<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    function formatTodoDeadline(item, now = Date.now()) {
      const timestamp = Date.parse(String(item && item.deadline || ''));
      if (!Number.isFinite(timestamp)) return { label: '待整理', title: '截止时间无效', overdue: false };
      const deadline = new Date(timestamp);
      const bucket = domain.todoTimeBucket(item, now);
      const clock = new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(deadline);
      const full = new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(deadline);
      if (bucket === 'overdue') {
        const difference = Math.max(0, now - timestamp);
        const amount = difference < 3600000
          ? `${Math.max(1, Math.floor(difference / 60000))} 分钟`
          : difference < 86400000
            ? `${Math.floor(difference / 3600000)} 小时`
            : `${Math.floor(difference / 86400000)} 天`;
        return { label: `逾期 ${amount}`, title: full, overdue: true };
      }
      if (bucket === 'today') return { label: clock, title: full, overdue: false };
      if (bucket === 'week') {
        const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(deadline);
        return { label: `${weekday} ${clock}`, title: full, overdue: false };
      }
      const includeYear = deadline.getFullYear() !== new Date(now).getFullYear();
      const label = new Intl.DateTimeFormat('zh-CN', {
        ...(includeYear ? { year: 'numeric' } : {}), month: 'numeric', day: 'numeric',
      }).format(deadline);
      return { label, title: full, overdue: false };
    }

    function todoItemHtml(priority, item) {
      const deadlineState = formatTodoDeadline(item);
      const doneClass = item.done ? ' done' : '';
      const overdueClass = deadlineState.overdue ? ' overdue' : '';
      const selections = getSelections();
      const selectedClass = selections[priority]?.has(item.id) ? ' multi-selected' : '';
      const safeId = escapeHtml(item.id);
      const safeText = escapeHtml(item.text);
      const deadline = deadlineState.label;
      const toggleLabel = item.done ? `恢复未完成：${safeText}` : `标记完成：${safeText}`;
      const battery = item.done ? null : domain.todoTimeBattery(item, Date.now());
      const batteryHtml = battery
        ? `<span class="todo-battery" data-tone="${battery.tone}"${battery.overdue ? ' data-overdue="true" role="img"' : ''} title="${battery.label}" aria-label="${battery.label}"><i style="--battery:${battery.overdue ? 100 : battery.percent}%"></i><b>${battery.overdue ? '!' : `${battery.percent}%`}</b></span>`
        : '';
      const editingTodo = getEditingTodo();
      const isEditing = editingTodo?.priority === priority && editingTodo?.id === item.id;
      const rescheduleDeadline = deadlineState.overdue
        ? domain.defaultTodoDeadlineForScope('today', new Date())
        : null;
      const rescheduleAction = rescheduleDeadline
        ? `<button class="todo-reschedule-action" type="button" data-action="reschedule-today" title="移到今天" aria-label="将${safeText}移到今天">今天</button>`
        : '';
      const contentHtml = isEditing
        ? `<div class="todo-inline-editor"><input class="todo-inline-name" value="${safeText}" maxlength="80" aria-label="修改待办名称" />${batteryHtml}<button class="todo-inline-deadline" type="button" data-action="edit-deadline">${deadline}</button><button class="todo-inline-save" type="button" data-action="save-edit" aria-label="保存修改">✓</button></div>`
        : `<div class="todo-copy-row"><button class="todo-copy" type="button" data-action="edit" title="${safeText}" aria-label="修改：${safeText}"><span class="todo-text">${safeText}</span>${batteryHtml}<time class="todo-ddl" datetime="${escapeHtml(item.deadline)}" title="${escapeHtml(deadlineState.title)}">${escapeHtml(deadline)}</time></button>${rescheduleAction}</div>`;
      return `
    <li class="todo-item${doneClass}${overdueClass}${selectedClass}" data-id="${safeId}" data-priority="${priority}">
      <button class="checkbox" type="button" data-action="toggle" aria-label="${toggleLabel}" aria-pressed="${item.done}">${checkSvg()}</button>
      ${contentHtml}
      <button class="delete" type="button" data-action="delete" aria-label="删除：${safeText}">×</button>
    </li>
  `;
    }

    function captureTodoPositions(priority) {
      const list = documentRef.querySelector(`.todo-list[data-priority="${priority}"]`);
      if (!list) return new Map();
      return new Map(Array.from(list.querySelectorAll('.todo-item[data-id]')).map((item) => (
        [item.dataset.id, item.getBoundingClientRect()]
      )));
    }

    function animateTodoOrder(priority, previousPositions) {
      if (!previousPositions?.size || windowRef.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const list = documentRef.querySelector(`.todo-list[data-priority="${priority}"]`);
      if (!list) return;
      windowRef.requestAnimationFrame(() => {
        list.querySelectorAll('.todo-item[data-id]').forEach((item) => {
          const previous = previousPositions.get(item.dataset.id);
          if (!previous || typeof item.animate !== 'function') return;
          const current = item.getBoundingClientRect();
          const offset = previous.top - current.top;
          if (Math.abs(offset) < 1) return;
          item.animate([
            { transform: `translateY(${offset}px)` },
            { transform: 'translateY(0)' },
          ], { duration: 360, easing: 'cubic-bezier(.22, 1, .36, 1)' });
        });
      });
    }

    function todosVisibleInScope(priority, now = Date.now()) {
      const data = getData();
      return domain.sortTodosForDisplay(domain.filterTodosByTimeScope(
        data[priority] || [], getTimeScope(), now
      ));
    }

    function completedTodoDisclosureHtml(priority, completed) {
      if (!completed.length) return '';
      const expanded = getCompletedExpanded()[priority];
      return `<li class="todo-completed-disclosure">
    <button type="button" data-todo-completed-toggle="${priority}" aria-expanded="${expanded}">
      <span>已完成</span><b>${completed.length}</b><i aria-hidden="true"></i>
    </button>
  </li>${expanded ? completed.map((item) => todoItemHtml(priority, item)).join('') : ''}`;
    }

    function updateTodoBulkButton(priority) {
      const button = documentRef.querySelector(`[data-bulk-priority="${priority}"]`);
      const count = getSelections()[priority]?.size || 0;
      if (!button) return;
      button.hidden = count === 0;
      button.textContent = '删除';
      button.setAttribute('aria-label', count ? `删除 ${count} 项` : '删除所选');
    }

    function renderList(priority, options = {}) {
      const list = documentRef.querySelector(`.todo-list[data-priority="${priority}"]`);
      if (!list) return;
      const items = todosVisibleInScope(priority);
      const pending = items.filter((item) => item.done !== true);
      const completed = items.filter((item) => item.done === true);
      const scope = getTimeScope();
      const empty = pending.length || completed.length
        ? ''
        : `<li class="todo-scope-empty">${scope === 'week' && !domain.defaultTodoDeadlineForScope('week') ? '本周余下已安排完' : '当前范围没有待办'}</li>`;
      list.innerHTML = `${pending.map((item) => todoItemHtml(priority, item)).join('')}${completedTodoDisclosureHtml(priority, completed)}${empty}`;
      updateTodoBulkButton(priority);
      animateTodoOrder(priority, options.previousPositions);
      if (options.focusId) {
        windowRef.requestAnimationFrame(() => {
          const target = list.querySelector(
            `.todo-item[data-id="${CSS.escape(options.focusId)}"] [data-action="${options.focusAction || 'toggle'}"]`
          );
          const fallback = list.querySelector(`[data-todo-completed-toggle="${priority}"]`)
            || documentRef.querySelector(`.add-row input[data-priority="${priority}"]`);
          (target || fallback)?.focus({ preventScroll: true });
        });
      }
    }

    function updateCount(priority) {
      const countEl = documentRef.querySelector(`.count[data-priority="${priority}"]`);
      if (!countEl) return;
      const pending = todosVisibleInScope(priority).filter((todo) => todo.done !== true).length;
      countEl.textContent = String(pending);
    }

    function renderTodoPlanner(now = new Date()) {
      const data = getData();
      const scope = getTimeScope();
      const scopeButtons = Array.from(documentRef.querySelectorAll('[data-todo-scope]'));
      const counts = domain.todoTimeScopeCounts(priorities.flatMap((priority) => data[priority] || []), now);
      scopeButtons.forEach((button) => {
        const selected = button.dataset.todoScope === scope;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
        const count = button.querySelector('[data-todo-scope-count]');
        if (count) count.textContent = String(counts[button.dataset.todoScope] || 0);
      });
      const overdueJump = documentRef.getElementById('todo-overdue-jump');
      const overdueCount = documentRef.getElementById('todo-overdue-count');
      if (overdueJump && overdueCount) {
        overdueJump.hidden = counts.overdue === 0;
        overdueCount.textContent = String(counts.overdue);
        overdueJump.setAttribute('aria-label', `查看 ${counts.overdue} 项逾期待办`);
      }
      const period = documentRef.getElementById('todo-scope-period');
      const boundaries = domain.todoTimeBoundaries(now);
      if (period && boundaries) {
        const today = new Date(boundaries.startToday);
        const lastWeekDay = new Date(boundaries.startNextWeek - 1);
        const labels = {
          today: `${today.getMonth() + 1}月${today.getDate()}日`,
          week: boundaries.startTomorrow >= boundaries.startNextWeek
            ? '本周余下已结束'
            : `${new Date(boundaries.startTomorrow).getMonth() + 1}/${new Date(boundaries.startTomorrow).getDate()} - ${lastWeekDay.getMonth() + 1}/${lastWeekDay.getDate()}`,
          later: `${new Date(boundaries.startNextWeek).getMonth() + 1}月${new Date(boundaries.startNextWeek).getDate()}日以后`,
          all: counts.unscheduled ? `含 ${counts.unscheduled} 项待整理` : '所有未完成与已完成',
        };
        period.textContent = labels[scope];
      }
      documentRef.querySelector('.todo-page')?.setAttribute('data-todo-scope', scope);
    }

    function renderAll() {
      renderTodoPlanner();
      priorities.forEach((priority) => {
        renderList(priority);
        updateCount(priority);
      });
    }

    return {
      escapeHtml,
      formatTodoDeadline,
      todosVisibleInScope,
      captureTodoPositions,
      renderList,
      renderTodoPlanner,
      renderAll,
      updateCount,
      updateTodoBulkButton,
    };
  }

  global.NotchTodoList = { createTodoListController };
})(window);
