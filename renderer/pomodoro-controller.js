(function exposePomodoroController() {
  function createController(host = {}) {
    const {
      showStatusToast = () => {},
      notchAPI = window.notchAPI,
    } = host;
    const pomodoroToggle = document.getElementById('pomodoro-toggle');
    const pomodoroReset = document.getElementById('pomodoro-reset');
    const homePomodoro = document.getElementById('home-pomodoro');
    const pomodoroEndTime = document.getElementById('pomodoro-end-time');
    const pomodoroInputs = [
      document.getElementById('pomodoro-minutes'),
      document.getElementById('pomodoro-seconds'),
    ];
    const POMODORO_DURATION_KEY = 'dynamic-panel-pomodoro-duration-v3';
    let savedPomodoroParts = (() => {
      try {
        const value = JSON.parse(localStorage.getItem(POMODORO_DURATION_KEY) || 'null');
        if (Array.isArray(value) && value.length === 3) {
          return [
            Math.max(0, Math.min(60, (Number(value[0]) || 0) * 60 + (Number(value[1]) || 0))),
            Math.max(0, Math.min(60, Number(value[2]) || 0)),
          ];
        }
        if (Array.isArray(value) && value.length === 2) {
          return value.map((part) => Math.max(0, Math.min(60, Number(part) || 0)));
        }
      } catch (error) {}
      return [5, 0];
    })();
    let pomodoroConfiguredSeconds = savedPomodoroParts[0] * 60 + savedPomodoroParts[1];
    let pomodoroRemaining = pomodoroConfiguredSeconds;
    let pomodoroRunning = false;
    let pomodoroStarted = false;
    let pomodoroTimer = null;

    const pad2 = (value) => value < 10 ? `0${value}` : String(value);

    function secondsToParts(seconds) {
      const safe = Math.max(0, Math.floor(seconds));
      return [Math.min(60, Math.floor(safe / 60)), safe % 60];
    }

    function setPomodoroInputs(parts) {
      pomodoroInputs.forEach((input, index) => {
        if (!input) return;
        input.value = String(parts[index]).padStart(2, '0');
        input.readOnly = pomodoroRunning;
      });
    }

    function formatPomodoroEndTime(seconds) {
      const target = new Date(Date.now() + Math.max(0, seconds) * 1000);
      return `${pad2(target.getHours())}:${pad2(target.getMinutes())}`;
    }

    function renderPomodoro() {
      setPomodoroInputs(pomodoroStarted ? secondsToParts(pomodoroRemaining) : savedPomodoroParts);
      if (pomodoroEndTime) {
        pomodoroEndTime.textContent = formatPomodoroEndTime(pomodoroStarted ? pomodoroRemaining : pomodoroConfiguredSeconds);
      }
      const remainingRatio = pomodoroStarted
        ? pomodoroRemaining / Math.max(1, pomodoroConfiguredSeconds)
        : 1;
      homePomodoro?.style.setProperty('--pomodoro-progress', String(Math.max(0, Math.min(1, remainingRatio))));
      if (pomodoroToggle) {
        pomodoroToggle.innerHTML = pomodoroRunning
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7h3v10H8zM14 7h3v10h-3z" /></svg>'
          : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7 8 5-8 5z" /></svg>';
        pomodoroToggle.setAttribute('aria-label', pomodoroRunning ? '暂停番茄钟' : '开始番茄钟');
      }
      if (pomodoroReset) pomodoroReset.hidden = !pomodoroStarted;
      homePomodoro?.setAttribute('data-state', pomodoroRunning ? 'running' : (pomodoroStarted ? 'paused' : 'idle'));
    }

    function commitPomodoroInputs() {
      if (pomodoroRunning) return;
      savedPomodoroParts = pomodoroInputs.map((input) => Math.max(0, Math.min(60, Number.parseInt(input?.value || '0', 10) || 0)));
      pomodoroConfiguredSeconds = savedPomodoroParts[0] * 60 + savedPomodoroParts[1];
      pomodoroRemaining = pomodoroConfiguredSeconds;
      pomodoroStarted = false;
      localStorage.setItem(POMODORO_DURATION_KEY, JSON.stringify(savedPomodoroParts));
      renderPomodoro();
    }

    pomodoroInputs.forEach((input) => {
      if (!input) return;
      input.addEventListener('focus', () => input.select());
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/g, '').slice(0, 2);
      });
      input.addEventListener('blur', commitPomodoroInputs);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commitPomodoroInputs();
          input.blur();
        }
      });
      input.addEventListener('wheel', (event) => {
        if (pomodoroRunning) return;
        event.preventDefault();
        const current = Number.parseInt(input.value || '0', 10) || 0;
        input.value = String(Math.max(0, Math.min(60, current + (event.deltaY < 0 ? 1 : -1)))).padStart(2, '0');
        commitPomodoroInputs();
        input.focus({ preventScroll: true });
        input.select();
      }, { passive: false });
    });

    pomodoroToggle?.addEventListener('click', () => {
      if (!pomodoroStarted) {
        commitPomodoroInputs();
        if (pomodoroConfiguredSeconds <= 0) {
          showStatusToast('请先设置倒计时时间');
          return;
        }
        pomodoroStarted = true;
        pomodoroRemaining = pomodoroConfiguredSeconds;
      }
      pomodoroRunning = !pomodoroRunning;
      clearInterval(pomodoroTimer);
      pomodoroTimer = null;
      if (pomodoroRunning) {
        pomodoroTimer = setInterval(() => {
          pomodoroRemaining -= 1;
          if (pomodoroRemaining <= 0) {
            const completedMinutes = Math.max(1, Math.round(pomodoroConfiguredSeconds / 60));
            pomodoroRemaining = pomodoroConfiguredSeconds;
            pomodoroRunning = false;
            pomodoroStarted = false;
            clearInterval(pomodoroTimer);
            pomodoroTimer = null;
            showStatusToast(`${completedMinutes} 分钟专注完成`);
            notchAPI?.notifyPomodoro?.(completedMinutes).catch(() => {});
          }
          renderPomodoro();
        }, 1000);
      }
      renderPomodoro();
    });

    pomodoroReset?.addEventListener('click', () => {
      clearInterval(pomodoroTimer);
      pomodoroTimer = null;
      pomodoroRunning = false;
      pomodoroStarted = false;
      pomodoroRemaining = pomodoroConfiguredSeconds;
      renderPomodoro();
    });
    renderPomodoro();

    return Object.freeze({
      render: renderPomodoro,
      dispose() {
        clearInterval(pomodoroTimer);
        pomodoroTimer = null;
      },
    });
  }

  window.NotchPomodoroController = Object.freeze({ createController });
})();
