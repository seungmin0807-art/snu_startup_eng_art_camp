'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GestureRecognizer, NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  classifyHandGesture,
  selectSampleHand,
  type HandGesture,
} from './handGesture';

export type { HandGesture } from './handGesture';

export type TrackingStatus = 'idle' | 'loading' | 'active' | 'error';

export type HandSample = {
  x: number;
  y: number;
  gesture: HandGesture;
};

export type TrackedHand = {
  id: string;
  handedness: 'Left' | 'Right' | 'Unknown';
  center: { x: number; y: number };
  scale: number;
  pinchRatio: number;
  openness: number;
  landmarks: Array<{ x: number; y: number; z: number }>;
};

type HandTrackingOptions = {
  onSample: (sample: HandSample | null) => void;
  onBreath: (intensity: number) => void;
  onHands?: (hands: TrackedHand[]) => void;
};

const distance = (a: NormalizedLandmark, b: NormalizedLandmark) =>
  Math.hypot(a.x - b.x, a.y - b.y);

const fingerExtensionRatio = (
  landmarks: NormalizedLandmark[],
  tipIndex: number,
  pipIndex: number,
) => distance(landmarks[tipIndex], landmarks[0]) /
  Math.max(distance(landmarks[pipIndex], landmarks[0]), 0.001);

const fingerExtended = (
  landmarks: NormalizedLandmark[],
  tipIndex: number,
  pipIndex: number,
) => fingerExtensionRatio(landmarks, tipIndex, pipIndex) > 1.14;

function getUserMediaWithTimeout(constraints: MediaStreamConstraints, timeoutMs: number) {
  const request = navigator.mediaDevices.getUserMedia(constraints);
  return new Promise<MediaStream>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('권한 응답이 오래 걸리고 있어요. 다시 눌러 시도해 주세요.'));
    }, timeoutMs);

    request.then((stream) => {
      if (settled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      resolve(stream);
    }).catch((cause) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(cause);
    });
  });
}

function friendlyCameraError(cause: unknown) {
  if (cause instanceof DOMException) {
    if (cause.name === 'NotAllowedError' || cause.name === 'SecurityError') {
      return '카메라 권한이 꺼져 있어요. 브라우저에서 카메라를 허용해 주세요.';
    }
    if (cause.name === 'NotFoundError' || cause.name === 'DevicesNotFoundError') {
      return '연결된 카메라를 찾지 못했어요.';
    }
    if (cause.name === 'NotReadableError' || cause.name === 'TrackStartError') {
      return '다른 앱이 카메라를 사용 중이에요.';
    }
  }
  return cause instanceof Error ? cause.message : '카메라를 시작하지 못했어요.';
}

export function useHandTracking({ onSample, onBreath, onHands }: HandTrackingOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackerRef = useRef<GestureRecognizer | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const pinchByHandRef = useRef(new Map<string, boolean>());
  const smoothedRef = useRef<{ x: number; y: number } | null>(null);
  const callbacksRef = useRef({ onSample, onBreath, onHands });
  const requestIdRef = useRef(0);
  const [status, setStatus] = useState<TrackingStatus>('idle');
  const [error, setError] = useState('');
  const [microphoneReady, setMicrophoneReady] = useState(false);

  useEffect(() => {
    callbacksRef.current = { onSample, onBreath, onHands };
  }, [onSample, onBreath, onHands]);

  const stop = useCallback(() => {
    requestIdRef.current += 1;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    videoStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    videoStreamRef.current = null;
    audioStreamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    trackerRef.current?.close();
    trackerRef.current = null;
    pinchByHandRef.current.clear();
    smoothedRef.current = null;
    callbacksRef.current.onSample(null);
    callbacksRef.current.onHands?.([]);
    setMicrophoneReady(false);
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    if (status === 'loading' || status === 'active') return;

    setStatus('loading');
    setError('');
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('이 브라우저에서는 카메라를 사용할 수 없어요.');
      }

      const [{ FilesetResolver, GestureRecognizer }, videoStream] = await Promise.all([
        import('@mediapipe/tasks-vision'),
        getUserMediaWithTimeout({
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        }, 15_000),
      ]);

      if (requestIdRef.current !== requestId) {
        videoStream.getTracks().forEach((track) => track.stop());
        return;
      }

      const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      const tracker = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/models/gesture_recognizer.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        cannedGesturesClassifierOptions: {
          maxResults: 1,
          scoreThreshold: 0.35,
        },
      });

      if (!videoRef.current || requestIdRef.current !== requestId) {
        videoStream.getTracks().forEach((track) => track.stop());
        tracker.close();
        if (requestIdRef.current !== requestId) return;
        throw new Error('카메라 화면을 준비하지 못했어요.');
      }

      trackerRef.current = tracker;
      videoStreamRef.current = videoStream;
      videoRef.current.srcObject = videoStream;
      await videoRef.current.play();

      let analyser: AnalyserNode | null = null;
      let audioData: Uint8Array<ArrayBuffer> | null = null;

      let lastVideoTime = -1;
      let lastDetectionAt = 0;
      let breathFrames = 0;
      let lastBreathAt = 0;

      const frame = (timestamp: number) => {
        const video = videoRef.current;
        const activeTracker = trackerRef.current;

        if (
          video &&
          activeTracker &&
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.currentTime !== lastVideoTime &&
          timestamp - lastDetectionAt >= 45
        ) {
          lastVideoTime = video.currentTime;
          lastDetectionAt = timestamp;
          const result = activeTracker.recognizeForVideo(video, timestamp);

          const trackedHands = result.landmarks.map((handLandmarks, index) => {
            const mirroredLandmarks = handLandmarks.map((landmark) => ({
              x: 1 - landmark.x,
              y: landmark.y,
              z: landmark.z,
            }));
            const palmIndices = [0, 5, 9, 13, 17];
            const center = palmIndices.reduce(
              (point, landmarkIndex) => ({
                x: point.x + mirroredLandmarks[landmarkIndex].x / palmIndices.length,
                y: point.y + mirroredLandmarks[landmarkIndex].y / palmIndices.length,
              }),
              { x: 0, y: 0 },
            );
            const scale = Math.max(
              distance(handLandmarks[0], handLandmarks[9]),
              distance(handLandmarks[5], handLandmarks[17]),
              0.025,
            );
            const pinchRatio = distance(handLandmarks[4], handLandmarks[8]) / scale;
            const extendedCount = [
              fingerExtended(handLandmarks, 8, 6),
              fingerExtended(handLandmarks, 12, 10),
              fingerExtended(handLandmarks, 16, 14),
              fingerExtended(handLandmarks, 20, 18),
            ].filter(Boolean).length;
            const category = result.handedness[index]?.[0]?.categoryName;
            const handedness = category === 'Left' || category === 'Right'
              ? category
              : 'Unknown';

            return {
              id: `${handedness}-${index}`,
              handedness,
              center,
              scale,
              pinchRatio,
              openness: extendedCount / 4,
              landmarks: mirroredLandmarks,
            } satisfies TrackedHand;
          });

          callbacksRef.current.onHands?.(trackedHands);

          const activeHandKeys = new Set<string>();
          const classifiedHands = result.landmarks.map((handLandmarks, index) => {
            const category = result.handedness[index]?.[0]?.categoryName;
            const handKey = category === 'Left' || category === 'Right'
              ? category
              : `Unknown-${index}`;
            activeHandKeys.add(handKey);
            const classification = classifyHandGesture(
              handLandmarks,
              result.gestures[index]?.[0],
              pinchByHandRef.current.get(handKey) ?? false,
            );
            pinchByHandRef.current.set(handKey, classification.pinchLatched);
            return {
              ...classification,
              handKey,
              landmarks: handLandmarks,
            };
          });

          for (const handKey of pinchByHandRef.current.keys()) {
            if (!activeHandKeys.has(handKey)) pinchByHandRef.current.delete(handKey);
          }

          const selectedHand = selectSampleHand(classifiedHands);
          if (selectedHand) {
            const { gesture, landmarks } = selectedHand;
            const rawPoint = gesture === 'pinch'
              ? {
                  x: 1 - (landmarks[4].x + landmarks[8].x) / 2,
                  y: (landmarks[4].y + landmarks[8].y) / 2,
                }
              : { x: 1 - landmarks[8].x, y: landmarks[8].y };

            const previous = smoothedRef.current;
            const smoothed = previous
              ? {
                  x: previous.x + (rawPoint.x - previous.x) * 0.34,
                  y: previous.y + (rawPoint.y - previous.y) * 0.34,
                }
              : rawPoint;

            smoothedRef.current = smoothed;
            callbacksRef.current.onSample({
              x: Math.min(1, Math.max(0, smoothed.x)),
              y: Math.min(1, Math.max(0, smoothed.y)),
              gesture,
            });
          } else {
            pinchByHandRef.current.clear();
            callbacksRef.current.onSample(null);
            callbacksRef.current.onHands?.([]);
            smoothedRef.current = null;
          }
        }

        if (analyser && audioData) {
          analyser.getByteTimeDomainData(audioData);
          let sum = 0;
          for (let index = 0; index < audioData.length; index += 1) {
            const sample = (audioData[index] - 128) / 128;
            sum += sample * sample;
          }
          const rms = Math.sqrt(sum / audioData.length);
          breathFrames = rms > 0.065 ? breathFrames + 1 : Math.max(0, breathFrames - 1);
          if (breathFrames >= 3 && timestamp - lastBreathAt > 420) {
            callbacksRef.current.onBreath(Math.min(1, rms * 8));
            breathFrames = 0;
            lastBreathAt = timestamp;
          }
        }

        frameRef.current = requestAnimationFrame(frame);
      };

      frameRef.current = requestAnimationFrame(frame);
      setStatus('active');

      void (async () => {
        try {
          const audioStream = await getUserMediaWithTimeout({
            video: false,
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: false,
            },
          }, 10_000);
          if (requestIdRef.current !== requestId) {
            audioStream.getTracks().forEach((track) => track.stop());
            return;
          }
          const audioContext = new AudioContext();
          const source = audioContext.createMediaStreamSource(audioStream);
          analyser = audioContext.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.38;
          source.connect(analyser);
          audioData = new Uint8Array(analyser.fftSize);
          audioStreamRef.current = audioStream;
          audioContextRef.current = audioContext;
          setMicrophoneReady(true);
        } catch {
          setMicrophoneReady(false);
        }
      })();
    } catch (cause) {
      stop();
      setStatus('error');
      setError(friendlyCameraError(cause));
    }
  }, [status, stop]);

  useEffect(() => stop, [stop]);

  return {
    videoRef,
    status,
    error,
    microphoneReady,
    start,
    stop,
  };
}
