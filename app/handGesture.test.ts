import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyHandGesture,
  selectSampleHand,
  type GestureLandmark,
} from './handGesture.ts';

function makeVictoryLandmarks(): GestureLandmark[] {
  return [
    { x: 0.5, y: 0.9 },
    { x: 0.44, y: 0.78 },
    { x: 0.38, y: 0.7 },
    { x: 0.34, y: 0.62 },
    { x: 0.34, y: 0.5 },
    { x: 0.43, y: 0.68 },
    { x: 0.4, y: 0.48 },
    { x: 0.38, y: 0.3 },
    { x: 0.36, y: 0.12 },
    { x: 0.5, y: 0.66 },
    { x: 0.51, y: 0.44 },
    { x: 0.52, y: 0.27 },
    { x: 0.54, y: 0.09 },
    { x: 0.57, y: 0.69 },
    { x: 0.59, y: 0.55 },
    { x: 0.56, y: 0.62 },
    { x: 0.53, y: 0.7 },
    { x: 0.64, y: 0.72 },
    { x: 0.66, y: 0.6 },
    { x: 0.63, y: 0.68 },
    { x: 0.6, y: 0.75 },
  ];
}

test('selects Victory from either detected hand', () => {
  const open = { gesture: 'open' as const, pinchLatched: false, confidence: 0.9, id: 'left' };
  const victory = { gesture: 'victory' as const, pinchLatched: false, confidence: 0.72, id: 'right' };

  assert.equal(selectSampleHand([open, victory])?.id, 'right');
  assert.equal(selectSampleHand([victory, open])?.id, 'right');
});

test('trained Victory result takes priority over a simultaneous pinch', () => {
  const landmarks = makeVictoryLandmarks();
  landmarks[4] = { x: landmarks[8].x + 0.004, y: landmarks[8].y + 0.004 };
  const result = classifyHandGesture(
    landmarks,
    { categoryName: 'Victory', score: 0.84 },
    true,
  );

  assert.equal(result.gesture, 'victory');
  assert.equal(result.pinchLatched, false);
});

test('geometry fallback recognizes a V with curled ring and pinky', () => {
  const result = classifyHandGesture(makeVictoryLandmarks(), undefined, false);
  assert.equal(result.gesture, 'victory');
});

test('missing landmarks clear stale pinch state', () => {
  const result = classifyHandGesture([], undefined, true);
  assert.deepEqual(result, { gesture: 'none', pinchLatched: false, confidence: 0 });
});
