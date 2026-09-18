(function initPanelController() {
  const host = window.NotchPanelHost;
  if (!host) return;

  window.NotchPanel = Object.freeze({
    isExpanded: () => host.isExpanded(),
    busy: () => host.busy(),
    setNativeMode: (...args) => host.setNativeMode(...args),
    validateTarget: (target) => host.validateTarget(target),
    navigate: (target) => host.navigate(target),
  });
})();
