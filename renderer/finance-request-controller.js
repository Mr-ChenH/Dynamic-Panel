(function exposeFinanceRequestController() {
  function createController(host = {}) {
    const getApi = typeof host.getApi === 'function' ? host.getApi : () => window.notchAPI || {};
    const now = typeof host.now === 'function' ? host.now : () => Date.now();
    const requestIds = new Set();
    let requestSequence = 0;
    let loadGeneration = 0;

    function begin() {
      const requestId = `finance-${now().toString(36)}-${++requestSequence}`;
      requestIds.add(requestId);
      return requestId;
    }

    function finish(requestId) {
      requestIds.delete(requestId);
    }

    function cancelAll() {
      loadGeneration += 1;
      const activeRequestIds = [...requestIds];
      requestIds.clear();
      const api = getApi() || {};
      activeRequestIds.forEach((requestId) => {
        try { api.cancelFinanceRequest?.(requestId)?.catch(() => {}); } catch (error) {}
      });
      return activeRequestIds.length;
    }

    return {
      begin,
      finish,
      cancelAll,
      generation: () => loadGeneration,
      activeCount: () => requestIds.size,
      isCurrent: (generation) => generation === loadGeneration,
      isCancelledResult: (result) => result?.ok === false && result.error === 'cancelled',
    };
  }

  window.NotchFinanceRequests = Object.freeze({ createController });
})();
