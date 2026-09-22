const { resolveNotchHeight } = require('./notch-height-settings');

function createWindowGeometry({
  screen,
  platformPolicy,
  platform,
  collapsedWidth,
  collapsedMinHeight,
  expandedChromeY,
  screenMargin,
  tabSizes,
  getCurrentTab,
  getMainWindow,
  isCollapsedHovering,
  getNotchHeightPreference,
}) {
  function getTargetDisplay() {
    try {
      const cursor = screen.getCursorScreenPoint();
      return screen.getDisplayNearestPoint(cursor);
    } catch (error) {
      return screen.getPrimaryDisplay();
    }
  }

  function getWindowDisplay() {
    try {
      const mainWindow = getMainWindow();
      if (mainWindow) return screen.getDisplayMatching(mainWindow.getBounds());
    } catch (error) {
      // Fall back to the display under the cursor when the window is unavailable.
    }
    return getTargetDisplay();
  }

  function getCenteredBounds(width, height, display) {
    const currentDisplay = display || getTargetDisplay();
    const area = platform === 'win32' ? currentDisplay.workArea : currentDisplay.bounds;
    return {
      x: Math.round(area.x + (area.width - width) / 2),
      y: area.y,
      width,
      height,
    };
  }

  function getMenuBarHeight(display) {
    return Math.max(0, display.workArea.y - display.bounds.y);
  }

  function getNotchHeight(display) {
    const baseHeight = platform === 'win32'
      ? 8
      : getMenuBarHeight(display) || collapsedMinHeight;
    return resolveNotchHeight(getNotchHeightPreference?.(), {
      platform,
      baseHeight,
    });
  }

  function getCollapsedHeight(display) {
    if (platform === 'win32') return collapsedMinHeight;
    return getNotchHeight(display);
  }

  function getExpandedSize(display) {
    const size = tabSizes[getCurrentTab()] || tabSizes.home;
    return {
      width: Math.min(size.width, display.workArea.width - screenMargin),
      height: Math.min(
        expandedChromeY + size.panelHeight,
        Math.max(getCollapsedHeight(display), display.bounds.height - screenMargin)
      ),
    };
  }

  function getLayoutMetrics(display) {
    const currentDisplay = display || getWindowDisplay();
    return {
      stripHeight: getCollapsedHeight(currentDisplay),
      notchHeight: getNotchHeight(currentDisplay),
      menuBarHeight: getMenuBarHeight(currentDisplay),
      chromeY: expandedChromeY,
      tabSizes,
    };
  }

  function getBoundsForMode(mode, display) {
    const currentDisplay = display || getWindowDisplay();
    if (mode === 'launcher') {
      const area = platform === 'win32' ? currentDisplay.workArea : currentDisplay.bounds;
      const canvas = platform === 'win32'
        ? platformPolicy.panelBounds('win32', currentDisplay, true)
        : { width: area.width - 24, height: area.height - 24 };
      const width = Math.max(1, Math.min(640, canvas.width));
      return {
        x: Math.round(area.x + (area.width - width) / 2),
        y: area.y,
        width,
        height: Math.max(1, Math.min(520, canvas.height)),
      };
    }
    if (platform === 'win32') return platformPolicy.panelBounds(platform, currentDisplay, mode === 'expanded');
    if (mode === 'expanded') {
      const { width, height } = getExpandedSize(currentDisplay);
      return getCenteredBounds(width, height, currentDisplay);
    }
    return getCenteredBounds(collapsedWidth, getCollapsedHeight(currentDisplay), currentDisplay);
  }

  function applyWindowGeometry(mode, display) {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (platform !== 'win32') {
      mainWindow.setBounds(getBoundsForMode(mode, display));
      return;
    }
    const currentDisplay = display || getWindowDisplay();
    const layout = platformPolicy.windowsPanelLayout(
      currentDisplay,
      mode === 'expanded',
      mode === 'collapsed' && isCollapsedHovering(),
      getNotchHeight(currentDisplay)
    );
    const current = mainWindow.getBounds();
    if (['x', 'y', 'width', 'height'].some((key) => current[key] !== layout.bounds[key])) {
      mainWindow.setBounds(layout.bounds, false);
    }
    if (mode === 'launcher') {
      const launcherBounds = getBoundsForMode('launcher', display);
      mainWindow.setShape([{
        x: Math.round((layout.bounds.width - launcherBounds.width) / 2),
        y: 0,
        width: launcherBounds.width,
        height: launcherBounds.height,
      }]);
    } else {
      mainWindow.setShape(layout.shape);
    }
  }

  return {
    getTargetDisplay,
    getWindowDisplay,
    getCenteredBounds,
    getMenuBarHeight,
    getNotchHeight,
    getCollapsedHeight,
    getExpandedSize,
    getLayoutMetrics,
    getBoundsForMode,
    applyWindowGeometry,
  };
}

module.exports = { createWindowGeometry };
