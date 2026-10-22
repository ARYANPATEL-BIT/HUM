// HUD: countdown timer, task checklist (Tab toggles), breaker progress bar.
// Updates by reading from the DOM elements created in index.html.

export class HUD {
  constructor() {
    this.timerEl = document.getElementById('hud-timer');
    this.checklistEl = document.getElementById('hud-checklist');
    this.checklistPanel = document.getElementById('hud-checklist-panel');
    this.breakerBarEl = document.getElementById('hud-breaker-bar');
    this.breakerTrackEl = document.getElementById('hud-breaker-track');
    this.carryEl = document.getElementById('hud-carry');
    this.checklistVisible = false;
    this.completedTypes = new Set();
    this.taskTypes = ['breaker', 'radio', 'cassette', 'keypad'];

    document.addEventListener('task-complete', (e) => {
      this.completedTypes.add(e.detail.type);
      this.refreshChecklist();
    });
    document.addEventListener('exit-spawned', () => {
      if (this.checklistEl) {
        const li = document.createElement('li');
        li.textContent = '→ EXIT DOOR OPEN';
        li.className = 'exit-item';
        this.checklistEl.appendChild(li);
      }
    });
  }

  refreshChecklist() {
    if (!this.checklistEl) return;
    this.checklistEl.innerHTML = '';
    for (const type of this.taskTypes) {
      const li = document.createElement('li');
      li.textContent = (this.completedTypes.has(type) ? '✓ ' : '○ ') + type.charAt(0).toUpperCase() + type.slice(1);
      li.className = this.completedTypes.has(type) ? 'done' : '';
      this.checklistEl.appendChild(li);
    }
  }

  update(timeLeft, taskManager, player, input) {
    // Timer.
    if (this.timerEl) {
      const m = Math.floor(timeLeft / 60);
      const s = Math.floor(timeLeft % 60);
      this.timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
      this.timerEl.className = timeLeft < 60 ? 'danger' : '';
    }

    // Tab toggles checklist.
    if (input.wasPressed('Tab')) {
      this.checklistVisible = !this.checklistVisible;
      if (this.checklistPanel) this.checklistPanel.classList.toggle('hidden', !this.checklistVisible);
    }

    // Breaker progress.
    const breaker = taskManager?.activeTask?.type === 'breaker' ? taskManager.activeTask : null;
    if (this.breakerTrackEl) {
      if (breaker) {
        this.breakerTrackEl.classList.remove('hidden');
        if (this.breakerBarEl) this.breakerBarEl.style.width = `${breaker.progress * 100}%`;
      } else {
        this.breakerTrackEl.classList.add('hidden');
      }
    }

    // Carry indicator.
    if (this.carryEl) {
      this.carryEl.classList.toggle('hidden', !taskManager?.carrying);
    }
  }
}

export function showEndScreen(detail, seed, player) {
  const panel = document.getElementById('end-screen');
  if (!panel) return;
  panel.classList.remove('hidden');
  const won = detail.won;
  panel.querySelector('.end-result').textContent = won ? 'ESCAPED' : 'FAILED';
  panel.querySelector('.end-time').textContent = `Time left: ${Math.floor(detail.timeLeft)}s`;
  panel.querySelector('.end-walked').textContent = `Distance: ${player.distanceWalked.toFixed(0)} m`;
  panel.querySelector('.end-seed').textContent = `Seed: ${seed}`;
  panel.querySelector('.end-tasks').textContent = `Tasks: ${detail.tasks || 0}/4`;
  panel.querySelector('[data-restart-same]')?.addEventListener('click', () => {
    location.href = `?seed=${seed}`;
  });
  panel.querySelector('[data-restart-new]')?.addEventListener('click', () => {
    location.href = location.pathname;
  });
}
