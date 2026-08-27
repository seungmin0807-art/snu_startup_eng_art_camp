'use client';

/* eslint-disable @next/next/no-img-element -- transparent raster VFX are animated directly */

import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  type HandGesture,
  type HandSample,
  type TrackedHand,
  useHandTracking,
} from './useHandTracking';
import {
  advanceVictoryHold,
  createVictoryHoldState,
} from './victoryHold';
import Playground from './Playground';

type PositionedEffect = { id: number; x: number; y: number };
type LightningStrike = { id: number; x: number };
type ExperienceMode = 'landing' | 'window' | 'playground';

const rainDrops = Array.from({ length: 104 }, (_, index) => ({
  id: index,
  x: (index * 41 + (index % 5) * 7) % 104,
  delay: -((index * 0.173) % 3.4),
  duration: 1.15 + ((index * 17) % 76) / 100,
  scale: 0.55 + ((index * 29) % 51) / 100,
  opacity: 0.5 + ((index * 13) % 39) / 100,
  drift: -5 - ((index * 19) % 12),
}));

function drawTextureCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  alpha: number,
) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.save();
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = alpha;
  context.drawImage(
    image,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  context.restore();
}

export default function DigitalWindow() {
  const [mode, setMode] = useState<ExperienceMode>('landing');
  const [hand, setHand] = useState<HandSample | null>(null);
  const [trackedHands, setTrackedHands] = useState<TrackedHand[]>([]);
  const [rainOn, setRainOn] = useState(false);
  const [growth, setGrowth] = useState(0.22);
  const [lightPulses, setLightPulses] = useState<PositionedEffect[]>([]);
  const [bolts, setBolts] = useState<LightningStrike[]>([]);

  const sceneRef = useRef<HTMLDivElement>(null);
  const fogCanvasRef = useRef<HTMLCanvasElement>(null);
  const frostTextureRef = useRef<HTMLImageElement | null>(null);
  const pointerDownRef = useRef(false);
  const previousGestureRef = useRef<HandGesture>('none');
  const victoryHoldRef = useRef(createVictoryHoldState());
  const effectIdRef = useRef(0);
  const lastLightningRef = useRef(0);
  const lastLightRef = useRef(0);
  const modeRef = useRef<ExperienceMode>('landing');
  const opened = mode !== 'landing';

  const syncFogCanvas = useCallback(() => {
    const canvas = fogCanvasRef.current;
    const scene = sceneRef.current;
    if (!canvas || !scene) return;
    const width = Math.max(1, Math.round(scene.clientWidth));
    const height = Math.max(1, Math.round(scene.clientHeight));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }, []);

  const addFrost = useCallback((intensity: number) => {
    syncFogCanvas();
    const canvas = fogCanvasRef.current;
    const texture = frostTextureRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !texture || !context) return;
    drawTextureCover(context, texture, canvas.width, canvas.height, 0.24 + intensity * 0.34);
  }, [syncFogCanvas]);

  const wipeFog = useCallback((x: number, y: number) => {
    const canvas = fogCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.save();
    context.globalCompositeOperation = 'destination-out';
    context.filter = 'blur(5px)';
    context.beginPath();
    context.arc(
      x * canvas.width,
      y * canvas.height,
      Math.max(18, canvas.width * 0.024),
      0,
      Math.PI * 2,
    );
    context.fill();
    context.restore();
  }, []);

  const createLight = useCallback((x: number, y: number) => {
    effectIdRef.current += 1;
    const id = effectIdRef.current;
    setLightPulses((current) => [...current.slice(-4), { id, x, y }]);
    if (x > 0.64 && y > 0.43) {
      setGrowth((value) => Math.min(1, value + 0.13));
    }
    window.setTimeout(() => {
      setLightPulses((current) => current.filter((pulse) => pulse.id !== id));
    }, 1550);
  }, []);

  const createLightning = useCallback((x: number) => {
    effectIdRef.current += 1;
    const id = effectIdRef.current;
    setBolts((current) => [...current.slice(-2), { id, x }]);
    window.setTimeout(() => {
      setBolts((current) => current.filter((bolt) => bolt.id !== id));
    }, 1050);
  }, []);

  const handleBreath = useCallback((intensity: number) => {
    if (modeRef.current !== 'window') return;
    addFrost(intensity);
  }, [addFrost]);

  const handleHandSample = useCallback((sample: HandSample | null) => {
    if (modeRef.current !== 'window') return;
    setHand(sample);

    const now = performance.now();
    const victoryUpdate = advanceVictoryHold(
      victoryHoldRef.current,
      sample?.gesture === 'victory',
      now,
    );
    victoryHoldRef.current = victoryUpdate.state;
    if (victoryUpdate.toggled) {
      setRainOn((current) => !current);
    }

    if (!sample) {
      previousGestureRef.current = 'none';
      return;
    }

    const previous = previousGestureRef.current;

    if (sample.gesture === 'point') {
      wipeFog(sample.x, sample.y);
    }

    if (
      sample.gesture === 'pinch' &&
      previous !== 'pinch' &&
      now - lastLightRef.current > 420
    ) {
      lastLightRef.current = now;
      createLight(sample.x, sample.y);
    }

    if (
      sample.gesture === 'open' &&
      previous !== 'open' &&
      now - lastLightningRef.current > 900
    ) {
      lastLightningRef.current = now;
      createLightning(sample.x);
    }

    previousGestureRef.current = sample.gesture;
  }, [createLight, createLightning, wipeFog]);

  const handleTrackedHands = useCallback((hands: TrackedHand[]) => {
    if (modeRef.current !== 'playground') return;
    setTrackedHands(hands);
  }, []);

  const {
    videoRef,
    status: cameraStatus,
    error: cameraError,
    start: startCamera,
    stop: stopCamera,
  } = useHandTracking({
    onSample: handleHandSample,
    onBreath: handleBreath,
    onHands: handleTrackedHands,
  });

  useEffect(() => {
    const texture = new window.Image();
    texture.onload = () => {
      frostTextureRef.current = texture;
    };
    texture.src = '/media/frost.png';
    return () => {
      texture.onload = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const observer = new ResizeObserver(syncFogCanvas);
    observer.observe(scene);
    syncFogCanvas();
    return () => observer.disconnect();
  }, [syncFogCanvas]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !opened) return;
      stopCamera();
      modeRef.current = 'landing';
      setMode('landing');
      setHand(null);
      setTrackedHands([]);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [opened, stopCamera]);

  const startExperience = (nextMode: Exclude<ExperienceMode, 'landing'>) => {
    setRainOn(false);
    setLightPulses([]);
    setBolts([]);
    setHand(null);
    setTrackedHands([]);
    previousGestureRef.current = 'none';
    victoryHoldRef.current = createVictoryHoldState();
    fogCanvasRef.current?.getContext('2d')?.clearRect(
      0,
      0,
      fogCanvasRef.current.width,
      fogCanvasRef.current.height,
    );
    modeRef.current = nextMode;
    setMode(nextMode);
    void startCamera();
  };

  const openWindow = () => startExperience('window');
  const openPlayground = () => startExperience('playground');

  const pointFromEvent = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== 'window' || (event.target as HTMLElement).closest('button')) return;
    if (cameraStatus === 'idle' || cameraStatus === 'error') void startCamera();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerDownRef.current = true;
    const point = pointFromEvent(event);
    createLight(point.x, point.y);
    wipeFog(point.x, point.y);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== 'window' || !pointerDownRef.current) return;
    const point = pointFromEvent(event);
    wipeFog(point.x, point.y);
  };

  const onPointerUp = () => {
    pointerDownRef.current = false;
  };

  const onSceneKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (mode !== 'window') return;
    if (event.key.toLowerCase() === 'r') setRainOn((current) => !current);
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      createLightning(0.5);
    }
  };

  const sceneStyle = {
    '--plant-scale': 0.46 + growth * 0.68,
  } as CSSProperties;

  const windActive = mode === 'window' && hand?.gesture === 'open';

  return (
    <main
      className={[
        'forest-app',
        opened ? 'is-open' : '',
        mode === 'window' ? 'is-window' : '',
        mode === 'playground' ? 'is-playground' : '',
        rainOn ? 'rain-active' : '',
        windActive ? 'wind-active' : '',
      ].filter(Boolean).join(' ')}
      style={sceneStyle}
    >
      <div
        ref={sceneRef}
        className="forest-scene"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onSceneKeyDown}
        tabIndex={0}
        role="application"
        aria-label={mode === 'playground'
          ? '카메라 위에서 빛의 활을 당겨 쏘는 플레이그라운드'
          : '손동작과 입김에 반응하는 숲 창문'}
      >
        {mode !== 'playground' && (
          <video
            className="forest-background"
            src="/media/forest-window.mp4"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            disablePictureInPicture
            aria-hidden="true"
          />
        )}

        {mode === 'window' && lightPulses.map((pulse) => (
          <img
            key={pulse.id}
            className="light-pulse"
            src="/media/forest-light.png"
            alt=""
            draggable={false}
            aria-hidden="true"
            style={{ left: `${pulse.x * 100}%`, top: `${pulse.y * 100}%` }}
          />
        ))}

        {mode === 'window' && rainOn && (
          <div className="rain-field" aria-hidden="true">
            {rainDrops.map((drop) => ({
              ...drop,
              style: {
                '--rain-x': `${drop.x}%`,
                '--rain-delay': `${drop.delay}s`,
                '--rain-duration': `${drop.duration}s`,
                '--rain-scale': drop.scale,
                '--rain-opacity': drop.opacity,
                '--rain-drift': `${drop.drift}vw`,
              } as CSSProperties,
            })).map((drop) => (
              <img
                key={drop.id}
                className="rain-drop"
                src="/media/rain-drop.png"
                alt=""
                draggable={false}
                style={drop.style}
              />
            ))}
          </div>
        )}

        {mode === 'window' && windActive && (
          <div className="wind-raster-layer" aria-hidden="true">
            <img className="wind-raster wind-raster-a" src="/media/wind.png" alt="" draggable={false} />
            <img className="wind-raster wind-raster-b" src="/media/wind.png" alt="" draggable={false} />
          </div>
        )}

        {mode === 'window' && bolts.map((bolt) => (
          <img
            key={bolt.id}
            className="lightning-raster"
            src="/media/lightning-natural.png"
            alt=""
            draggable={false}
            aria-hidden="true"
            style={{ left: `${bolt.x * 100}%` }}
          />
        ))}

        {mode === 'window' && (
          <img className="plant-raster" src="/media/plant-growth.png" alt="" draggable={false} aria-hidden="true" />
        )}
        <canvas
          ref={fogCanvasRef}
          className={mode === 'window' ? 'frost-canvas' : 'frost-canvas is-hidden'}
          aria-hidden="true"
        />
        <video
          ref={videoRef}
          className={mode === 'playground' ? 'playground-camera' : 'camera-source'}
          playsInline
          muted
          aria-hidden="true"
        />
        {mode === 'playground' && (
          <Playground
            cameraStatus={cameraStatus}
            cameraError={cameraError}
            hands={trackedHands}
          />
        )}
        <span className="sr-only" aria-live="polite">{cameraStatus === 'active' ? '손동작 인식 중' : ''}</span>

        {mode === 'landing' && (
          <section className="welcome-screen" aria-labelledby="welcome-title">
            <div className="welcome-brand"><i /> MY WINDOW</div>
            <div className="welcome-copy">
              <p>PERSONAL FOREST WINDOW</p>
              <h1 id="welcome-title">원하는 날씨를<br /><em>손끝으로 만드는 숲.</em></h1>
              <div className="welcome-actions">
                <button type="button" onClick={openWindow}>
                  <strong>OPEN THIS WINDOW</strong>
                  <small>숲의 날씨를 손동작으로 만듭니다</small>
                </button>
                <button type="button" className="playground-entry" onClick={openPlayground}>
                  <strong>ENTER PLAYGROUND</strong>
                  <small>카메라 위에서 빛의 활을 당겨 쏩니다</small>
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
