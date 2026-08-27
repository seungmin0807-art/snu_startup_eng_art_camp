import type { TrackedHand } from './useHandTracking';

export type BowPose = {
  bowHand: TrackedHand;
  drawHand: TrackedHand;
  direction: { x: number; y: number };
  separation: number;
  tension: number;
  towardCamera: boolean;
};

export type BowGesturePhase = 'searching' | 'drawing' | 'cooldown';

export type BowGestureState = {
  phase: BowGesturePhase;
  candidateSinceMs: number | null;
  drawingSinceMs: number | null;
  lostSinceMs: number | null;
  cooldownUntilMs: number;
  drawHandedness: TrackedHand['handedness'] | null;
  bowHandedness: TrackedHand['handedness'] | null;
  lastPose: BowPose | null;
  drawWasPinched: boolean;
};

export type BowGestureUpdate = {
  state: BowGestureState;
  pose: BowPose | null;
  fired: BowPose | null;
};

const ACQUIRE_MS = 170;
const LOST_GRACE_MS = 360;
const SHOT_COOLDOWN_MS = 620;
const PINCH_TO_DRAW = 0.56;
const RELEASE_PINCH = 0.72;
const MIN_TENSION_TO_FIRE = 0.24;

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

export function createBowGestureState(): BowGestureState {
  return {
    phase: 'searching',
    candidateSinceMs: null,
    drawingSinceMs: null,
    lostSinceMs: null,
    cooldownUntilMs: 0,
    drawHandedness: null,
    bowHandedness: null,
    lastPose: null,
    drawWasPinched: false,
  };
}

function makePose(drawHand: TrackedHand, bowHand: TrackedHand): BowPose {
  const x = bowHand.center.x - drawHand.center.x;
  const y = bowHand.center.y - drawHand.center.y;
  const separation = Math.max(0.001, Math.hypot(x, y));
  const bowDepthCue = bowHand.scale / Math.max(drawHand.scale, 0.001);
  const tension = clamp((separation - 0.14) / 0.48);

  return {
    bowHand,
    drawHand,
    direction: { x: x / separation, y: y / separation },
    separation,
    tension,
    towardCamera:
      bowDepthCue > 1.22 &&
      separation < 0.46 &&
      tension >= 0.18,
  };
}

function geometryLooksLikeBow(pose: BowPose) {
  const verticalOffset = Math.abs(
    pose.bowHand.center.y - pose.drawHand.center.y,
  );
  const strongDepthCue = pose.bowHand.scale / Math.max(pose.drawHand.scale, 0.001) > 1.24;

  return (
    pose.separation > 0.16 &&
    pose.separation < 0.82 &&
    (verticalOffset < 0.34 || strongDepthCue)
  );
}

function selectNewPair(hands: TrackedHand[]) {
  if (hands.length < 2) return null;
  const pair = [...hands]
    .sort((a, b) => a.pinchRatio - b.pinchRatio)
    .slice(0, 2);
  const drawHand = pair[0];
  const bowHand = pair[1];
  return { drawHand, bowHand };
}

function selectExistingPair(hands: TrackedHand[], state: BowGestureState) {
  if (hands.length < 2) return null;

  if (
    state.drawHandedness &&
    state.bowHandedness &&
    state.drawHandedness !== 'Unknown' &&
    state.bowHandedness !== 'Unknown' &&
    state.drawHandedness !== state.bowHandedness
  ) {
    const drawHand = hands.find((hand) => hand.handedness === state.drawHandedness);
    const bowHand = hands.find((hand) => hand.handedness === state.bowHandedness);
    if (drawHand && bowHand) return { drawHand, bowHand };
  }

  if (!state.lastPose) return selectNewPair(hands);
  const byDistance = (target: TrackedHand) => [...hands].sort((a, b) => {
    const aDistance = Math.hypot(
      a.center.x - target.center.x,
      a.center.y - target.center.y,
    );
    const bDistance = Math.hypot(
      b.center.x - target.center.x,
      b.center.y - target.center.y,
    );
    return aDistance - bDistance;
  });
  const drawHand = byDistance(state.lastPose.drawHand)[0];
  const bowHand = byDistance(state.lastPose.bowHand)
    .find((hand) => hand !== drawHand);
  return bowHand ? { drawHand, bowHand } : null;
}

export function advanceBowGesture(
  previous: BowGestureState,
  hands: TrackedHand[],
  nowMs: number,
): BowGestureUpdate {
  if (previous.phase === 'cooldown') {
    if (nowMs < previous.cooldownUntilMs) {
      return { state: previous, pose: null, fired: null };
    }
    previous = createBowGestureState();
  }

  if (previous.phase === 'searching') {
    const pair = selectNewPair(hands);
    const pose = pair ? makePose(pair.drawHand, pair.bowHand) : null;
    const isCandidate = Boolean(
      pose &&
      geometryLooksLikeBow(pose) &&
      pair &&
      pair.drawHand.pinchRatio < PINCH_TO_DRAW,
    );

    if (!isCandidate || !pose || !pair) {
      return {
        state: {
          ...previous,
          candidateSinceMs: null,
          lastPose: null,
        },
        pose: null,
        fired: null,
      };
    }

    const candidateSinceMs = previous.candidateSinceMs ?? nowMs;
    if (nowMs - candidateSinceMs < ACQUIRE_MS) {
      return {
        state: {
          ...previous,
          candidateSinceMs,
          lastPose: pose,
        },
        pose: null,
        fired: null,
      };
    }

    const state: BowGestureState = {
      ...previous,
      phase: 'drawing',
      candidateSinceMs,
      drawingSinceMs: nowMs,
      lostSinceMs: null,
      drawHandedness: pair.drawHand.handedness,
      bowHandedness: pair.bowHand.handedness,
      lastPose: pose,
      drawWasPinched: true,
    };
    return { state, pose, fired: null };
  }

  const pair = selectExistingPair(hands, previous);
  const currentPose = pair ? makePose(pair.drawHand, pair.bowHand) : null;
  const geometryValid = Boolean(currentPose && geometryLooksLikeBow(currentPose));
  const released = Boolean(
    pair &&
    previous.drawWasPinched &&
    pair.drawHand.pinchRatio >= RELEASE_PINCH &&
    previous.lastPose &&
    previous.lastPose.tension >= MIN_TENSION_TO_FIRE &&
    nowMs - (previous.drawingSinceMs ?? nowMs) >= 120,
  );

  if (released && previous.lastPose) {
    return {
      state: {
        ...createBowGestureState(),
        phase: 'cooldown',
        cooldownUntilMs: nowMs + SHOT_COOLDOWN_MS,
      },
      pose: null,
      fired: currentPose && geometryValid ? currentPose : previous.lastPose,
    };
  }

  if (!geometryValid || !currentPose || !pair) {
    const lostSinceMs = previous.lostSinceMs ?? nowMs;
    if (nowMs - lostSinceMs > LOST_GRACE_MS) {
      return { state: createBowGestureState(), pose: null, fired: null };
    }
    return {
      state: { ...previous, lostSinceMs },
      pose: previous.lastPose,
      fired: null,
    };
  }

  const drawWasPinched =
    previous.drawWasPinched || pair.drawHand.pinchRatio < PINCH_TO_DRAW;
  const state: BowGestureState = {
    ...previous,
    lostSinceMs: null,
    lastPose: currentPose,
    drawWasPinched,
  };
  return { state, pose: currentPose, fired: null };
}
