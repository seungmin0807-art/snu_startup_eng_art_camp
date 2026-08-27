import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceVictoryHold,
  createVictoryHoldState,
} from './victoryHold.ts';

test('toggles once after a three-second V hold', () => {
  let state = createVictoryHoldState();
  let toggles = 0;

  for (const nowMs of [0, 1_000, 2_000, 2_900, 3_000, 4_000, 6_000]) {
    const update = advanceVictoryHold(state, true, nowMs);
    state = update.state;
    if (update.toggled) toggles += 1;
  }

  assert.equal(toggles, 1);
  assert.equal(state.phase, 'latched');
});

test('keeps the hold through a short classifier dropout', () => {
  let state = createVictoryHoldState();
  let update = advanceVictoryHold(state, true, 0);
  state = update.state;
  state = advanceVictoryHold(state, true, 1_000).state;
  state = advanceVictoryHold(state, false, 1_200).state;
  state = advanceVictoryHold(state, false, 1_600).state;
  state = advanceVictoryHold(state, true, 1_650).state;
  update = advanceVictoryHold(state, true, 3_000);

  assert.equal(update.toggled, true);
});

test('resets after a long dropout and rearms only after release', () => {
  let state = createVictoryHoldState();
  state = advanceVictoryHold(state, true, 0).state;
  state = advanceVictoryHold(state, false, 1_000).state;
  state = advanceVictoryHold(state, false, 1_600).state;
  state = advanceVictoryHold(state, true, 1_700).state;
  assert.equal(advanceVictoryHold(state, true, 4_600).toggled, false);

  let update = advanceVictoryHold(state, true, 4_700);
  assert.equal(update.toggled, true);
  state = update.state;
  state = advanceVictoryHold(state, false, 5_000).state;
  state = advanceVictoryHold(state, false, 5_900).state;
  state = advanceVictoryHold(state, true, 6_000).state;
  update = advanceVictoryHold(state, true, 9_000);
  assert.equal(update.toggled, true);
});
