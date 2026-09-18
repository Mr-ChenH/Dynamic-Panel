function createTaskNotificationWindowState() {
  let ready = false;
  let active = null;
  let leaving = false;

  return {
    isReady: () => ready,
    active: () => active,
    isLeaving: () => leaving,
    markReady: () => { ready = true; },
    markNotReady: () => { ready = false; },
    start: (notification) => {
      if (!notification || active || leaving) return false;
      active = notification;
      leaving = false;
      return true;
    },
    beginLeaving: () => {
      if (!active || leaving) return null;
      leaving = true;
      return active.eventId;
    },
    finish: (eventId) => {
      if (!active || active.eventId !== eventId) return false;
      active = null;
      leaving = false;
      return true;
    },
    recover: () => {
      const interrupted = active;
      active = null;
      leaving = false;
      ready = false;
      return interrupted;
    },
    reset: () => {
      active = null;
      leaving = false;
      ready = false;
    },
  };
}

module.exports = { createTaskNotificationWindowState };
