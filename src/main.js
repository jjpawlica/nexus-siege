// main.js — entry point

import { createState } from './state.js';
import { startLoop } from './gameLoop.js';
import { setupInput } from './input.js';
import { beginRun } from './game.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

window.addEventListener('resize', () => {
  resizeCanvas();
  state.canvasW = canvas.width;
  state.canvasH = canvas.height;
});
resizeCanvas();

const state = createState();
state.canvasW = canvas.width;
state.canvasH = canvas.height;

setupInput(state, canvas);
beginRun(state);
startLoop(ctx, state);

// Expose for debug
window.state = state;
window.god = () => { state.hero.iFrames = 9999; console.log('god mode on'); };
window.skip = () => {
  if (state.miniboss) state.miniboss.hp = 0;
  else if (state.boss) state.boss.hp = 0;
  else state.realmTime = state.currentRealm.realmBossAt;
};
window.level = (n) => { state.hero.xp = (n >= 10 ? 1580 : [0,50,120,210,330,480,670,910,1210,1580][n-1]); };
