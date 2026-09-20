(function exposeNotesTaxonomy(root, factory) {
  const api = factory();
  if (root) root.NotchNotesTaxonomy = api;
})(typeof window !== 'undefined' ? window : globalThis, function createNotesTaxonomyApi() {
  'use strict';

  function createController(host = {}) {
    const documentRef = host.document || document;
    const domain = host.domain || window.NotchDomain;
    const store = host.store || window.NotchNotesStore;
    const elements = host.getElements ? host.getElements() : {
      tree: documentRef.getElementById('notes-taxonomy-tree'),
      count: documentRef.getElementById('notes-taxonomy-count'),
      categoryFilter: documentRef.getElementById('notes-category-filter'),
      categoryAdd: documentRef.getElementById('notes-category-add'),
      categoryRename: documentRef.getElementById('notes-category-rename'),
      categoryDelete: documentRef.getElementById('notes-category-delete'),
      categoryEditor: documentRef.getElementById('notes-category-editor'),
      categoryName: documentRef.getElementById('notes-category-name'),
      categorySave: documentRef.getElementById('notes-category-save'),
      categoryCancel: documentRef.getElementById('notes-category-cancel'),
      categoryConfirm: documentRef.getElementById('notes-category-confirm'),
      categoryConfirmText: documentRef.getElementById('notes-category-confirm-text'),
      categoryDeleteCancel: documentRef.getElementById('notes-category-delete-cancel'),
      categoryDeleteConfirm: documentRef.getElementById('notes-category-delete-confirm'),
      tagToolbar: documentRef.getElementById('notes-tag-toolbar'),
      tagFilter: documentRef.getElementById('notes-tag-filter'),
      tagAdd: documentRef.getElementById('notes-tag-add'),
      tagRename: documentRef.getElementById('notes-tag-rename'),
      tagDelete: documentRef.getElementById('notes-tag-delete'),
      tagEditor: documentRef.getElementById('notes-tag-editor'),
      tagName: documentRef.getElementById('notes-tag-name'),
      tagSave: documentRef.getElementById('notes-tag-save'),
      tagCancel: documentRef.getElementById('notes-tag-cancel'),
      tagConfirm: documentRef.getElementById('notes-tag-confirm'),
      tagConfirmText: documentRef.getElementById('notes-tag-confirm-text'),
      tagDeleteCancel: documentRef.getElementById('notes-tag-delete-cancel'),
      tagDeleteConfirm: documentRef.getElementById('notes-tag-delete-confirm'),
    };
    const getArchive = () => host.getArchive ? host.getArchive() : store.loadArchive();
    const getCategories = () => host.getCategories ? host.getCategories() : store.loadCategories();
    const saveArchive = (notes) => host.saveArchive ? host.saveArchive(notes) : store.saveArchive(notes);
    const saveCategories = (categories) => host.saveCategories ? host.saveCategories(categories) : store.saveCategories(categories);
    const generateId = () => host.generateId?.() || `note-${Date.now()}`;
    const showStatusToast = (message) => host.showStatusToast?.(message);
    const syncWorkspaceSnapshot = () => host.syncWorkspaceSnapshot?.();
    const flushEditorSave = () => host.flushEditorSave?.();
    const renderLibrary = () => host.renderLibrary?.();
    const now = () => host.now?.() || Date.now();
    let categoryEditorMode = '';
    let tagEditorMode = '';
    const expandedCategories = new Set();

    function selectedCategory(categories = getCategories()) {
      const id = String(elements.categoryFilter?.value || '');
      return categories.find((category) => category.id === id) || null;
    }

    function selectedTag(category = selectedCategory()) {
      const id = String(elements.tagFilter?.value || '');
      return category?.tags.find((tag) => tag.id === id) || null;
    }

    function taxonomyAction(action, label, icon) {
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.className = 'notes-taxonomy-action';
      button.dataset.notesTaxonomyAction = action;
      button.setAttribute('aria-label', label);
      button.title = label;
      button.innerHTML = icon;
      return button;
    }

    function taxonomySelect(label, count, scope, isSelected, categoryId = '', tagId = '') {
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.className = `notes-taxonomy-select${isSelected ? ' active' : ''}`;
      button.dataset.notesTaxonomyScope = scope;
      if (categoryId) button.dataset.categoryId = categoryId;
      if (tagId) button.dataset.tagId = tagId;
      button.setAttribute('aria-current', isSelected ? 'true' : 'false');
      const name = documentRef.createElement('span');
      name.textContent = label;
      const total = documentRef.createElement('small');
      total.textContent = String(count);
      button.append(name, total);
      return button;
    }

    function renderCategoryControls(categories, archive) {
      const filter = elements.categoryFilter;
      if (!filter) return;
      const selected = filter.value;
      const counts = new Map(categories.map((category) => [category.id, 0]));
      let uncategorized = 0;
      archive.forEach((note) => {
        if (counts.has(note.categoryId)) counts.set(note.categoryId, counts.get(note.categoryId) + 1);
        else uncategorized += 1;
      });
      filter.replaceChildren();
      const all = documentRef.createElement('option');
      all.value = '';
      all.textContent = `全部分类 (${archive.length})`;
      const empty = documentRef.createElement('option');
      empty.value = '__uncategorized__';
      empty.textContent = `未分类 (${uncategorized})`;
      filter.append(all, empty);
      categories.forEach((category) => {
        const option = documentRef.createElement('option');
        option.value = category.id;
        option.textContent = `${category.name} (${counts.get(category.id) || 0})`;
        filter.append(option);
      });
      filter.value = [...filter.options].some((option) => option.value === selected) ? selected : '';
      const customSelected = Boolean(selectedCategory(categories));
      if (elements.categoryAdd) elements.categoryAdd.disabled = categories.length >= 40;
      if (elements.categoryRename) elements.categoryRename.disabled = !customSelected;
      if (elements.categoryDelete) elements.categoryDelete.disabled = !customSelected;
    }

    function renderTagControls(category, archive) {
      const toolbar = elements.tagToolbar;
      const filter = elements.tagFilter;
      if (!toolbar || !filter) return;
      toolbar.hidden = !category;
      if (!category) {
        filter.replaceChildren();
        if (elements.tagEditor) elements.tagEditor.hidden = true;
        if (elements.tagConfirm) elements.tagConfirm.hidden = true;
        return;
      }
      const selected = filter.value;
      const categoryNotes = archive.filter((note) => note.categoryId === category.id);
      const counts = new Map(category.tags.map((tag) => [tag.id, 0]));
      let untagged = 0;
      categoryNotes.forEach((note) => {
        if (counts.has(note.tagId)) counts.set(note.tagId, counts.get(note.tagId) + 1);
        else untagged += 1;
      });
      filter.replaceChildren();
      const all = documentRef.createElement('option');
      all.value = '';
      all.textContent = `全部标签 (${categoryNotes.length})`;
      const empty = documentRef.createElement('option');
      empty.value = '__untagged__';
      empty.textContent = `无标签 (${untagged})`;
      filter.append(all, empty);
      category.tags.forEach((tag) => {
        const option = documentRef.createElement('option');
        option.value = tag.id;
        option.textContent = `${tag.name} (${counts.get(tag.id) || 0})`;
        filter.append(option);
      });
      filter.value = [...filter.options].some((option) => option.value === selected) ? selected : '';
      const customSelected = Boolean(selectedTag(category));
      if (elements.tagAdd) elements.tagAdd.disabled = category.tags.length >= 30;
      if (elements.tagRename) elements.tagRename.disabled = !customSelected;
      if (elements.tagDelete) elements.tagDelete.disabled = !customSelected;
    }

    function renderTree(categories, archive) {
      const tree = elements.tree;
      if (!tree) return;
      if (elements.count) elements.count.textContent = `${categories.length} 个分类`;
      const categoryId = String(elements.categoryFilter?.value || '');
      const tagId = String(elements.tagFilter?.value || '');
      tree.replaceChildren(
        taxonomySelect('全部笔记', archive.length, 'all', !categoryId),
        taxonomySelect('未分类', archive.filter((note) => !note.categoryId).length, 'uncategorized', categoryId === '__uncategorized__')
      );
      const plusIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
      const editIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 16 9.5-9.5 4 4L8 20H4zM12 8l4 4"/></svg>';
      const deleteIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12"/></svg>';
      categories.forEach((category) => {
        const group = documentRef.createElement('section');
        group.className = 'notes-taxonomy-group';
        const row = documentRef.createElement('div');
        row.className = 'notes-taxonomy-row';
        const expanded = expandedCategories.has(category.id);
        const toggle = documentRef.createElement('button');
        toggle.type = 'button';
        toggle.className = 'notes-taxonomy-toggle';
        toggle.dataset.notesTaxonomyToggle = category.id;
        toggle.setAttribute('aria-label', `${expanded ? '折叠' : '展开'}${category.name}`);
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>';
        const count = archive.filter((note) => note.categoryId === category.id).length;
        const select = taxonomySelect(category.name, count, 'category', categoryId === category.id && !tagId, category.id);
        const actions = documentRef.createElement('div');
        actions.className = 'notes-taxonomy-actions';
        const addTag = taxonomyAction('add-tag', `在${category.name}中新建标签`, plusIcon);
        addTag.dataset.categoryId = category.id;
        const rename = taxonomyAction('rename-category', `重命名${category.name}`, editIcon);
        rename.dataset.categoryId = category.id;
        const remove = taxonomyAction('delete-category', `删除${category.name}`, deleteIcon);
        remove.dataset.categoryId = category.id;
        remove.classList.add('danger');
        actions.append(addTag, rename, remove);
        row.append(toggle, select, actions);
        group.append(row);
        if (expanded) {
          const children = documentRef.createElement('div');
          children.className = 'notes-taxonomy-children';
          const untagged = archive.filter((note) => note.categoryId === category.id && !note.tagId).length;
          children.append(taxonomySelect('无标签', untagged, 'untagged', categoryId === category.id && tagId === '__untagged__', category.id, '__untagged__'));
          category.tags.forEach((tag) => {
            const tagRow = documentRef.createElement('div');
            tagRow.className = 'notes-taxonomy-row tag';
            const tagCount = archive.filter((note) => note.categoryId === category.id && note.tagId === tag.id).length;
            const tagSelect = taxonomySelect(tag.name, tagCount, 'tag', categoryId === category.id && tagId === tag.id, category.id, tag.id);
            const tagActions = documentRef.createElement('div');
            tagActions.className = 'notes-taxonomy-actions';
            const renameTag = taxonomyAction('rename-tag', `重命名${tag.name}`, editIcon);
            renameTag.dataset.categoryId = category.id;
            renameTag.dataset.tagId = tag.id;
            const removeTag = taxonomyAction('delete-tag', `删除${tag.name}`, deleteIcon);
            removeTag.dataset.categoryId = category.id;
            removeTag.dataset.tagId = tag.id;
            removeTag.classList.add('danger');
            tagActions.append(renameTag, removeTag);
            tagRow.append(tagSelect, tagActions);
            children.append(tagRow);
          });
          group.append(children);
        }
        tree.append(group);
      });
    }

    function closeTagControls() {
      tagEditorMode = '';
      if (elements.tagEditor) elements.tagEditor.hidden = true;
      if (elements.tagConfirm) elements.tagConfirm.hidden = true;
      if (elements.tagName) {
        elements.tagName.value = '';
        elements.tagName.removeAttribute('aria-invalid');
      }
    }

    function closeCategoryControls() {
      categoryEditorMode = '';
      if (elements.categoryEditor) elements.categoryEditor.hidden = true;
      if (elements.categoryConfirm) elements.categoryConfirm.hidden = true;
      if (elements.categoryName) {
        elements.categoryName.value = '';
        elements.categoryName.removeAttribute('aria-invalid');
      }
    }

    function openTagEditor(mode) {
      closeCategoryControls();
      const category = selectedCategory();
      const tag = selectedTag(category);
      if (!category || (mode === 'rename' && !tag)) return;
      tagEditorMode = mode;
      if (elements.tagConfirm) elements.tagConfirm.hidden = true;
      if (elements.tagEditor) elements.tagEditor.hidden = false;
      if (elements.tagName) {
        elements.tagName.value = mode === 'rename' ? tag.name : '';
        elements.tagName.removeAttribute('aria-invalid');
        requestAnimationFrame(() => {
          elements.tagName.focus({ preventScroll: true });
          elements.tagName.select();
        });
      }
    }

    function openCategoryEditor(mode) {
      closeTagControls();
      const category = selectedCategory();
      if (mode === 'rename' && !category) return;
      categoryEditorMode = mode;
      if (elements.categoryConfirm) elements.categoryConfirm.hidden = true;
      if (elements.categoryEditor) elements.categoryEditor.hidden = false;
      if (elements.categoryName) {
        elements.categoryName.value = mode === 'rename' ? category.name : '';
        elements.categoryName.removeAttribute('aria-invalid');
        requestAnimationFrame(() => {
          elements.categoryName.focus({ preventScroll: true });
          elements.categoryName.select();
        });
      }
    }

    function select(categoryId, tagId = '') {
      flushEditorSave();
      closeCategoryControls();
      closeTagControls();
      if (elements.categoryFilter) elements.categoryFilter.value = categoryId;
      if (elements.tagFilter) elements.tagFilter.value = '';
      if (categoryId && categoryId !== '__uncategorized__') expandedCategories.add(categoryId);
      renderLibrary();
      if (elements.tagFilter && tagId) {
        elements.tagFilter.value = tagId;
        renderLibrary();
      }
    }

    function render(categories = getCategories(), archive = getArchive()) {
      renderCategoryControls(categories, archive);
      const category = selectedCategory(categories);
      renderTagControls(category, archive);
      renderTree(categories, archive);
    }

    function saveCategoryEdit() {
      if (!categoryEditorMode || !elements.categoryName) return;
      const mode = categoryEditorMode;
      const name = domain.normalizeNoteCategoryName(elements.categoryName.value);
      const categories = getCategories();
      const current = selectedCategory(categories);
      const duplicate = categories.some((category) => category.id !== current?.id && category.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (!name || duplicate || (mode === 'create' && categories.length >= 40)) {
        elements.categoryName.setAttribute('aria-invalid', 'true');
        showStatusToast(!name ? '请输入分类名称' : duplicate ? '已有同名分类' : '最多创建 40 个分类');
        return;
      }
      const categoryId = mode === 'rename' && current ? current.id : `note-category-${generateId()}`;
      const next = mode === 'rename'
        ? categories.map((category) => category.id === categoryId ? { ...category, name } : category)
        : [...categories, { id: categoryId, name, tags: [] }];
      try { saveCategories(next); }
      catch (error) { showStatusToast('分类保存失败，请检查存储空间'); return; }
      closeCategoryControls();
      renderLibrary();
      showStatusToast(mode === 'rename' ? '分类已重命名' : '分类已创建');
      void syncWorkspaceSnapshot();
    }

    function deleteCategory() {
      const category = selectedCategory();
      if (!category) return;
      flushEditorSave();
      const result = domain.removeNoteCategory(getCategories(), getArchive(), category.id, now());
      try {
        saveArchive(result.notes);
        saveCategories(result.categories);
      } catch (error) { showStatusToast('分类删除失败，请检查存储空间'); return; }
      closeCategoryControls();
      closeTagControls();
      if (elements.categoryFilter) elements.categoryFilter.value = '__uncategorized__';
      renderLibrary();
      showStatusToast('分类已删除，笔记已移至未分类');
      void syncWorkspaceSnapshot();
    }

    function saveTagEdit() {
      if (!tagEditorMode || !elements.tagName) return;
      const mode = tagEditorMode;
      const name = domain.normalizeNoteCategoryName(elements.tagName.value);
      const categories = getCategories();
      const category = selectedCategory(categories);
      const current = selectedTag(category);
      if (!category) return;
      const duplicate = category.tags.some((tag) => tag.id !== current?.id && tag.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (!name || duplicate || (mode === 'create' && category.tags.length >= 30)) {
        elements.tagName.setAttribute('aria-invalid', 'true');
        showStatusToast(!name ? '请输入标签名称' : duplicate ? '当前分类已有同名标签' : '每个分类最多创建 30 个标签');
        return;
      }
      const tagId = mode === 'rename' && current ? current.id : `note-tag-${generateId()}`;
      const tags = mode === 'rename'
        ? category.tags.map((tag) => tag.id === tagId ? { ...tag, name } : tag)
        : [...category.tags, { id: tagId, name }];
      try { saveCategories(categories.map((item) => item.id === category.id ? { ...item, tags } : item)); }
      catch (error) { showStatusToast('标签保存失败，请检查存储空间'); return; }
      closeTagControls();
      renderLibrary();
      showStatusToast(mode === 'rename' ? '标签已重命名' : '标签已创建');
      void syncWorkspaceSnapshot();
    }

    function deleteTag() {
      const category = selectedCategory();
      const tag = selectedTag(category);
      if (!category || !tag) return;
      flushEditorSave();
      const result = domain.removeNoteTag(getCategories(), getArchive(), category.id, tag.id, now());
      try {
        saveArchive(result.notes);
        saveCategories(result.categories);
      } catch (error) { showStatusToast('标签删除失败，请检查存储空间'); return; }
      closeTagControls();
      if (elements.tagFilter) elements.tagFilter.value = '__untagged__';
      renderLibrary();
      showStatusToast('标签已删除，笔记已移至无标签');
      void syncWorkspaceSnapshot();
    }

    elements.tree?.addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-notes-taxonomy-toggle]');
      if (toggle) {
        const categoryId = toggle.dataset.notesTaxonomyToggle;
        if (expandedCategories.has(categoryId)) expandedCategories.delete(categoryId);
        else expandedCategories.add(categoryId);
        renderTree(getCategories(), getArchive());
        return;
      }
      const action = event.target.closest('[data-notes-taxonomy-action]');
      if (action) {
        select(action.dataset.categoryId || '', action.dataset.tagId || '');
        const type = action.dataset.notesTaxonomyAction;
        if (type === 'add-tag') openTagEditor('create');
        if (type === 'rename-category') openCategoryEditor('rename');
        if (type === 'delete-category') elements.categoryDelete?.click();
        if (type === 'rename-tag') openTagEditor('rename');
        if (type === 'delete-tag') elements.tagDelete?.click();
        return;
      }
      const item = event.target.closest('[data-notes-taxonomy-scope]');
      if (!item) return;
      const scope = item.dataset.notesTaxonomyScope;
      if (scope === 'all') select('');
      else if (scope === 'uncategorized') select('__uncategorized__');
      else select(item.dataset.categoryId || '', scope === 'category' ? '' : item.dataset.tagId || '');
    });

    elements.tree?.addEventListener('keydown', (event) => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      const items = [...elements.tree.querySelectorAll('.notes-taxonomy-select')];
      const index = items.indexOf(documentRef.activeElement);
      if (index < 0 || !items.length) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    });

    elements.categoryFilter?.addEventListener('change', () => {
      flushEditorSave();
      closeCategoryControls();
      closeTagControls();
      if (elements.tagFilter) elements.tagFilter.value = '';
      const category = selectedCategory();
      if (category) expandedCategories.add(category.id);
      renderLibrary();
    });
    elements.tagFilter?.addEventListener('change', () => {
      flushEditorSave();
      closeTagControls();
      renderLibrary();
    });
    elements.categoryAdd?.addEventListener('click', () => openCategoryEditor('create'));
    elements.categoryRename?.addEventListener('click', () => openCategoryEditor('rename'));
    elements.categoryCancel?.addEventListener('click', closeCategoryControls);
    elements.categoryDeleteCancel?.addEventListener('click', closeCategoryControls);
    elements.categoryDelete?.addEventListener('click', () => {
      const category = selectedCategory();
      if (!category || !elements.categoryConfirm) return;
      categoryEditorMode = '';
      if (elements.categoryEditor) elements.categoryEditor.hidden = true;
      elements.categoryConfirm.hidden = false;
      if (elements.categoryConfirmText) elements.categoryConfirmText.textContent = `删除“${category.name}”？其中笔记将移至未分类。`;
      elements.categoryDeleteCancel?.focus({ preventScroll: true });
    });
    elements.categorySave?.addEventListener('click', saveCategoryEdit);
    elements.categoryName?.addEventListener('input', () => elements.categoryName.removeAttribute('aria-invalid'));
    elements.categoryName?.addEventListener('keydown', (event) => {
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); saveCategoryEdit(); }
      if (event.key === 'Escape') { event.preventDefault(); closeCategoryControls(); elements.categoryFilter?.focus(); }
    });
    elements.categoryDeleteConfirm?.addEventListener('click', deleteCategory);
    elements.tagAdd?.addEventListener('click', () => openTagEditor('create'));
    elements.tagRename?.addEventListener('click', () => openTagEditor('rename'));
    elements.tagCancel?.addEventListener('click', closeTagControls);
    elements.tagDeleteCancel?.addEventListener('click', closeTagControls);
    elements.tagDelete?.addEventListener('click', () => {
      const category = selectedCategory();
      const tag = selectedTag(category);
      if (!category || !tag || !elements.tagConfirm) return;
      tagEditorMode = '';
      if (elements.tagEditor) elements.tagEditor.hidden = true;
      elements.tagConfirm.hidden = false;
      if (elements.tagConfirmText) elements.tagConfirmText.textContent = `删除“${tag.name}”？笔记将保留在“${category.name}”。`;
      elements.tagDeleteCancel?.focus({ preventScroll: true });
    });
    elements.tagSave?.addEventListener('click', saveTagEdit);
    elements.tagName?.addEventListener('input', () => elements.tagName.removeAttribute('aria-invalid'));
    elements.tagName?.addEventListener('keydown', (event) => {
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); saveTagEdit(); }
      if (event.key === 'Escape') { event.preventDefault(); closeTagControls(); elements.tagFilter?.focus(); }
    });
    elements.tagDeleteConfirm?.addEventListener('click', deleteTag);

    return Object.freeze({
      render,
      select,
      selectedCategory,
      selectedTag,
      selectedCategoryId: () => String(elements.categoryFilter?.value || ''),
      selectedTagId: () => String(elements.tagFilter?.value || ''),
      clearSelection() {
        closeCategoryControls();
        closeTagControls();
        if (elements.categoryFilter) elements.categoryFilter.value = '';
        if (elements.tagFilter) elements.tagFilter.value = '';
      },
      closeCategoryControls,
      closeTagControls,
      dispose() {},
    });
  }

  return { createController };
});
