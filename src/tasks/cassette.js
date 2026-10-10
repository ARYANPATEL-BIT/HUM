// Cassette: pick it up (no sprint while carrying), deliver to tape player in a different chunk.
// The carried state must survive chunk unloads — it lives in the task manager's state, not the chunk.

let carried = false;
let carrierId = null;

export function createCassetteTask(taskObj) {
  return {
    type: 'cassette',
    taskObj,
    get isCarried() { return carried && carrierId === taskObj.id; },
    pickup() {
      carried = true;
      carrierId = taskObj.id;
    },
    putDown() {
      if (carrierId === taskObj.id) { carried = false; carrierId = null; }
    },
    // The tape player is in a chunk at least 2 away from the cassette's home chunk.
    // Its location is deterministic: the home chunk + (3, 0) or similar offset.
    get playerChunk() {
      return { cx: taskObj.cx + 3, cz: taskObj.cz };
    },
    dispose() {
      if (carrierId === taskObj.id) { carried = false; carrierId = null; }
    },
  };
}

export function isCarryingCassette() { return carried; }
