export const VICTORY_HOLD_DURATION_MS = 3_000;
export const VICTORY_CLASSIFIER_GAP_TOLERANCE_MS = 500;
export const VICTORY_REARM_DELAY_MS = 800;

export type VictoryHoldPhase = "armed" | "latched";

export type VictoryHoldState = {
  phase: VictoryHoldPhase;
  holdStartedAtMs: number | null;
  nonVictoryStartedAtMs: number | null;
};

export type VictoryHoldUpdate = {
  state: VictoryHoldState;
  toggled: boolean;
};

export function createVictoryHoldState(): VictoryHoldState {
  return {
    phase: "armed",
    holdStartedAtMs: null,
    nonVictoryStartedAtMs: null,
  };
}

/**
 * Advances the V-gesture hold state without mutating the previous state.
 * `nowMs` should come from one monotonic clock (for example performance.now()).
 */
export function advanceVictoryHold(
  previous: VictoryHoldState,
  isVictory: boolean,
  nowMs: number,
): VictoryHoldUpdate {
  if (previous.phase === "latched") {
    if (isVictory) {
      return {
        state: {
          ...previous,
          nonVictoryStartedAtMs: null,
        },
        toggled: false,
      };
    }

    const nonVictoryStartedAtMs =
      previous.nonVictoryStartedAtMs ?? nowMs;

    if (nowMs - nonVictoryStartedAtMs > VICTORY_REARM_DELAY_MS) {
      return {
        state: createVictoryHoldState(),
        toggled: false,
      };
    }

    return {
      state: {
        ...previous,
        nonVictoryStartedAtMs,
      },
      toggled: false,
    };
  }

  if (!isVictory) {
    const nonVictoryStartedAtMs =
      previous.nonVictoryStartedAtMs ?? nowMs;
    const gapExceeded =
      nowMs - nonVictoryStartedAtMs >
      VICTORY_CLASSIFIER_GAP_TOLERANCE_MS;

    return {
      state: {
        phase: "armed",
        holdStartedAtMs: gapExceeded ? null : previous.holdStartedAtMs,
        nonVictoryStartedAtMs,
      },
      toggled: false,
    };
  }

  const gapExceeded =
    previous.nonVictoryStartedAtMs !== null &&
    nowMs - previous.nonVictoryStartedAtMs >
      VICTORY_CLASSIFIER_GAP_TOLERANCE_MS;
  const holdStartedAtMs =
    previous.holdStartedAtMs === null || gapExceeded
      ? nowMs
      : previous.holdStartedAtMs;

  if (nowMs - holdStartedAtMs >= VICTORY_HOLD_DURATION_MS) {
    return {
      state: {
        phase: "latched",
        holdStartedAtMs: null,
        nonVictoryStartedAtMs: null,
      },
      toggled: true,
    };
  }

  return {
    state: {
      phase: "armed",
      holdStartedAtMs,
      nonVictoryStartedAtMs: null,
    },
    toggled: false,
  };
}
