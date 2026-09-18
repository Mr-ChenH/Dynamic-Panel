(function initWorkspaceCommands() {
  const Domain = window.NotchDomain;
  if (!Domain) return;

  const COMMANDS_KEY = 'notch-home-commands';
  const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
  const DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12"/></svg>';

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return `command-${window.crypto.randomUUID()}`;
    return `command-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function loadCommands() {
    try {
      const parsed = JSON.parse(localStorage.getItem(COMMANDS_KEY));
      return (Array.isArray(parsed) ? parsed : [])
        .map((item) => Domain.createCommand(item && item.text, item && item.id, item && item.createdAt))
        .filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  const commandInput = document.getElementById('command-add');
  const commandList = document.getElementById('command-list');
  const commandBulkDelete = document.getElementById('command-bulk-delete');
  let commands = loadCommands();
  let commandSelection = new Set();
  let commandSelectionAnchor = null;

  function persistCommands() {
    try { localStorage.setItem(COMMANDS_KEY, JSON.stringify(commands)); } catch (error) {}
  }

  function renderCommands() {
    if (!commandList) return;
    commandList.replaceChildren();
    if (commandBulkDelete) {
      commandBulkDelete.hidden = commandSelection.size === 0;
      commandBulkDelete.textContent = '删除';
      commandBulkDelete.setAttribute('aria-label', commandSelection.size ? `删除 ${commandSelection.size} 项` : '删除所选');
    }
    if (!commands.length) {
      const empty = document.createElement('div');
      empty.className = 'command-empty';
      empty.textContent = '把常用命令、提示词或回复模板放在这里';
      commandList.appendChild(empty);
      return;
    }
    commands.forEach((command) => {
      const row = document.createElement('div');
      row.className = `command-item${commandSelection.has(command.id) ? ' multi-selected' : ''}`;
      row.dataset.id = command.id;
      const textButton = document.createElement('button');
      textButton.className = 'command-text';
      textButton.type = 'button';
      textButton.dataset.action = 'edit-command';
      textButton.title = '点击修改';
      textButton.textContent = command.text;
      const actions = document.createElement('div');
      actions.className = 'command-actions';
      const copy = document.createElement('button');
      copy.className = 'icon-button';
      copy.type = 'button';
      copy.dataset.action = 'copy-command';
      copy.setAttribute('aria-label', '复制指令');
      copy.innerHTML = COPY_ICON;
      const remove = document.createElement('button');
      remove.className = 'icon-button danger';
      remove.type = 'button';
      remove.dataset.action = 'delete-command';
      remove.setAttribute('aria-label', '删除指令');
      remove.innerHTML = DELETE_ICON;
      actions.append(copy, remove);
      row.append(textButton, actions);
      commandList.appendChild(row);
    });
  }

  function editCommand(row) {
    const command = commands.find((item) => item.id === row.dataset.id);
    if (!command || row.querySelector('input')) return;
    const button = row.querySelector('.command-text');
    const input = document.createElement('input');
    input.className = 'command-edit';
    input.value = command.text;
    button.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      const value = input.value.trim();
      if (save && value) command.text = value;
      persistCommands();
      renderCommands();
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) finish(true);
      if (event.key === 'Escape') finish(false);
    });
  }

  commandInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.repeat) return;
    event.preventDefault();
    const command = Domain.createCommand(commandInput.value, uid(), Date.now());
    if (!command) return;
    commands.unshift(command);
    commandInput.value = '';
    persistCommands();
    renderCommands();
  });

  commandList?.addEventListener('click', async (event) => {
    const row = event.target.closest('.command-item');
    if (!row) return;
    const command = commands.find((item) => item.id === row.dataset.id);
    if (!command) return;
    if (event.shiftKey) {
      event.preventDefault();
      const result = Domain.updateRangeSelection(commands.map((item) => item.id), [...commandSelection], command.id, commandSelectionAnchor, true);
      commandSelection = new Set(result.selected);
      commandSelectionAnchor = result.anchor;
      renderCommands();
      return;
    }
    commandSelectionAnchor = command.id;
    const action = event.target.closest('[data-action]');
    if (!action) return;
    if (action.dataset.action === 'edit-command') editCommand(row);
    if (action.dataset.action === 'delete-command') {
      commands = commands.filter((item) => item.id !== command.id);
      commandSelection.delete(command.id);
      persistCommands();
      renderCommands();
    }
    if (action.dataset.action === 'copy-command' && window.notchAPI) {
      const copied = await window.notchAPI.writeClipboard({ type: 'text', text: command.text });
      if (copied) {
        row.classList.add('copied');
        setTimeout(() => row.classList.remove('copied'), 700);
      }
    }
  });

  commandBulkDelete?.addEventListener('click', () => {
    if (!commandSelection.size) return;
    commands = commands.filter((command) => !commandSelection.has(command.id));
    commandSelection.clear();
    commandSelectionAnchor = null;
    persistCommands();
    renderCommands();
  });

  document.addEventListener('notch:clear-selection', () => {
    commandSelection.clear();
    commandSelectionAnchor = null;
    renderCommands();
  });

  renderCommands();
})();
