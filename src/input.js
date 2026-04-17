// input.js — keyboard + mouse handling

import { screenToWorld } from './util.js';

export function setupInput(state, canvas) {
  const input = state.input;

  window.addEventListener('keydown', (e) => {
    // prevent browser defaults on game keys
    if (e.code === 'Tab' || e.code === 'Space' || e.code === 'F1') e.preventDefault();
    if (input.keys.has(e.code)) return;
    input.keys.add(e.code);
    input.pressedThisFrame.add(e.code);
  });
  window.addEventListener('keyup', (e) => {
    input.keys.delete(e.code);
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    input.mouse.x = e.clientX - rect.left;
    input.mouse.y = e.clientY - rect.top;
  });
  canvas.addEventListener('mousedown', (e) => {
    input.mouse.buttons |= 1 << e.button;
    input.mousePressedThisFrame.add(e.button);
  });
  canvas.addEventListener('mouseup', (e) => {
    input.mouse.buttons &= ~(1 << e.button);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function updateMouseWorld(state) {
  const w = screenToWorld(state.input.mouse.x, state.input.mouse.y, state.camera, state.canvasW, state.canvasH);
  state.input.mouse.worldX = w.x;
  state.input.mouse.worldY = w.y;
}

export function clearPressedThisFrame(state) {
  state.input.pressedThisFrame.clear();
  state.input.mousePressedThisFrame.clear();
}

export function keyDown(state, code) { return state.input.keys.has(code); }
export function keyPressed(state, code) { return state.input.pressedThisFrame.has(code); }
export function mouseBtn(state, btn) { return (state.input.mouse.buttons & (1 << btn)) !== 0; }
export function mousePressed(state, btn) { return state.input.mousePressedThisFrame.has(btn); }
