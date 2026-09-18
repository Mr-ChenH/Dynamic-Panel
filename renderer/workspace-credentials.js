(function initWorkspaceCredentials() {
  const Domain = window.NotchDomain;
  if (!Domain) return;

  const credentialService = document.getElementById('credential-service');
  const credentialAccount = document.getElementById('credential-account');
  const credentialPassword = document.getElementById('credential-password');
  const credentialSave = document.getElementById('credential-save');
  const credentialList = document.getElementById('credential-list');
  const credentialCount = document.getElementById('credential-count');
  const credentialSearch = document.getElementById('credential-search');
  const credentialBulkDelete = document.getElementById('credential-bulk-delete');
  const credentialsNote = document.getElementById('credentials-note');
  let credentials = [];
  let credentialSelection = new Set();
  let credentialAnchor = null;
  let editingCredentialId = '';
  let editingCredential = null;

  function updateCredentialBulkAction() {
    if (!credentialBulkDelete) return;
    credentialBulkDelete.hidden = credentialSelection.size === 0;
    credentialBulkDelete.textContent = '删除';
    credentialBulkDelete.setAttribute('aria-label', credentialSelection.size ? `删除 ${credentialSelection.size} 项` : '删除所选');
  }

  function animateCredentialExpansion(originRect) {
    const row = credentialList?.querySelector(`.credential-item.editing[data-id="${CSS.escape(editingCredentialId)}"]`);
    if (!row || !originRect || typeof row.animate !== 'function') return;
    requestAnimationFrame(() => {
      const targetRect = row.getBoundingClientRect();
      const scaleX = Math.max(0.2, originRect.width / Math.max(1, targetRect.width));
      const scaleY = Math.max(0.2, originRect.height / Math.max(1, targetRect.height));
      row.animate([
        { opacity: .72, transform: `translate(${originRect.left - targetRect.left}px, ${originRect.top - targetRect.top}px) scale(${scaleX}, ${scaleY})`, transformOrigin: 'top left' },
        { opacity: 1, transform: 'translate(0, 0) scale(1)', transformOrigin: 'top left' },
      ], { duration: 360, easing: 'cubic-bezier(.2,.9,.2,1)', fill: 'both' });
    });
  }

  function renderCredentials() {
    const visibleCredentials = Domain.filterCredentials(credentials, credentialSearch?.value || '');
    if (credentialCount) credentialCount.textContent = credentialSearch?.value.trim() ? `${visibleCredentials.length} / ${credentials.length} 项` : `${credentials.length} 项`;
    if (!credentialList) return;
    credentialList.replaceChildren();
    if (!visibleCredentials.length) {
      const empty = document.createElement('div');
      empty.className = 'credential-empty';
      empty.innerHTML = credentials.length ? '<strong>没有匹配的密钥</strong><span>可按名称或账号继续检索</span>' : '<strong>还没有保存密钥</strong><span>账号与密码会加密保存在本机</span>';
      credentialList.appendChild(empty);
      updateCredentialBulkAction();
      return;
    }
    visibleCredentials.forEach((credential) => {
      if (editingCredentialId === credential.id && editingCredential) {
        const form = document.createElement('form');
        form.className = 'credential-item editing';
        form.dataset.id = credential.id;
        form.innerHTML = `
          <div class="credential-edit-head"><strong>修改密钥</strong><span>回车保存</span></div>
          <label><span>服务</span><input name="service" maxlength="80" autocomplete="off" /></label>
          <label><span>账号</span><input name="account" maxlength="320" autocomplete="off" /></label>
          <label><span>密码</span><input name="password" type="text" maxlength="4096" autocomplete="off" spellcheck="false" /></label>
          <div class="credential-edit-actions"><button type="button" data-credential-cancel>取消</button><button type="submit">保存</button></div>`;
        form.elements.service.value = editingCredential.service || '';
        form.elements.account.value = editingCredential.account || '';
        form.elements.password.value = editingCredential.password || '';
        credentialList.appendChild(form);
        return;
      }
      const row = document.createElement('article');
      row.className = `credential-item${credentialSelection.has(credential.id) ? ' multi-selected' : ''}`;
      row.dataset.id = credential.id;
      row.tabIndex = 0;
      const copy = document.createElement('div');
      copy.className = 'credential-copy';
      const service = document.createElement('strong');
      service.textContent = credential.service;
      const account = document.createElement('span');
      account.textContent = credential.account;
      const password = document.createElement('code');
      password.textContent = credential.passwordMask || '**********';
      copy.append(service, account, password);
      const actions = document.createElement('div');
      actions.className = 'credential-actions';
      const accountCopy = document.createElement('button');
      accountCopy.type = 'button'; accountCopy.dataset.credentialCopy = 'account'; accountCopy.textContent = '账号'; accountCopy.setAttribute('aria-label', '复制账号');
      const passwordCopy = document.createElement('button');
      passwordCopy.type = 'button'; passwordCopy.dataset.credentialCopy = 'password'; passwordCopy.textContent = '密码'; passwordCopy.setAttribute('aria-label', '复制密码');
      const deleteAction = Domain.credentialRowAction({ requestedAction: 'delete' });
      const remove = document.createElement('button');
      remove.type = 'button'; remove.dataset.credentialDelete = 'true'; remove.textContent = deleteAction.label; remove.setAttribute('aria-label', deleteAction.ariaLabel);
      actions.append(accountCopy, passwordCopy, remove);
      row.append(copy, actions);
      credentialList.appendChild(row);
    });
    updateCredentialBulkAction();
  }

  async function loadCredentials() {
    if (!window.notchAPI || typeof window.notchAPI.listCredentials !== 'function') return;
    let result;
    try { result = await window.notchAPI.listCredentials(); } catch (error) { result = null; }
    credentials = result && Array.isArray(result.items) ? result.items : [];
    if (credentialsNote && result && !result.secureStorage) {
      credentialsNote.textContent = '当前系统安全存储不可用，暂时无法保存密码。';
      credentialsNote.classList.add('error');
    }
    renderCredentials();
  }

  async function saveCredential() {
    if (!credentialSave || !window.notchAPI) return;
    const payload = { service: credentialService?.value || '', account: credentialAccount?.value || '', password: credentialPassword?.value || '' };
    if (!payload.service.trim() || !payload.account.trim() || !payload.password) {
      if (credentialsNote) { credentialsNote.textContent = '请完整填写软件、账号和密码。'; credentialsNote.classList.add('error'); }
      return;
    }
    credentialSave.disabled = true;
    const result = await window.notchAPI.saveCredential(payload).catch(() => ({ ok: false }));
    credentialSave.disabled = false;
    if (!result?.ok) {
      if (credentialsNote) { credentialsNote.textContent = '加密保存失败，请确认系统钥匙串可用。'; credentialsNote.classList.add('error'); }
      return;
    }
    if (credentialService) credentialService.value = '';
    if (credentialAccount) credentialAccount.value = '';
    if (credentialPassword) { credentialPassword.value = ''; credentialPassword.placeholder = '保存后才会加密'; }
    if (credentialsNote) { credentialsNote.textContent = '已使用系统安全存储加密保存。'; credentialsNote.classList.remove('error'); }
    await loadCredentials();
    credentialService?.focus();
  }

  credentialSave?.addEventListener('click', saveCredential);
  credentialSearch?.addEventListener('input', renderCredentials);
  [credentialService, credentialAccount, credentialPassword].forEach((input) => input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); saveCredential(); }
  }));
  credentialList?.addEventListener('click', async (event) => {
    const row = event.target.closest('.credential-item[data-id]');
    if (!row) return;
    if (event.target.closest('[data-credential-cancel]')) { editingCredentialId = ''; editingCredential = null; renderCredentials(); return; }
    if (row.classList.contains('editing')) return;
    const copyField = event.target.closest('[data-credential-copy]')?.dataset.credentialCopy;
    const action = Domain.credentialRowAction({ requestedAction: event.target.closest('[data-credential-delete]') ? 'delete' : '', copyField, rowBody: Boolean(event.target.closest('.credential-copy')), shiftKey: event.shiftKey, selected: credentialSelection.has(row.dataset.id) });
    if (action.type === 'delete') {
      const deleteButton = event.target.closest('[data-credential-delete]');
      if (deleteButton) deleteButton.disabled = true;
      const result = await window.notchAPI.deleteCredentials([row.dataset.id]).catch(() => ({ ok: false }));
      if (!result?.ok) { if (deleteButton) deleteButton.disabled = false; if (credentialsNote) { credentialsNote.textContent = '删除失败，请稍后重试。'; credentialsNote.classList.add('error'); } return; }
      credentialSelection.delete(row.dataset.id);
      if (editingCredentialId === row.dataset.id) { editingCredentialId = ''; editingCredential = null; }
      await loadCredentials();
      if (credentialsNote) { credentialsNote.textContent = '密钥已删除。'; credentialsNote.classList.remove('error'); }
      return;
    }
    if (action.type === 'copy') {
      const copied = await window.notchAPI.copyCredential(row.dataset.id, action.field).catch(() => false);
      if (credentialsNote) credentialsNote.textContent = copied ? `${copyField === 'password' ? '密码' : '账号'}已复制` : '复制失败';
      return;
    }
    if (action.type === 'edit') {
      const originRect = row.getBoundingClientRect();
      const result = await window.notchAPI.getCredential(row.dataset.id).catch(() => ({ ok: false }));
      if (!result?.ok || !result.item) return;
      editingCredentialId = result.item.id; editingCredential = result.item; renderCredentials(); animateCredentialExpansion(originRect);
      if (credentialsNote) { credentialsNote.textContent = '已展开当前密钥，回车即可保存。'; credentialsNote.classList.remove('error'); }
      credentialList.querySelector('.credential-item.editing input[name="service"]')?.focus();
      return;
    }
    const result = Domain.updateRangeSelection(Domain.filterCredentials(credentials, credentialSearch?.value || '').map((item) => item.id), [...credentialSelection], row.dataset.id, credentialAnchor, event.shiftKey, true);
    credentialSelection = new Set(result.selected); credentialAnchor = result.anchor; renderCredentials();
  });
  credentialList?.addEventListener('submit', async (event) => {
    const form = event.target.closest('.credential-item.editing[data-id]');
    if (!form) return;
    event.preventDefault();
    if (!editingCredentialId || !window.notchAPI) return;
    const payload = { id: editingCredentialId, service: form.elements.service?.value || '', account: form.elements.account?.value || '', password: form.elements.password?.value || '' };
    if (!payload.service.trim() || !payload.account.trim()) return;
    const saveButton = form.querySelector('button[type="submit"]');
    if (saveButton) saveButton.disabled = true;
    const result = await window.notchAPI.saveCredential(payload).catch(() => ({ ok: false }));
    if (saveButton) saveButton.disabled = false;
    if (!result?.ok) return;
    editingCredentialId = ''; editingCredential = null; await loadCredentials();
  });
  credentialBulkDelete?.addEventListener('click', async () => {
    if (!credentialSelection.size || !window.notchAPI) return;
    const result = await window.notchAPI.deleteCredentials([...credentialSelection]).catch(() => ({ ok: false }));
    if (!result?.ok) return;
    credentialSelection.clear(); credentialAnchor = null; await loadCredentials();
  });
  document.addEventListener('notch:clear-selection', () => {
    credentialSelection.clear();
    credentialAnchor = null;
    renderCredentials();
  });

  loadCredentials();
  window.NotchWorkspaceCredentials = Object.freeze({ load: loadCredentials });
})();
