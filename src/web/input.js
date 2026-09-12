// keyboard first, pointer as a fallback so the page works on a phone.

export function createInput(canvas, cfg) {
  const keys = new Set();
  const pointer = { active: false, y: 0, boost: false };

  const onKey = (e, down) => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'w', 's', ' ', 'shift', 'r'].includes(k)) e.preventDefault();
    if (down) keys.add(k); else keys.delete(k);
  };
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));

  const toWorldY = (clientY) => {
    const rect = canvas.getBoundingClientRect();
    return ((clientY - rect.top) / rect.height) * cfg.world.height;
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointer.active = true;
    pointer.y = toWorldY(e.clientY);
    pointer.boost = e.clientX - canvas.getBoundingClientRect().left < canvas.clientWidth * 0.25;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pointer.active) pointer.y = toWorldY(e.clientY);
  });
  const release = () => { pointer.active = false; pointer.boost = false; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  return {
    keys,
    read(state) {
      let up = keys.has('arrowup') || keys.has('w');
      let down = keys.has('arrowdown') || keys.has('s');
      let boost = keys.has(' ') || keys.has('shift');
      if (pointer.active) {
        const d = pointer.y - state.player.y;
        if (d < -3) up = true;
        if (d > 3) down = true;
        if (pointer.boost || Math.abs(d) > 24) boost = true;
      }
      return { up, down, boost };
    },
    consumeRestart() {
      if (keys.has('r')) { keys.delete('r'); return true; }
      return false;
    },
  };
}
