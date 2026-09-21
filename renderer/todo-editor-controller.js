(function exposeTodoEditorController(global) {
  function createTodoEditorController(options = {}) {
    const documentRef = options.document || global.document;
    const windowRef = options.window || global;
    const domain = options.domain || windowRef.NotchDomain;
    const getData = options.getData || (() => ({}));
    const getTimeScope = options.getTimeScope || (() => 'today');
    const saveData = options.saveData || (() => false);
    const renderList = options.renderList || (() => {});

    const backdrop = documentRef.getElementById('todo-date-popover');
    const monthLabel = documentRef.getElementById('todo-editor-month');
    const calendarPrevious = documentRef.getElementById('todo-calendar-previous');
    const calendarNext = documentRef.getElementById('todo-calendar-next');
    const calendarGrid = documentRef.getElementById('todo-calendar-grid');
    const hourSelect = documentRef.getElementById('todo-editor-hour');
    const minuteSelect = documentRef.getElementById('todo-editor-minute');
    const errorLabel = documentRef.getElementById('todo-editor-error');

    let context = null;
    let year = new Date().getFullYear();
    let month = new Date().getMonth();
    let day = new Date().getDate();

    function fillTimeOptions() {
      if (hourSelect && !hourSelect.options.length) {
        for (let hour = 0; hour < 24; hour += 1) {
          hourSelect.add(new global.Option(String(hour).padStart(2, '0'), String(hour)));
        }
      }
      if (minuteSelect && !minuteSelect.options.length) {
        for (let minute = 0; minute < 60; minute += 5) {
          minuteSelect.add(new global.Option(String(minute).padStart(2, '0'), String(minute)));
        }
      }
    }

    function renderCalendar() {
      if (!calendarGrid) return;
      const now = new Date();
      const days = new Date(year, month + 1, 0).getDate();
      const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
      if (monthLabel) monthLabel.textContent = `${year}年 ${month + 1}月`;
      calendarGrid.replaceChildren();
      for (let index = 0; index < firstWeekday; index += 1) calendarGrid.append(documentRef.createElement('span'));
      for (let value = 1; value <= days; value += 1) {
        const button = documentRef.createElement('button');
        button.type = 'button';
        button.textContent = String(value);
        button.dataset.day = String(value);
        button.className = value === day ? 'selected' : '';
        if (year === now.getFullYear() && month === now.getMonth() && value === now.getDate()) {
          button.classList.add('today');
        }
        calendarGrid.append(button);
      }
    }

    function close() {
      if (backdrop) backdrop.hidden = true;
      if (context?.mode === 'edit') renderList(context.priority);
      context = null;
    }

    function selectedDeadline() {
      return domain.calendarDeadline({
        year,
        month,
        day,
        hour: hourSelect?.value,
        minute: minuteSelect?.value,
      });
    }

    function applySelection(markManual = true) {
      if (!context) return false;
      const deadline = selectedDeadline();
      if (!deadline || Date.parse(deadline) <= Date.now()) {
        if (errorLabel) errorLabel.textContent = '请选择晚于当前时间的截止点';
        return false;
      }
      if (errorLabel) errorLabel.textContent = '';
      const { priority, id, mode } = context;
      if (mode === 'edit') {
        const todo = (getData()[priority] || []).find((item) => item.id === id);
        if (!todo) return false;
        todo.deadline = deadline;
        saveData(getData());
      } else {
        const trigger = documentRef.querySelector(`.todo-deadline-trigger[data-deadline-priority="${priority}"]`);
        if (!trigger) return false;
        trigger.dataset.deadline = deadline;
        trigger.dataset.deadlineSource = markManual ? 'manual' : (trigger.dataset.deadlineSource || 'default');
        trigger.querySelector('span').textContent = new Intl.DateTimeFormat('zh-CN', {
          day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
        }).format(new Date(deadline));
        trigger.classList.add('selected');
        trigger.classList.remove('invalid');
      }
      return true;
    }

    function positionPopover(quadrant) {
      if (!backdrop || !quadrant?.getBoundingClientRect) return;
      const boundary = documentRef.querySelector('.panel') || documentRef.documentElement;
      if (!boundary?.getBoundingClientRect) return;
      const quadrantRect = quadrant.getBoundingClientRect();
      const boundaryRect = boundary.getBoundingClientRect();
      const popoverRect = backdrop.getBoundingClientRect();
      if (!popoverRect.height || !boundaryRect.height) return;

      const edge = 8;
      const availableHeight = Math.max(1, boundaryRect.height - edge * 2);
      backdrop.style.setProperty('--todo-popover-max-height', `${availableHeight}px`);
      const preferredTop = quadrantRect.bottom - 58 - popoverRect.height - quadrantRect.top;
      const upperTop = boundaryRect.top + edge - quadrantRect.top;
      const lowerTop = boundaryRect.bottom - edge - popoverRect.height - quadrantRect.top;
      const top = Math.max(upperTop, Math.min(preferredTop, lowerTop));
      backdrop.style.setProperty('top', `${Math.round(top)}px`, 'important');
      backdrop.style.setProperty('bottom', 'auto', 'important');
    }

    function open(priority, item = null, anchor = null) {
      const now = new Date();
      const trigger = documentRef.querySelector(`.todo-deadline-trigger[data-deadline-priority="${priority}"]`);
      const candidate = item?.deadline
        ? new Date(item.deadline)
        : trigger?.dataset.deadline
          ? new Date(trigger.dataset.deadline)
          : null;
      const selectedDate = candidate && Number.isFinite(candidate.getTime())
        ? candidate
        : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 30, 0, 0);
      context = { priority, id: item?.id || '', mode: item ? 'edit' : 'add' };
      year = selectedDate.getFullYear();
      month = selectedDate.getMonth();
      day = selectedDate.getDate();
      fillTimeOptions();
      if (hourSelect) hourSelect.value = String(selectedDate.getHours());
      if (minuteSelect) minuteSelect.value = String(Math.floor(selectedDate.getMinutes() / 5) * 5);
      if (errorLabel) errorLabel.textContent = '';
      renderCalendar();
      if (backdrop) {
        const target = anchor || (item
          ? documentRef.querySelector(`.todo-item[data-id="${CSS.escape(item.id)}"] .todo-inline-deadline`)
          : trigger);
        const quadrant = target?.closest('.quadrant') || documentRef.querySelector(`.quadrant[data-priority="${priority}"]`);
        quadrant?.appendChild(backdrop);
        backdrop.hidden = false;
        backdrop.style.removeProperty('left');
        backdrop.style.removeProperty('top');
        backdrop.style.right = '12px';
        backdrop.style.bottom = '58px';
        positionPopover(quadrant);
      }
      applySelection(false);
    }

    function moveCalendar(offset) {
      const shifted = domain.shiftCalendarMonth({ year, month }, offset);
      if (!shifted) return;
      year = shifted.year;
      month = shifted.month;
      day = Math.min(day, new Date(year, month + 1, 0).getDate());
      if (errorLabel) errorLabel.textContent = '';
      renderCalendar();
    }

    function applyShortcut(shortcut) {
      const now = new Date();
      let selected = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 30, 0, 0);
      if (shortcut === 'tomorrow') selected.setDate(selected.getDate() + 1);
      if (shortcut === 'weekend') selected.setDate(selected.getDate() + (7 - selected.getDay()) % 7);
      if (shortcut === 'next-week') selected.setDate(selected.getDate() + (selected.getDay() === 0 ? 1 : 8 - selected.getDay()));
      if (shortcut === 'today' && selected <= now) {
        const safeToday = domain.defaultTodoDeadlineForScope('today', now);
        if (safeToday) selected = new Date(safeToday);
      }
      year = selected.getFullYear();
      month = selected.getMonth();
      day = selected.getDate();
      fillTimeOptions();
      if (hourSelect) hourSelect.value = String(selected.getHours());
      if (minuteSelect) minuteSelect.value = String(selected.getMinutes());
      renderCalendar();
      applySelection(true);
    }

    function applyDefaultDeadline(trigger, now = new Date()) {
      if (!trigger || (trigger.dataset.deadline && trigger.dataset.deadlineSource !== 'default')) return;
      const deadline = domain.defaultTodoDeadlineForScope(getTimeScope(), now);
      if (!deadline) {
        delete trigger.dataset.deadline;
        delete trigger.dataset.deadlineSource;
        trigger.querySelector('span').textContent = '选择日期';
        trigger.classList.remove('selected');
        return;
      }
      trigger.dataset.deadline = deadline;
      trigger.dataset.deadlineSource = 'default';
      trigger.querySelector('span').textContent = new Intl.DateTimeFormat('zh-CN', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(deadline));
      trigger.classList.add('selected');
    }

    function resetDraftDeadline(trigger, now = new Date()) {
      if (!trigger) return;
      delete trigger.dataset.deadline;
      delete trigger.dataset.deadlineSource;
      applyDefaultDeadline(trigger, now);
    }

    function refreshDefaultDeadlines(now = new Date()) {
      documentRef.querySelectorAll('.todo-deadline-trigger[data-deadline-priority]').forEach((trigger) => {
        if (trigger.dataset.deadlineSource === 'manual') return;
        applyDefaultDeadline(trigger, now);
      });
    }

    calendarGrid?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-day]');
      if (!button) return;
      day = Number(button.dataset.day);
      renderCalendar();
      applySelection(true);
    });
    documentRef.querySelectorAll('[data-todo-date-shortcut]').forEach((button) => {
      button.addEventListener('click', () => applyShortcut(button.dataset.todoDateShortcut));
    });
    calendarPrevious?.addEventListener('click', () => moveCalendar(-1));
    calendarNext?.addEventListener('click', () => moveCalendar(1));
    hourSelect?.addEventListener('change', () => applySelection(true));
    minuteSelect?.addEventListener('change', () => applySelection(true));
    documentRef.addEventListener('pointerdown', (event) => {
      if (backdrop?.hidden) return;
      if (backdrop.contains(event.target) || event.target.closest('.todo-deadline-trigger, .todo-inline-deadline')) return;
      close();
    }, true);

    return {
      applyDefaultDeadline,
      applySelection,
      applyShortcut,
      close,
      fillTimeOptions,
      getContext: () => context,
      isOpen: () => Boolean(context),
      moveCalendar,
      open,
      refreshDefaultDeadlines,
      renderCalendar,
      resetDraftDeadline,
      selectedDeadline,
    };
  }

  global.NotchTodoEditor = { createTodoEditorController };
})(window);
