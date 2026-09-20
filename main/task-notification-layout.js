'use strict';

function createTaskNotificationLayout({ getTargetDisplay, getCenteredBounds, width, height, screenMargin }) {
  if (typeof getTargetDisplay !== 'function' || typeof getCenteredBounds !== 'function') {
    throw new TypeError('display and centered bounds providers are required');
  }
  return {
    getBounds(display) {
      const targetDisplay = display || getTargetDisplay();
      const boundedWidth = Math.min(width, Math.max(280, targetDisplay.bounds.width - screenMargin * 2));
      return getCenteredBounds(boundedWidth, height, targetDisplay);
    },
  };
}

module.exports = { createTaskNotificationLayout };
