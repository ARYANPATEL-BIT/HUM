import { NOTES } from '../content/notes.js';
import { TASK_TYPES } from '../world/taskObjects.js';

// HUD: countdown timer, task checklist (Tab toggles), breaker progress bar, stamina bar, bottles,
// interaction prompt, the note reader and the end screen. Elements come from index.html.

const $ = (id) => document.getElementById(id);
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class HUD {
  constructor() {
    this.timerEl = $('hud-timer');
    this.checklistEl = $('hud-checklist');
    this.checklistPanel = $('hud-checklist-panel');
    this.breakerBarEl = $('hud-breaker-bar');
    this.breakerTrackEl = $('hud-breaker-track');
    this.staminaTrackEl = $('hud-stamina-track');
    this.staminaBarEl = $('hud-stamina-bar');
    this.carryEl = $('hud-carry');
    this.bottlesEl = $('hud-bottles');
    this.promptEl = $('hud-prompt');
    this.noteEl = $('note');
    this.checklistVisible = false;
    this.completedTypes = new Set();
    this.flashText = '';
    this.flashTime = 0;

    document.addEventListener('task-complete', (e) => {
      this.completedTypes.add(e.detail.type);
      this.refreshChecklist();
      this.flash(`${e.detail.type} done · ${this.completedTypes.size}/${TASK_TYPES.length}`);
    });
    document.addEventListener('exit-spawned', () => {
      const li = document.createElement('li');
      li.textContent = '→ EXIT DOOR OPEN · follow the low tone';
      li.className = 'exit-item';
      this.checklistEl.appendChild(li);
      this.flash('a door has opened somewhere. listen.', 4);
    });
  }

  refreshChecklist() {
    this.checklistEl.innerHTML = '';
    for (const type of TASK_TYPES) {
      const li = document.createElement('li');
      li.textContent = (this.completedTypes.has(type) ? '✓ ' : '○ ') + type.charAt(0).toUpperCase() + type.slice(1);
      li.className = this.completedTypes.has(type) ? 'done' : '';
      this.checklistEl.appendChild(li);
    }
  }

  // Short message in the prompt slot (overrides the interaction prompt while it lasts).
  flash(text, seconds = 2) {
    this.flashText = text;
    this.flashTime = seconds;
  }

  showNote(index, collected) {
    const note = NOTES[index];
    this.noteEl.querySelector('.note-number').textContent = `note ${index + 1} of ${NOTES.length} · ${collected}/${NOTES.length} found`;
    this.noteEl.querySelector('.note-title').textContent = note.title;
    this.noteEl.querySelector('.note-body').textContent = note.body;
    this.noteEl.classList.remove('hidden');
  }

  hideNote() {
    this.noteEl.classList.add('hidden');
  }

  // s: { timeLeft, taskManager, player, input, prompt, bottles }
  update(dt, s) {
    const { timeLeft, taskManager, player, input } = s;
    this.timerEl.textContent = fmtTime(timeLeft);
    this.timerEl.className = timeLeft < 60 ? 'danger' : '';

    if (input.wasPressed('Tab')) {
      this.checklistVisible = !this.checklistVisible;
      this.checklistPanel.classList.toggle('hidden', !this.checklistVisible);
    }

    const breaker = taskManager.activeTask?.type === 'breaker' ? taskManager.activeTask : null;
    this.breakerTrackEl.classList.toggle('hidden', !breaker);
    if (breaker) this.breakerBarEl.style.width = `${breaker.progress * 100}%`;

    this.staminaTrackEl.classList.toggle('hidden', player.stamina >= 1);
    this.staminaTrackEl.classList.toggle('exhausted', player.exhausted);
    this.staminaBarEl.style.width = `${player.stamina * 100}%`;

    this.carryEl.classList.toggle('hidden', !taskManager.carrying);
    this.bottlesEl.classList.toggle('hidden', s.bottles === 0);
    this.bottlesEl.textContent = `water ×${s.bottles} · R to drink`;

    this.flashTime -= dt;
    const text = this.flashTime > 0 ? this.flashText : s.prompt ?? '';
    if (this.promptEl.textContent !== text) this.promptEl.textContent = text;
  }
}

export function saveImage(dataURL, filename) {
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = filename;
  a.click();
}

// stats: { won, cause, difficulty, timeLeft, survived, tasks, walked, chalk, bottlesFound, bottlesDrunk,
//          notesRead, newNotes, notesTotal, chases, closest, seed }
export function showEndScreen(stats) {
  const panel = $('end-screen');
  panel.classList.remove('hidden');
  const titles = { escaped: 'ESCAPED', caught: 'CAUGHT', time: 'LIGHTS OUT' };
  const reasons = {
    escaped: 'you found the door.',
    caught: 'it found you first.',
    time: 'the hum stopped. so did you.',
  };
  panel.querySelector('.end-result').textContent = titles[stats.cause];
  panel.querySelector('.end-reason').textContent = reasons[stats.cause];
  const rows = [
    ['difficulty', stats.difficulty],
    ['time survived', fmtTime(stats.survived)],
    ['time left', fmtTime(stats.timeLeft)],
    ['tasks', `${stats.tasks.length}/${TASK_TYPES.length}${stats.tasks.length ? ` (${stats.tasks.join(', ')})` : ''}`],
    ['distance walked', `${stats.walked.toFixed(0)} m`],
    ['chalk marks', stats.chalk],
    ['water', `${stats.bottlesDrunk} drunk · ${stats.bottlesFound} found`],
    ['notes', `${stats.notesRead} read${stats.newNotes ? ` (${stats.newNotes} new)` : ''} · ${stats.notesTotal}/${NOTES.length} collected`],
    ['times chased', stats.chases],
    ['closest call', stats.closest === null ? 'it never came' : `${stats.closest.toFixed(1)} m`],
    ['seed', stats.seed],
  ];
  const dl = panel.querySelector('.end-stats');
  dl.innerHTML = '';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  panel.querySelector('[data-save-map]').onclick = () => {
    saveImage($('end-map').toDataURL('image/png'), `hum-map-${stats.seed}.png`);
  };
  panel.querySelector('[data-restart-same]').onclick = () => {
    location.href = `?seed=${stats.seed}`;
  };
  panel.querySelector('[data-restart-new]').onclick = () => {
    location.href = location.pathname;
  };
}
