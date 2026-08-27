export type HandGesture = 'none' | 'point' | 'pinch' | 'open' | 'victory';

export type GestureLandmark = {
  x: number;
  y: number;
  z?: number;
};

export type RecognizedGesture = {
  categoryName?: string;
  score?: number;
};

export type ClassifiedHand = {
  gesture: HandGesture;
  pinchLatched: boolean;
  confidence: number;
};

const distance = (a: GestureLandmark, b: GestureLandmark) =>
  Math.hypot(a.x - b.x, a.y - b.y);

const fingerExtensionRatio = (
  landmarks: GestureLandmark[],
  tipIndex: number,
  pipIndex: number,
) => distance(landmarks[tipIndex], landmarks[0]) /
  Math.max(distance(landmarks[pipIndex], landmarks[0]), 0.001);

const jointAngle = (
  landmarks: GestureLandmark[],
  mcpIndex: number,
  pipIndex: number,
  tipIndex: number,
) => {
  const mcp = landmarks[mcpIndex];
  const pip = landmarks[pipIndex];
  const tip = landmarks[tipIndex];
  const ax = mcp.x - pip.x;
  const ay = mcp.y - pip.y;
  const bx = tip.x - pip.x;
  const by = tip.y - pip.y;
  const denominator = Math.max(Math.hypot(ax, ay) * Math.hypot(bx, by), 0.000001);
  const cosine = Math.min(1, Math.max(-1, (ax * bx + ay * by) / denominator));
  return Math.acos(cosine) * 180 / Math.PI;
};

const recognizedAs = (
  recognized: RecognizedGesture | undefined,
  categoryName: string,
) => recognized?.categoryName === categoryName && (recognized.score ?? 1) >= 0.25;

/**
 * Classifies one MediaPipe hand. The trained canned gesture result wins for
 * Victory/Open/Point, with a geometry fallback for frames where its score dips.
 */
export function classifyHandGesture(
  landmarks: GestureLandmark[],
  recognized: RecognizedGesture | undefined,
  wasPinching = false,
): ClassifiedHand {
  if (landmarks.length < 21) {
    return { gesture: 'none', pinchLatched: false, confidence: 0 };
  }

  const handScale = Math.max(
    distance(landmarks[0], landmarks[9]),
    distance(landmarks[5], landmarks[17]),
    0.025,
  );
  const pinchRatio = distance(landmarks[4], landmarks[8]) / handScale;
  const pinchLatched = wasPinching ? pinchRatio < 0.42 : pinchRatio < 0.27;

  const indexRatio = fingerExtensionRatio(landmarks, 8, 6);
  const middleRatio = fingerExtensionRatio(landmarks, 12, 10);
  const ringRatio = fingerExtensionRatio(landmarks, 16, 14);
  const pinkyRatio = fingerExtensionRatio(landmarks, 20, 18);
  const indexAngle = jointAngle(landmarks, 5, 6, 8);
  const middleAngle = jointAngle(landmarks, 9, 10, 12);
  const ringAngle = jointAngle(landmarks, 13, 14, 16);
  const pinkyAngle = jointAngle(landmarks, 17, 18, 20);

  const indexStraight = indexRatio > 1.04 && indexAngle > 142;
  const middleStraight = middleRatio > 1.04 && middleAngle > 142;
  const extendedAverage = (indexRatio + middleRatio) / 2;
  const ringFolded =
    ringAngle < 148 ||
    ringRatio < extendedAverage - 0.1 ||
    distance(landmarks[16], landmarks[9]) < distance(landmarks[14], landmarks[9]) * 1.08;
  const pinkyFolded =
    pinkyAngle < 148 ||
    pinkyRatio < extendedAverage - 0.1 ||
    distance(landmarks[20], landmarks[9]) < distance(landmarks[18], landmarks[9]) * 1.08;
  const victorySeparated = distance(landmarks[8], landmarks[12]) > handScale * 0.22;
  const manualVictory =
    indexStraight &&
    middleStraight &&
    ringFolded &&
    pinkyFolded &&
    victorySeparated;

  // Victory intentionally comes before pinch. A V with the thumb near the
  // index finger must keep the three-second rain hold alive.
  if (recognizedAs(recognized, 'Victory')) {
    return {
      gesture: 'victory',
      pinchLatched: false,
      confidence: recognized?.score ?? 1,
    };
  }
  if (manualVictory) {
    return { gesture: 'victory', pinchLatched: false, confidence: 0.5 };
  }
  if (pinchLatched) {
    return { gesture: 'pinch', pinchLatched: true, confidence: 1 - pinchRatio };
  }
  if (recognizedAs(recognized, 'Open_Palm')) {
    return { gesture: 'open', pinchLatched: false, confidence: recognized?.score ?? 1 };
  }
  if (recognizedAs(recognized, 'Pointing_Up')) {
    return { gesture: 'point', pinchLatched: false, confidence: recognized?.score ?? 1 };
  }

  const ringStraight = ringRatio > 1.1 && ringAngle > 146;
  const pinkyStraight = pinkyRatio > 1.1 && pinkyAngle > 146;
  if (indexStraight && middleStraight && ringStraight && pinkyStraight) {
    return { gesture: 'open', pinchLatched: false, confidence: 0.45 };
  }
  if (indexStraight && !middleStraight && ringFolded && pinkyFolded) {
    return { gesture: 'point', pinchLatched: false, confidence: 0.4 };
  }

  return { gesture: 'none', pinchLatched: false, confidence: 0 };
}

/** Selects Victory from any detected hand before falling back to hand zero. */
export function selectSampleHand<T extends ClassifiedHand>(hands: T[]): T | null {
  const victories = hands.filter((hand) => hand.gesture === 'victory');
  if (victories.length > 0) {
    return victories.reduce((best, hand) =>
      hand.confidence > best.confidence ? hand : best);
  }
  return hands[0] ?? null;
}
