(function exposeWorkspaceLinksDrag() {
  function createController(host) {
    const {
      Domain,
      elements,
      getGroups,
      setGroups,
      render,
      setStatus,
    } = host;
    const { linkGroupsEl, linksSearch, groupFilter } = elements;
    if (!linkGroupsEl) return Object.freeze({});

    const LINK_DRAG_HOLD_MS = 340;
    const LINK_DRAG_MOVE_CANCEL = 8;
    let linkDrag = null;
    let suppressLinkClick = false;

    function clearDropMarks() {
      linkGroupsEl.querySelectorAll('.drop-before, .drop-after, .drop-target').forEach((item) => {
        item.classList.remove('drop-before', 'drop-after', 'drop-target');
      });
    }

    function cancelDrag() {
      if (!linkDrag) return;
      clearTimeout(linkDrag.holdTimer);
      if (linkDrag.active) {
        linkDrag.row.classList.remove('dragging');
        linkGroupsEl.classList.remove('link-dragging');
        clearDropMarks();
      }
      try { linkDrag.row.releasePointerCapture(linkDrag.pointerId); } catch (error) {}
      linkDrag = null;
    }

    function updateDropTarget(clientX, clientY) {
      clearDropMarks();
      linkDrag.target = null;
      const under = document.elementFromPoint(clientX, clientY);
      if (!under || !linkGroupsEl.contains(under)) return;
      const overRow = under.closest('.link-item[data-link-id]');
      if (overRow === linkDrag.row) return;
      if (overRow) {
        const rect = overRow.getBoundingClientRect();
        const after = clientY > rect.top + rect.height / 2;
        overRow.classList.add(after ? 'drop-after' : 'drop-before');
        const rows = Array.from(overRow.parentElement.children).filter((item) => item.dataset && item.dataset.linkId);
        linkDrag.target = {
          groupId: overRow.dataset.groupId,
          index: rows.indexOf(overRow) + (after ? 1 : 0),
        };
        return;
      }
      const overGroup = under.closest('.link-group[data-group-id]');
      if (!overGroup) return;
      overGroup.classList.add('drop-target');
      linkDrag.target = { groupId: overGroup.dataset.groupId, index: null };
    }

    function orderFingerprint(groups) {
      return groups.map((group) => `${group.id}:${(group.links || []).map((link) => link.id).join(',')}`).join('|');
    }

    linkGroupsEl.addEventListener('pointerdown', (event) => {
      if (linksSearch?.value.trim() || groupFilter?.value) return;
      if (event.button !== 0) return;
      const row = event.target.closest('.link-item[data-link-id]');
      if (!row || event.target.closest('input, .link-actions')) return;
      suppressLinkClick = false;
      cancelDrag();
      linkDrag = {
        row,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        target: null,
        holdTimer: setTimeout(() => {
          if (!linkDrag) return;
          linkDrag.active = true;
          row.classList.add('dragging');
          linkGroupsEl.classList.add('link-dragging');
          try { row.setPointerCapture(linkDrag.pointerId); } catch (error) {}
          updateDropTarget(linkDrag.startX, linkDrag.startY);
          setStatus('拖到目标位置后松手');
        }, LINK_DRAG_HOLD_MS),
      };
    });

    document.addEventListener('pointermove', (event) => {
      if (!linkDrag || event.pointerId !== linkDrag.pointerId) return;
      if (!linkDrag.active) {
        const moved = Math.abs(event.clientX - linkDrag.startX) > LINK_DRAG_MOVE_CANCEL
          || Math.abs(event.clientY - linkDrag.startY) > LINK_DRAG_MOVE_CANCEL;
        if (moved) cancelDrag();
        return;
      }
      event.preventDefault();
      updateDropTarget(event.clientX, event.clientY);
    });

    document.addEventListener('pointerup', (event) => {
      if (!linkDrag || event.pointerId !== linkDrag.pointerId) return;
      const wasActive = linkDrag.active;
      const target = linkDrag.target;
      const linkId = linkDrag.row.dataset.linkId;
      cancelDrag();
      if (!wasActive) return;
      suppressLinkClick = true;
      if (!target) {
        setStatus('');
        return;
      }
      const groups = getGroups();
      const before = orderFingerprint(groups);
      const nextGroups = Domain.moveLinkToPosition(groups, linkId, target.groupId, target.index);
      if (orderFingerprint(nextGroups) === before) {
        setStatus('');
        return;
      }
      setGroups(nextGroups);
      host.persist();
      render();
      setStatus('链接顺序已更新');
    });

    document.addEventListener('pointercancel', cancelDrag);
    linkGroupsEl.addEventListener('click', (event) => {
      if (!suppressLinkClick) return;
      suppressLinkClick = false;
      event.stopPropagation();
      event.preventDefault();
    }, true);

    return Object.freeze({ cancelDrag });
  }

  window.NotchWorkspaceLinksDrag = Object.freeze({ createController });
})();
