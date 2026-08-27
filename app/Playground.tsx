'use client';

/* eslint-disable @next/next/no-img-element -- generated transparent raster VFX are animated directly */

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  advanceBowGesture,
  type BowPose,
  createBowGestureState,
} from './bowGesture';
import type { TrackedHand, TrackingStatus } from './useHandTracking';

type Projectile = {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  impactX: number;
  impactY: number;
  velocityX: number;
  velocityY: number;
  angle: number;
  age: number;
  scale: number;
  opacity: number;
  towardCamera: boolean;
};

type Impact = { id: number; x: number; y: number };

type PlaygroundProps = {
  cameraStatus: TrackingStatus;
  cameraError: string;
  hands: TrackedHand[];
};

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

function visualFromPose(pose: BowPose) {
  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);
  const deltaX = (pose.bowHand.center.x - pose.drawHand.center.x) * width;
  const deltaY = (pose.bowHand.center.y - pose.drawHand.center.y) * height;
  const length = Math.hypot(deltaX, deltaY);
  const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
  const middleX = (pose.bowHand.center.x + pose.drawHand.center.x) / 2;
  const middleY = (pose.bowHand.center.y + pose.drawHand.center.y) / 2;

  return {
    angle,
    arrowLength: Math.max(150, length + Math.min(width, height) * 0.1),
    bowSize: Math.min(
      Math.max(260, Math.min(width, height) * (0.46 + pose.tension * 0.18)),
      Math.min(width, height) * 0.78,
    ),
    middleX,
    middleY,
  };
}

export default function Playground({
  cameraStatus,
  cameraError,
  hands,
}: PlaygroundProps) {
  const gestureRef = useRef(createBowGestureState());
  const projectileRef = useRef<Projectile[]>([]);
  const nextIdRef = useRef(0);
  const [pose, setPose] = useState<BowPose | null>(null);
  const [projectiles, setProjectiles] = useState<Projectile[]>([]);
  const [impacts, setImpacts] = useState<Impact[]>([]);
  const [hasFired, setHasFired] = useState(false);

  const addImpact = useCallback((x: number, y: number) => {
    nextIdRef.current += 1;
    const id = nextIdRef.current;
    setImpacts((current) => [...current.slice(-2), { id, x, y }]);
    window.setTimeout(() => {
      setImpacts((current) => current.filter((impact) => impact.id !== id));
    }, 5_000);
  }, []);

  const fire = useCallback((firedPose: BowPose) => {
    const width = Math.max(window.innerWidth, 1);
    const height = Math.max(window.innerHeight, 1);
    const pixelX = firedPose.direction.x * width;
    const pixelY = firedPose.direction.y * height;
    const pixelMagnitude = Math.max(1, Math.hypot(pixelX, pixelY));
    const unitX = pixelX / pixelMagnitude;
    const unitY = pixelY / pixelMagnitude;
    const speed = 760 + firedPose.tension * 720;
    const startX = firedPose.bowHand.center.x;
    const startY = firedPose.bowHand.center.y;
    const towardCamera = firedPose.towardCamera;
    const impactX = clamp(startX + firedPose.direction.x * 0.07, 0.12, 0.88);
    const impactY = clamp(startY + firedPose.direction.y * 0.05, 0.14, 0.86);

    nextIdRef.current += 1;
    const projectile: Projectile = {
      id: nextIdRef.current,
      x: startX,
      y: startY,
      startX,
      startY,
      impactX,
      impactY,
      velocityX: unitX * speed / width,
      velocityY: unitY * speed / height,
      angle: Math.atan2(pixelY, pixelX) * (180 / Math.PI),
      age: 0,
      scale: towardCamera ? 0.18 : 0.32 + firedPose.tension * 0.1,
      opacity: 1,
      towardCamera,
    };
    projectileRef.current = [...projectileRef.current, projectile];
    setProjectiles(projectileRef.current);
    setHasFired(true);
  }, []);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      const update = advanceBowGesture(
        gestureRef.current,
        hands,
        performance.now(),
      );
      gestureRef.current = update.state;
      setPose(update.pose);
      if (update.fired) fire(update.fired);
    });
    return () => cancelAnimationFrame(frameId);
  }, [fire, hands]);

  useEffect(() => {
    let frameId = 0;
    let previousAt = performance.now();

    const frame = (now: number) => {
      const deltaSeconds = Math.min(0.034, Math.max(0.001, (now - previousAt) / 1000));
      previousAt = now;
      const survivors: Projectile[] = [];
      const newImpacts: Array<{ x: number; y: number }> = [];

      for (const projectile of projectileRef.current) {
        const age = projectile.age + deltaSeconds;
        if (projectile.towardCamera) {
          const duration = 0.66;
          const progress = clamp(age / duration);
          if (progress >= 1) {
            newImpacts.push({ x: projectile.impactX, y: projectile.impactY });
            continue;
          }
          const eased = 1 - Math.pow(1 - progress, 3);
          survivors.push({
            ...projectile,
            age,
            x: projectile.startX + (projectile.impactX - projectile.startX) * eased,
            y: projectile.startY + (projectile.impactY - projectile.startY) * eased,
            scale: 0.18 + Math.pow(progress, 2.35) * 2.8,
            opacity: progress < 0.9 ? 1 : (1 - progress) / 0.1,
          });
          continue;
        }

        const velocityY = projectile.velocityY + 0.42 * deltaSeconds;
        const x = projectile.x + projectile.velocityX * deltaSeconds;
        const y = projectile.y + velocityY * deltaSeconds;
        if (age > 2.4 || x < -0.24 || x > 1.24 || y > 1.26) continue;
        const angle = Math.atan2(
          velocityY * window.innerHeight,
          projectile.velocityX * window.innerWidth,
        ) * (180 / Math.PI);
        survivors.push({
          ...projectile,
          age,
          x,
          y,
          velocityX: projectile.velocityX * 0.998,
          velocityY,
          angle,
          opacity: age > 1.9 ? Math.max(0, (2.4 - age) / 0.5) : 1,
        });
      }

      if (survivors.length !== projectileRef.current.length || survivors.length > 0) {
        projectileRef.current = survivors;
        setProjectiles(survivors);
      }
      newImpacts.forEach((impact) => addImpact(impact.x, impact.y));
      frameId = requestAnimationFrame(frame);
    };

    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [addImpact]);

  const bowVisual = pose ? visualFromPose(pose) : null;
  const hint = cameraStatus === 'loading'
    ? '카메라를 여는 중'
    : cameraStatus === 'error'
      ? cameraError || '카메라를 시작하지 못했습니다'
      : pose
        ? pose.towardCamera
          ? 'CAMERA AIM · 손가락을 놓아 발사'
          : 'ENERGY LOCK · 손가락을 놓아 발사'
        : hasFired
          ? '엄지와 검지로 시위를 잡고 두 손을 벌리세요'
          : '두 손을 들어 빛의 활을 당겨보세요';

  return (
    <div className="playground-vfx" aria-live="polite">
      <div className="playground-mark">
        <span>PLAYGROUND</span>
        <strong>ENERGY ARCHERY</strong>
      </div>

      {bowVisual && pose && (
        <div className="bow-rig" aria-hidden="true">
          <img
            className="energy-bow"
            src="/media/energy-bow.png"
            alt=""
            draggable={false}
            style={{
              '--bow-x': `${pose.bowHand.center.x * 100}%`,
              '--bow-y': `${pose.bowHand.center.y * 100}%`,
              '--bow-size': `${bowVisual.bowSize}px`,
              '--bow-angle': `${bowVisual.angle + 90}deg`,
              '--bow-charge': 0.82 + pose.tension * 0.28,
            } as CSSProperties}
          />
          <img
            className="nocked-energy-arrow"
            src="/media/energy-arrow.png"
            alt=""
            draggable={false}
            style={{
              '--arrow-x': `${bowVisual.middleX * 100}%`,
              '--arrow-y': `${bowVisual.middleY * 100}%`,
              '--arrow-length': `${bowVisual.arrowLength}px`,
              '--arrow-angle': `${bowVisual.angle}deg`,
              '--arrow-charge': 0.72 + pose.tension * 0.36,
            } as CSSProperties}
          />
        </div>
      )}

      {projectiles.map((projectile) => (
        <img
          key={projectile.id}
          className={projectile.towardCamera
            ? 'energy-projectile camera-bound'
            : 'energy-projectile ballistic'}
          src="/media/energy-arrow.png"
          alt=""
          draggable={false}
          aria-hidden="true"
          style={{
            '--projectile-x': `${projectile.x * 100}%`,
            '--projectile-y': `${projectile.y * 100}%`,
            '--projectile-angle': `${projectile.angle}deg`,
            '--projectile-scale': projectile.scale,
            '--projectile-opacity': projectile.opacity,
          } as CSSProperties}
        />
      ))}

      {impacts.map((impact) => (
        <img
          key={impact.id}
          className="screen-impact"
          src="/media/impact-crack.png"
          alt=""
          draggable={false}
          aria-hidden="true"
          style={{
            '--impact-x': `${impact.x * 100}%`,
            '--impact-y': `${impact.y * 100}%`,
          } as CSSProperties}
        />
      ))}

      <p className={cameraStatus === 'error' ? 'playground-hint is-error' : 'playground-hint'}>
        {hint}
      </p>
    </div>
  );
}
