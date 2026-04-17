// gameLoop.js — fixed-timestep sim + render

import { simulate } from './game.js';
import { render } from './renderer.js';
import { updateMouseWorld } from './input.js';

const SIM_DT = 1 / 60;

export function startLoop(ctx, state) {
  let acc = 0;
  let lastTime = performance.now();
  let lastFpsTick = lastTime;
  let framesSinceFpsTick = 0;

  function frame(now) {
    const frameDt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    const frameStart = performance.now();

    updateMouseWorld(state);

    // Frame-level input: always responsive, even when paused
    if (state.input.pressedThisFrame.has('Escape')) {
      state.ui.pauseMenu = !state.ui.pauseMenu;
      state.paused = state.ui.pauseMenu;
    }
    if (state.input.pressedThisFrame.has('Backquote')) {
      state.ui.debug = !state.ui.debug;
    }

    if (!state.paused) {
      acc += frameDt;
      while (acc >= SIM_DT) {
        simulate(state, SIM_DT);
        // Consume pressed-this-frame once per sim tick so single key events
        // don't double-fire across multiple ticks in the same frame.
        state.input.pressedThisFrame.clear();
        state.input.mousePressedThisFrame.clear();
        acc -= SIM_DT;
      }
    } else {
      acc = 0;
      // Discard inputs received during pause so they don't leak in when unpaused.
      state.input.pressedThisFrame.clear();
      state.input.mousePressedThisFrame.clear();
    }

    render(ctx, state, acc / SIM_DT);

    const frameEnd = performance.now();
    state.frameTime = frameEnd - frameStart;
    framesSinceFpsTick++;
    if (now - lastFpsTick >= 500) {
      state.fps = framesSinceFpsTick * 1000 / (now - lastFpsTick);
      lastFpsTick = now;
      framesSinceFpsTick = 0;
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
