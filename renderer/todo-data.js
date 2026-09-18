const TODO_DATA_STORAGE_KEY = 'notch-todo-data';
const TODO_DATA_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];

function createTodoDataId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadData() {
  try {
    const raw = localStorage.getItem(TODO_DATA_STORAGE_KEY);
    if (!raw) return { P0: [], P1: [], P2: [], P3: [] };
    const parsed = JSON.parse(raw);
    return {
      P0: normalizeTodoItems(parsed && parsed.P0),
      P1: normalizeTodoItems(parsed && parsed.P1),
      P2: normalizeTodoItems(parsed && parsed.P2),
      P3: normalizeTodoItems(parsed && parsed.P3),
    };
  } catch (error) {
    return { P0: [], P1: [], P2: [], P3: [] };
  }
}

function normalizeTodoItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') {
        const text = item.trim();
        return text ? { id: createTodoDataId(), text, done: false, createdAt: Date.now() } : null;
      }
      if (!item || typeof item !== 'object' || typeof item.text !== 'string') return null;
      const text = item.text.trim();
      if (!text) return null;
      return {
        id: typeof item.id === 'string' && item.id ? item.id : createTodoDataId(),
        text,
        done: item.done === true,
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
        deadline: Number.isFinite(Date.parse(String(item.deadline || '')))
          ? new Date(Date.parse(String(item.deadline))).toISOString()
          : '',
        remindedAt: Math.max(0, Number(item.remindedAt) || 0),
      };
    })
    .filter(Boolean);
}

function saveData(nextData) {
  try {
    localStorage.setItem(TODO_DATA_STORAGE_KEY, JSON.stringify(nextData));
  } catch (error) {
    return false;
  }
  if (window.notchAPI && typeof window.notchAPI.scheduleTodoReminders === 'function') {
    const reminders = TODO_DATA_PRIORITIES.flatMap((priority) => nextData[priority] || []);
    window.notchAPI.scheduleTodoReminders(reminders).catch(() => {});
  }
  if (typeof renderTodoPlanner === 'function') renderTodoPlanner();
  return true;
}

function allTodoItems() {
  return TODO_DATA_PRIORITIES.flatMap((priority) => (data && data[priority]) || []);
}
