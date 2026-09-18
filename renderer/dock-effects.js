(function initDockEffects() {
  function bindDockSurface(surface, selector, maxScale = 1.14) {
    if (!surface) return;
    let frame = null;
    const reset = () => {
      surface.querySelectorAll(selector).forEach((item) => {
        item.style.removeProperty('--dock-scale');
        item.style.removeProperty('--dock-lift');
        item.style.removeProperty('--dock-glow');
      });
    };
    surface.addEventListener('pointermove', (event) => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        surface.querySelectorAll(selector).forEach((item) => {
          const rect = item.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const distance = Math.hypot(event.clientX - centerX, event.clientY - centerY);
          const radius = Math.max(72, Math.min(150, rect.width * 2.2));
          const strength = Math.max(0, 1 - distance / radius) ** 2;
          item.style.setProperty('--dock-scale', (1 + (maxScale - 1) * strength).toFixed(3));
          item.style.setProperty('--dock-lift', `${(-5 * strength).toFixed(2)}px`);
          item.style.setProperty('--dock-glow', strength.toFixed(3));
        });
      });
    });
    surface.addEventListener('pointerleave', reset);
  }

  document.querySelectorAll('#window-list').forEach((surface) => {
    bindDockSurface(surface, '.window-item', 1.12);
  });
})();
