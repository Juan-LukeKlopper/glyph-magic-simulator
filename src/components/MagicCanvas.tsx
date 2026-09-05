/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { Point, Stroke, ElementType, AmbientEntity, MagicParticle, Spell } from '../types';
import { recognizeGesture, GlyphTemplates, scoreAgainstTarget } from '../recognizer';
import { mystSynth } from '../utils/synth';
import { SPELLS_DATABASE } from '../spellsData';

// Trace-mode auto-cast: minimum raw similarity to the practiced glyph required to compile
const TRACE_CAST_THRESHOLD = 0.55;

// Particle ceiling: non-essential spawns are skipped above this count to protect framerate
const MAX_PARTICLES = 900;

/** Score above which the classifier's opinion is shown to the user on a fizzle. */
const RECOGNIZE_THRESHOLD_DISPLAY = 0.45;

/**
 * Props for the interactive glyph-drawing canvas.
 *
 * `currentSpell` is the active selection (used as the Trace-mode target, or
 * null in free-draw). `practiceMode` toggles between guided tracing and
 * sandbox free-draw. Cast outcomes are reported up via the callbacks.
 */
interface MagicCanvasProps {
  currentSpell: Spell | null;
  practiceMode: boolean;
  onSpellRecognized: (spellId: string, accuracy: number, scores?: Record<string, number>) => void;
  onFizzle: (scores?: Record<string, number>) => void;
  isMuted: boolean;
}

// Helper functions to draw pure element primitives in guide outlines
function drawMiniLight(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // 1. Outer circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // 2. Small circle at top-center (relative cx = 0, cy = -0.5 * r, radius = r / 6)
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.5, r / 6, 0, Math.PI * 2);
  ctx.stroke();

  // 3. Triangle lines at the bottom
  // bottom-left: cx - 0.943 * r, cy + 0.333 * r
  // bottom-right: cx + 0.943 * r, cy + 0.333 * r
  // apex: cx, cy - 0.333 * r
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.943, cy + r * 0.333);
  ctx.lineTo(cx, cy - r * 0.333);
  ctx.lineTo(cx + r * 0.943, cy + r * 0.333);
  ctx.closePath();
  ctx.stroke();

  // 4. Vertical stem from bottom of circle (cy + r) to triangle apex (cy - 0.333 * r)
  ctx.beginPath();
  ctx.moveTo(cx, cy + r);
  ctx.lineTo(cx, cy - r * 0.333);
  ctx.stroke();

  // 5. Left and right horns
  // Left horn: from (cx - 0.157 * r, cy - 0.556 * r) to (cx, cy - r)
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.157, cy - r * 0.556);
  ctx.lineTo(cx, cy - r);
  ctx.stroke();

  // Right horn: from (cx + 0.157 * r, cy - 0.556 * r) to (cx, cy - r)
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.157, cy - r * 0.556);
  ctx.lineTo(cx, cy - r);
  ctx.stroke();

  // 6. Two slated crossbars (slashes) across center of stem
  // Slash 1: from (cx - 0.157 * r, cy + 0.25 * r) to (cx + 0.157 * r, cy + 0.083 * r)
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.157, cy + r * 0.25);
  ctx.lineTo(cx + r * 0.157, cy + r * 0.083);
  ctx.stroke();

  // Slash 2: from (cx - 0.157 * r, cy + 0.083 * r) to (cx + 0.157 * r, cy - 0.083 * r)
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.157, cy + r * 0.083);
  ctx.lineTo(cx + r * 0.157, cy - r * 0.083);
  ctx.stroke();
}

function drawMiniIce(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // 1. Outer circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // 2. Large curved arc crossing the bottom half
  // M (cx - 0.969 * r, cy + 0.25 * r) to (cx + 0.969 * r, cy + 0.25 * r)
  // Curving through control points: (cx - 0.366 * r, cy - 0.083 * r) and (cx + 0.366 * r, cy - 0.083 * r)
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.969, cy + r * 0.25);
  ctx.bezierCurveTo(
    cx - r * 0.366, cy - r * 0.083,
    cx + r * 0.366, cy - r * 0.083,
    cx + r * 0.969, cy + r * 0.25
  );
  ctx.stroke();

  // 3. Horizontal bar at cy + 0.5 * r
  // from cx - 0.867 * r to cx + 0.867 * r
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.867, cy + r * 0.5);
  ctx.lineTo(cx + r * 0.867, cy + r * 0.5);
  ctx.stroke();

  // 4. Central Diamond below the horizontal bar
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.125, cy + r * 0.625);
  ctx.lineTo(cx, cy + r * 0.5);
  ctx.lineTo(cx + r * 0.125, cy + r * 0.625);
  ctx.lineTo(cx, cy + r * 0.75);
  ctx.closePath();
  ctx.stroke();

  // 5. Large inner diamond/kite at the top half
  // apex: (cx, cy - r)
  // mid-left: (cx - 0.375 * r, cy - 0.5 * r)
  // mid-right: (cx + 0.375 * r, cy - 0.5 * r)
  // base: (cx, cy + 0.5 * r)
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx - r * 0.375, cy - r * 0.5);
  ctx.lineTo(cx, cy + r * 0.5);
  ctx.lineTo(cx + r * 0.375, cy - r * 0.5);
  ctx.closePath();
  ctx.stroke();

  // 6. Central vertical stem
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r * 0.5);
  ctx.stroke();
}

function drawMiniPlant(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // 1. Outer circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // 2. Small circle at bottom-center (relative cx = 0, cy = 0.5 * r, radius = r / 6)
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.5, r / 6, 0, Math.PI * 2);
  ctx.stroke();

  // 3. Solid center dot inside bottom-center circle
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.5, r * 0.052, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 4. Vertical main stem from small circle top (relative 0, 0.25) to upper branch split (relative 0, -0.375)
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.25);
  ctx.lineTo(cx, cy - r * 0.375);
  ctx.stroke();

  // 5. Lower branch splitters (clover leaflets)
  // Left: from (cx, cy + 0.25 * r) to (cx - 0.25 * r, cy)
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.25);
  ctx.lineTo(cx - r * 0.25, cy);
  ctx.stroke();

  // Right: from (cx, cy + 0.25 * r) to (cx + 0.25 * r, cy)
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.25);
  ctx.lineTo(cx + r * 0.25, cy);
  ctx.stroke();

  // 6. Upper branches splitting
  // Left: from (cx, cy - 0.375 * r) to (cx - 0.375 * r, cy - 0.75 * r)
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.375);
  ctx.lineTo(cx - r * 0.375, cy - r * 0.75);
  ctx.stroke();

  // Right: from (cx, cy - 0.375 * r) to (cx + 0.375 * r, cy - 0.75 * r)
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.375);
  ctx.lineTo(cx + r * 0.375, cy - r * 0.75);
  ctx.stroke();

  // 7. Lower horizontal crossbar (crossbar 1) at cy - 0.563 * r
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.187, cy - r * 0.563);
  ctx.lineTo(cx + r * 0.187, cy - r * 0.563);
  ctx.stroke();

  // 8. Upper horizontal crossbar (crossbar 2) at cy - 0.75 * r
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.375, cy - r * 0.75);
  ctx.lineTo(cx + r * 0.375, cy - r * 0.75);
  ctx.stroke();
}

function drawMiniFire(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // 1. Outer circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // 2. Large loop/circle at the bottom-center (relative cy = 0.5 * r, radius = 0.5 * r)
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.5, r * 0.5, 0, Math.PI * 2);
  ctx.stroke();

  // 3. Central bullet dot inside bottom-center circle
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.5, r * 0.052, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 4. Smaller circle at the top-middle (relative cy = -0.309 * r, radius = 0.309 * r)
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.309, r * 0.309, 0, Math.PI * 2);
  ctx.stroke();

  // 5. Curved inner right flame
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.5, cy + r * 0.5);
  ctx.bezierCurveTo(
    cx + r * 0.5, cy + r * 0.073,
    cx + r * 0.318, cy - r * 0.334,
    cx, cy - r * 0.618
  );
  ctx.stroke();

  // 6. Curved inner left flame
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.618);
  ctx.bezierCurveTo(
    cx - r * 0.318, cy - r * 0.334,
    cx - r * 0.5, cy + r * 0.073,
    cx - r * 0.5, cy + r * 0.5
  );
  ctx.stroke();

  // 7. Outer right tip flame hook
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.309, cy - r * 0.309);
  ctx.bezierCurveTo(
    cx + r * 0.309, cy - r * 0.573,
    cx + r * 0.197, cy - r * 0.825,
    cx, cy - r
  );
  ctx.stroke();

  // 8. Outer left tip flame hook
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.bezierCurveTo(
    cx - r * 0.197, cy - r * 0.825,
    cx - r * 0.309, cy - r * 0.573,
    cx - r * 0.309, cy - r * 0.309
  );
  ctx.stroke();
}

// Draw a perfect, high-fidelity vector representation of "The Owl House" showing designs
// Uses a distinct mystical lavender-indigo theme to clearly separate guidelines from drawn gold ink
function drawHighFidelityGlyphBlueprint(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  spellId: string,
  color: string
) {
  ctx.save();
  // Style the guide as an ancient, luminous spectral lavender celestial blueprint
  ctx.strokeStyle = 'rgba(162, 155, 254, 0.48)'; // Translucent Mystic Violet / Lavender
  ctx.fillStyle = 'rgba(162, 155, 254, 0.48)';
  ctx.shadowColor = '#6C5CE7'; // Radiant royal violet aura
  ctx.shadowBlur = 8;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Draw the outermost locator circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Draw two subtle inner locator alignment rings to make it look highly tactical and official
  ctx.save();
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = 'rgba(162, 155, 254, 0.22)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.94, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.88, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Render spell blueprint depending on spellId
  if (spellId === 'light') {
    drawMiniLight(ctx, cx, cy, r * 0.85);
  } else if (spellId === 'ice') {
    drawMiniIce(ctx, cx, cy, r * 0.85);
  } else if (spellId === 'plant') {
    drawMiniPlant(ctx, cx, cy, r * 0.85);
  } else if (spellId === 'fire') {
    drawMiniFire(ctx, cx, cy, r * 0.85);
  } else if (spellId === 'sleep_mist') {
    // Divided hemispheres
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.85);
    ctx.lineTo(cx, cy + r * 0.85);
    ctx.stroke();

    // Ice on the right, Fire on the left
    drawMiniIce(ctx, cx + r * 0.38, cy, r * 0.33);
    drawMiniFire(ctx, cx - r * 0.38, cy, r * 0.33);
  } else if (spellId === 'wind_vortex') {
    // Ice core
    drawMiniIce(ctx, cx, cy, r * 0.28);

    // 3 orbital stems leading to Fire nodes
    const angles = [Math.PI * 5/6, Math.PI * 1/6, Math.PI * 3/2];
    angles.forEach((ang) => {
      const nx = cx + r * 0.58 * Math.cos(ang);
      const ny = cy + r * 0.58 * Math.sin(ang);
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.28 * Math.cos(ang), cy + r * 0.28 * Math.sin(ang));
      ctx.lineTo(nx, ny);
      ctx.stroke();
      drawMiniFire(ctx, nx, ny, r * 0.15);
    });

    // 1 top Light stem & node
    const tx = cx;
    const ty = cy - r * 0.65;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.28);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    drawMiniLight(ctx, tx, ty, r * 0.16);
  } else if (spellId === 'invisibility') {
    // Light central anchor
    drawMiniLight(ctx, cx, cy, r * 0.38);

    // Top-left Light node
    const tlx = cx - r * 0.52;
    const tly = cy - r * 0.52;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.25 * Math.SQRT1_2, cy - r * 0.25 * Math.SQRT1_2);
    ctx.lineTo(tlx, tly);
    ctx.stroke();
    drawMiniLight(ctx, tlx, tly, r * 0.20);

    // Bottom-left Ice node
    const blx = cx - r * 0.52;
    const bly = cy + r * 0.52;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.25 * Math.SQRT1_2, cy + r * 0.25 * Math.SQRT1_2);
    ctx.lineTo(blx, bly);
    ctx.stroke();
    drawMiniIce(ctx, blx, bly, r * 0.20);

    // Bottom-right Ice node
    const brx = cx + r * 0.52;
    const bry = cy + r * 0.52;
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.25 * Math.SQRT1_2, cy + r * 0.25 * Math.SQRT1_2);
    ctx.lineTo(brx, bry);
    ctx.stroke();
    drawMiniIce(ctx, brx, bry, r * 0.20);
  } else if (spellId === 'safety_hover') {
    // Central Light anchor
    drawMiniLight(ctx, cx, cy, r * 0.4);

    // Ice top-right
    const trx = cx + r * 0.55;
    const tryY = cy - r * 0.55;
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.27 * Math.SQRT1_2, cy - r * 0.27 * Math.SQRT1_2);
    ctx.lineTo(trx, tryY);
    ctx.stroke();
    drawMiniIce(ctx, trx, tryY, r * 0.21);

    // Fire bottom-left
    const blex = cx - r * 0.55;
    const bley = cy + r * 0.55;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.27 * Math.SQRT1_2, cy + r * 0.27 * Math.SQRT1_2);
    ctx.lineTo(blex, bley);
    ctx.stroke();
    drawMiniFire(ctx, blex, bley, r * 0.21);
  } else if (spellId === 'petrification') {
    // Double pentagonal central lines mapping connections
    ctx.save();
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 3]);
    const starPts: { x: number; y: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const ang = (Math.PI * 2 * i) / 5 - Math.PI / 2;
      starPts.push({
        x: cx + r * 0.52 * Math.cos(ang),
        y: cy + r * 0.52 * Math.sin(ang),
      });
    }
    ctx.beginPath();
    ctx.moveTo(starPts[0].x, starPts[0].y);
    ctx.lineTo(starPts[2].x, starPts[2].y);
    ctx.lineTo(starPts[4].x, starPts[4].y);
    ctx.lineTo(starPts[1].x, starPts[1].y);
    ctx.lineTo(starPts[3].x, starPts[3].y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // 3 Ice nodes at: top (0), bottom-right (2), bottom-left (3)
    drawMiniIce(ctx, starPts[0].x, starPts[0].y, r * 0.17);
    drawMiniIce(ctx, starPts[2].x, starPts[2].y, r * 0.17);
    drawMiniIce(ctx, starPts[3].x, starPts[3].y, r * 0.17);

    // 2 Plant nodes at: mid-right (1), mid-left (4)
    drawMiniPlant(ctx, starPts[1].x, starPts[1].y, r * 0.17);
    drawMiniPlant(ctx, starPts[4].x, starPts[4].y, r * 0.17);
  } else if (spellId === 'monster_arm') {
    // 45-degree rotated diamond inner grid
    const sqPts = [
      { x: cx, y: cy - r * 0.52 },
      { x: cx + r * 0.52, y: cy },
      { x: cx, y: cy + r * 0.52 },
      { x: cx - r * 0.52, y: cy },
    ];
    ctx.beginPath();
    ctx.moveTo(sqPts[0].x, sqPts[0].y);
    sqPts.forEach((pt) => ctx.lineTo(pt.x, pt.y));
    ctx.closePath();
    ctx.stroke();

    // Diagonal crossing stems
    ctx.beginPath();
    ctx.moveTo(sqPts[0].x, sqPts[0].y);
    ctx.lineTo(sqPts[2].x, sqPts[2].y);
    ctx.moveTo(sqPts[1].x, sqPts[1].y);
    ctx.lineTo(sqPts[3].x, sqPts[3].y);
    ctx.stroke();

    // 2 Plant nodes (top, bottom) & 2 Fire nodes (right, left)
    drawMiniPlant(ctx, sqPts[0].x, sqPts[0].y, r * 0.18);
    drawMiniPlant(ctx, sqPts[2].x, sqPts[2].y, r * 0.18);
    drawMiniFire(ctx, sqPts[1].x, sqPts[1].y, r * 0.18);
    drawMiniFire(ctx, sqPts[3].x, sqPts[3].y, r * 0.18);
  } else if (spellId === 'teleportation') {
    // Complex concentric parent-child orbit
    drawMiniFire(ctx, cx, cy, r * 0.35);

    // Alignment alignment rays
    ctx.save();
    ctx.lineWidth = 0.8;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.9, cy);
    ctx.lineTo(cx + r * 0.9, cy);
    ctx.moveTo(cx, cy - r * 0.9);
    ctx.lineTo(cx, cy + r * 0.9);
    ctx.stroke();
    ctx.restore();

    // 4 satellite interlocking matrix nodes
    const satLocs = [
      { x: cx, y: cy - r * 0.62, type: 'light' },
      { x: cx + r * 0.62, y: cy, type: 'ice' },
      { x: cx, y: cy + r * 0.62, type: 'plant' },
      { x: cx - r * 0.62, y: cy, type: 'fire' },
    ];
    satLocs.forEach((sat) => {
      ctx.beginPath();
      ctx.arc(sat.x, sat.y, r * 0.16, 0, Math.PI * 2);
      ctx.stroke();

      if (sat.type === 'light') drawMiniLight(ctx, sat.x, sat.y, r * 0.15);
      else if (sat.type === 'ice') drawMiniIce(ctx, sat.x, sat.y, r * 0.15);
      else if (sat.type === 'plant') drawMiniPlant(ctx, sat.x, sat.y, r * 0.15);
      else if (sat.type === 'fire') drawMiniFire(ctx, sat.x, sat.y, r * 0.15);
    });
  }

  ctx.restore();
}

export default function MagicCanvas({
  currentSpell,
  practiceMode,
  onSpellRecognized,
  onFizzle,
  isMuted,
}: MagicCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<Point[]>([]);
  const [completedStrokes, setCompletedStrokes] = useState<Stroke[]>([]);
  const [isCastingTrans, setIsCastingTrans] = useState(false);

  // Entities & Particle Simulation memory
  const entitiesRef = useRef<AmbientEntity[]>([]);
  const particlesRef = useRef<MagicParticle[]>([]);
  const animationFrameRef = useRef<number | null>(null);

  // Interactive Dragging of Elements
  const dragEntityIdRef = useRef<string | null>(null);
  const lastMousePosRef = useRef<Point>({ x: 0, y: 0 });
  // Device pixel ratio for Hi-DPI backing stores; capped at resize time to
  // protect fill-rate on low-end phones. Read every frame by the RAF loop.
  const dprRef = useRef(1);

  // Invisibility duration / breath meter
  const [breathMeter, setBreathMeter] = useState(100);
  const isInvisActiveRef = useRef(false);
  const [isInvisActive, setIsInvisActive] = useState(false);

  // Render-loop mirrors: the RAF effect mounts once and reads these refs,
  // so per-pointer-move state churn never tears down/rebuilds the simulation loop.
  const strokesRenderRef = useRef<{ completed: Stroke[]; current: Point[] }>({ completed: [], current: [] });
  const currentSpellRef = useRef<Spell | null>(currentSpell);
  const practiceModeRef = useRef(practiceMode);
  const castingTransRef = useRef(false);
  const isInvisSyncedRef = useRef(false);


  // Setup/Sync Synth mute
  useEffect(() => {
    mystSynth.setMute(isMuted);
  }, [isMuted]);

  // Adjust canvas bounds on screen change
  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;

      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      // Hi-DPI: back the canvas with device pixels while CSS classes keep its
      // layout size at 100%. Capped at 2x; beyond that, phone GPUs pay more
      // fill-rate than this particle simulation can afford.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      dprRef.current = dpr;
    };

    handleResize();
    const observer = new ResizeObserver(handleResize);
    if (containerRef.current) observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    strokesRenderRef.current = { completed: completedStrokes, current: currentStroke };
  }, [completedStrokes, currentStroke]);

  useEffect(() => {
    currentSpellRef.current = currentSpell;
    practiceModeRef.current = practiceMode;
  }, [currentSpell, practiceMode]);

  // Seed teleport portals when the teleportation spell is active
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Dynamic Seed portals (ONLY if teleportation spell is active, otherwise remove from current entities to fix top-left bug)
    if (currentSpell?.id === 'teleportation') {
      const existingPortals = entitiesRef.current.filter((e) => e.type === 'portal');
      if (existingPortals.length === 0 && canvas.width > 0) {
        entitiesRef.current.push({
          id: 'portal-a',
          type: 'portal',
          x: canvas.width * 0.3,
          y: canvas.height * 0.5,
          size: 55,
          color: '#FD79A8',
          customData: { portalTarget: 'portal-b', angle: 0 },
        });
        entitiesRef.current.push({
          id: 'portal-b',
          type: 'portal',
          x: canvas.width * 0.7,
          y: canvas.height * 0.5,
          size: 55,
          color: '#74B9FF',
          customData: { portalTarget: 'portal-a', angle: 0 },
        });
      }
    } else {
      // If we are tracing or sandbox-acting any other spell, remove standard portals
      if (practiceMode) {
        entitiesRef.current = entitiesRef.current.filter((e) => e.type !== 'portal');
      }
    }
  }, [currentSpell, practiceMode]);

  // Main high-performance simulation Loop (60FPS Physics, collisions, rendering)
  useEffect(() => {
    const updateAndDraw = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        animationFrameRef.current = requestAnimationFrame(updateAndDraw);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Logical (CSS-pixel) drawing surface. The backing store is dpr-scaled
      // (see resize handler); every simulation and draw calculation below
      // stays in CSS-pixel space, matching pointer coordinates.
      const w = Math.round(canvas.width / dprRef.current);
      const h = Math.round(canvas.height / dprRef.current);

      // Sync invisibility state ONLY when the ref actually changed (was previously every frame)
      if (isInvisActiveRef.current !== isInvisSyncedRef.current) {
        isInvisSyncedRef.current = isInvisActiveRef.current;
        setIsInvisActive(isInvisActiveRef.current);
      }

      // --- Wind & Mist Force Factors ---
      const activeVortex = entitiesRef.current.find((e) => e.type === 'light_sphere' && e.customData?.isVortex);
      const isSleepMistActive = particlesRef.current.some((p) => p.type === 'mist');
      const isSafetyHoverActive = entitiesRef.current.some((e) => e.customData?.isGravityBubble);

      // --- 1. Draw Background: Witch's Ancient Astronomical Circle ---
      ctx.fillStyle = '#160E1D'; // Rich deep mulberry obsidian
      ctx.fillRect(0, 0, w, h);

      // Anchor the DPR scale ONCE per frame, right after the background fill:
      // the fill must use the identity transform (it addresses raw backing
      // pixels), while everything drawn afterwards works in CSS-pixel space.
      // setTransform survives every ctx.save()/restore() pair in the draw code.
      const dpr = dprRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Draw faint magical geometric alignment guidelines
      ctx.strokeStyle = 'rgba(217, 119, 6, 0.08)'; // Warm gold/bronze
      ctx.lineWidth = 1.5;
      const minDim = Math.min(w, h);

      ctx.beginPath();
      ctx.arc(w / 2, h / 2, minDim * 0.44, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(w / 2, h / 2, minDim * 0.41, 0, Math.PI * 2);
      ctx.stroke();

      ctx.save();
      ctx.translate(w / 2, h / 2);
      // Celestial star coordinate rays
      for (let ray = 0; ray < 8; ray++) {
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.moveTo(0, minDim * 0.08);
        ctx.lineTo(0, minDim * 0.41);
        ctx.stroke();
      }
      ctx.restore();

      // Cosmic background stars
      ctx.fillStyle = 'rgba(251, 191, 36, 0.25)';
      const starCoords = [
        { x: w * 0.08, y: h * 0.12 },
        { x: w * 0.92, y: h * 0.15 },
        { x: w * 0.14, y: h * 0.84 },
        { x: w * 0.86, y: h * 0.82 },
        { x: w * 0.05, y: h * 0.48 },
        { x: w * 0.95, y: h * 0.52 }
      ];
      starCoords.forEach((star) => {
        ctx.beginPath();
        ctx.arc(star.x, star.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      });

      // --- 2. Draw Gorgeous High-Fidelity Guide Outline ---
      const spellForGuide = currentSpellRef.current;
      if (spellForGuide && practiceModeRef.current && w > 0) {
        const cx = w / 2;
        const cy = h / 2;
        const r = Math.min(w, h) * 0.38;

        drawHighFidelityGlyphBlueprint(ctx, cx, cy, r, spellForGuide.id, spellForGuide.color);
      }

      // --- 3. Update & Draw Ambient Entities (Vines, Ice Pillars, Magic Stars) ---
      const nextEntities: AmbientEntity[] = [];

      entitiesRef.current.forEach((ent) => {
        let keep = true;

        // In visibility/refraction lens distortion handler
        const isPetrified = ent.customData?.isStone;

        // Entity type operations
        switch (ent.type) {
          case 'light_sphere': {
            // Expanding activation shockwave rings ride the light_sphere type (mirrors isArm pattern)

            // Natural drifting float
            if (!ent.customData?.isDragged) {
              const driftY = isSafetyHoverActive ? -0.2 : (ent.vy ?? -0.4);
              ent.y += driftY;
              ent.x += ent.vx ?? 0;
              // Gentle wave
              ent.x += Math.sin(Date.now() * 0.003 + ent.size) * 0.15;

              // Bound bounce
              if (ent.x - ent.size < 0 || ent.x + ent.size > w) {
                ent.vx = -(ent.vx ?? 0);
              }
              if (ent.y - ent.size < 0) {
                ent.y = h + ent.size; // wrap to bottom
              }
            }

            // Wind Force reaction
            if (activeVortex && !ent.customData?.isDragged && !ent.customData?.isVortex) {
              const dx = activeVortex.x - ent.x;
              const dy = activeVortex.y - ent.y;
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d < 350) {
                // Circular pull
                ent.vx = (ent.vx ?? 0) * 0.9 + (dy / d) * 1.5 + (dx / d) * 0.8;
                ent.vy = (ent.vy ?? 0) * 0.9 - (dx / d) * 1.5 + (dy / d) * 0.8;
              }
            }

            // Subtle breathing pulse
            const lightPulse = 1 + 0.06 * Math.sin(Date.now() * 0.004 + ent.x * 0.01);

            // Draw glowing orbit sphere
            const radG = ctx.createRadialGradient(ent.x, ent.y, 2, ent.x, ent.y, ent.size * lightPulse);
            radG.addColorStop(0, '#FFFFFF');
            radG.addColorStop(0.3, ent.color);
            radG.addColorStop(1, 'rgba(254, 211, 48, 0)');

            ctx.fillStyle = radG;
            ctx.beginPath();
            ctx.arc(ent.x, ent.y, ent.size * lightPulse, 0, Math.PI * 2);
            ctx.fill();

            // Four-point star glints: two thin crossing lines rotating slowly
            ctx.save();
            ctx.translate(ent.x, ent.y);
            ctx.rotate(Date.now() * 0.0004);
            const glintLen = ent.size * lightPulse * 1.35;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 1;
            for (let glint = 0; glint < 2; glint++) {
              ctx.beginPath();
              ctx.moveTo(-glintLen, 0);
              ctx.lineTo(glintLen, 0);
              ctx.stroke();
              ctx.rotate(Math.PI / 2);
            }
            ctx.restore();

            // Spawn ambient sparkling stars
            if (Math.random() < 0.08) {
              particlesRef.current.push({
                id: Math.random().toString(),
                x: ent.x + (Math.random() * 20 - 10),
                y: ent.y + (Math.random() * 20 - 10),
                vx: Math.random() * 0.6 - 0.3,
                vy: Math.random() * -0.5,
                size: Math.random() * 3 + 1,
                color: ent.color,
                alpha: 1,
                life: 0,
                maxLife: 40 + Math.random() * 30,
                type: 'sparkle',
              });
            }

            // Gorgeous high-fidelity procedural wind funnel (tornado) with multiple swirling layers
            if (ent.customData?.isVortex) {
              const ringCount = 15;
              const maxRadius = ent.size * 1.5;
              const tornadoHeight = 380;
              const time = Date.now() * 0.0035;

              ctx.save();
              
              // Draw swirling back-half layers first to create an immersive 3D overlap effect
              for (let i = ringCount - 1; i >= 0; i--) {
                const progress = i / (ringCount - 1); // bottom to top (0.0 to 1.0)
                const ringY = ent.y - progress * tornadoHeight;
                
                // Classic tapering tornado funnel shape (wider at the top, pinching near ground anchor)
                const shapeFactor = 0.25 + Math.pow(progress, 1.4) * 0.95;
                const rx = maxRadius * shapeFactor;
                const ry = rx * 0.26; // flattened elliptical 3D perspective

                // Dynamic breathing/bellowing pulse (blowing in and out!)
                const pulse = 1.0 + Math.sin(time * 0.8 + progress * Math.PI * 1.5) * 0.14;
                const finalRx = rx * pulse;
                const finalRy = ry * pulse;

                // Swirl angle speed
                const swirlAngle = time * 1.8 + progress * Math.PI;

                ctx.lineWidth = 1.2 + (1 - progress) * 3.5;
                
                // Layer 1: Cool cyan glowing wind currents
                ctx.strokeStyle = `rgba(129, 236, 236, ${0.08 + progress * 0.35})`;
                ctx.shadowColor = '#81ECEC';
                ctx.shadowBlur = 4;
                ctx.beginPath();
                ctx.ellipse(ent.x, ringY, finalRx, finalRy, swirlAngle, 0, Math.PI * 1.1);
                ctx.stroke();

                // Layer 2: White whipping speed-streaks (offset angle)
                ctx.strokeStyle = `rgba(255, 255, 255, ${0.05 + progress * 0.25})`;
                ctx.shadowBlur = 0;
                ctx.beginPath();
                ctx.ellipse(ent.x, ringY, finalRx * 0.88, finalRy * 0.88, swirlAngle + Math.PI * 0.8, 0, Math.PI * 0.9);
                ctx.stroke();

                // Layer 3: Extra high-frequency whipping wisps
                if (i % 3 === 0) {
                  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                  ctx.lineWidth = 0.8;
                  ctx.beginPath();
                  ctx.ellipse(ent.x, ringY, finalRx * 1.04, finalRy * 1.04, -swirlAngle * 0.5, 0, Math.PI * 0.4);
                  ctx.stroke();
                }
              }

              // Draw central vertical energy spire vacuum
              const spireG = ctx.createLinearGradient(ent.x, ent.y - tornadoHeight, ent.x, ent.y);
              spireG.addColorStop(0, 'rgba(129, 236, 236, 0.4)');
              spireG.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)');
              spireG.addColorStop(0.9, 'rgba(129, 236, 236, 0.5)');
              spireG.addColorStop(1, 'rgba(0, 206, 201, 0)');

              ctx.fillStyle = spireG;
              ctx.beginPath();
              ctx.moveTo(ent.x - 4, ent.y);
              ctx.quadraticCurveTo(ent.x - maxRadius * 0.2, ent.y - tornadoHeight * 0.5, ent.x - maxRadius * 0.6, ent.y - tornadoHeight);
              ctx.lineTo(ent.x + maxRadius * 0.6, ent.y - tornadoHeight);
              ctx.quadraticCurveTo(ent.x + maxRadius * 0.2, ent.y - tornadoHeight * 0.5, ent.x + 4, ent.y);
              ctx.closePath();
              ctx.fill();

              ctx.restore();
            }
            break;
          }

          case 'ice_pillar': {
            // Spring-damped growth with an 8% overshoot past target before settling.
            // Guard the bag: ice pillars are always spawned with { height: 0 }, but a
            // malformed entity must never be able to throw inside the RAF loop.
            if (!ent.customData) ent.customData = { height: 0, velocity: 0 };
            if (!ent.customData.settled) {
              const targetH = ent.size;
              const overshootTarget = targetH * 1.08;
              const vel = (ent.customData.velocity ?? 0) + 2.5;
              ent.customData.height += vel;
              ent.customData.velocity = vel;
              if (ent.customData.height >= overshootTarget) {
                ent.customData.settled = true;
              }
            } else {
              const targetH = ent.size;
              const displacement = ent.customData.height - targetH;
              const springVel = ((ent.customData.velocity ?? 0) - displacement * 0.12) * 0.82;
              ent.customData.velocity = springVel;
              ent.customData.height += springVel;
              if (Math.abs(displacement) < 0.5 && Math.abs(springVel) < 0.5) {
                ent.customData.height = targetH;
                ent.customData.velocity = 0;
              }
            }
            // Drawing jagged crystalline geometries
            ctx.fillStyle = isPetrified ? '#636E72' : ent.color;
            ctx.strokeStyle = isPetrified ? '#2D3436' : '#EBF8FF';
            ctx.lineWidth = 1.5;

            ctx.beginPath();
            const leftX = ent.x - 25;
            const rightX = ent.x + 25;
            const topY = ent.y - ent.customData.height;

            ctx.moveTo(ent.x, ent.y);
            ctx.lineTo(leftX, ent.y);
            ctx.lineTo(leftX + 4, ent.y - ent.customData.height * 0.3);
            ctx.lineTo(ent.x - 10, ent.y - ent.customData.height * 0.7);
            ctx.lineTo(ent.x, topY); // top apex
            ctx.lineTo(ent.x + 12, ent.y - ent.customData.height * 0.6);
            ctx.lineTo(rightX, ent.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Facet line highlights
            ctx.beginPath();
            ctx.moveTo(ent.x - 10, ent.y - ent.customData.height * 0.7);
            ctx.lineTo(ent.x + 12, ent.y - ent.customData.height * 0.6);
            ctx.stroke();

            // Little frost dust flakes
            if (Math.random() < 0.05 && ent.customData.height >= ent.size) {
              particlesRef.current.push({
                id: Math.random().toString(),
                x: ent.x + (Math.random() * 40 - 20),
                y: topY + (Math.random() * 15),
                vx: Math.random() * 0.4 - 0.2,
                vy: Math.random() * 0.3,
                size: Math.random() * 2 + 1,
                color: '#DFF9FB',
                alpha: 0.8,
                life: 0,
                maxLife: 50,
                type: 'frost',
              });
            }
            break;
          }

          case 'plant_vine': {
            if (ent.customData?.isArm) {
              break;
            }
            // Update botanical joints (procedural organic growth animation)
            const joints = ent.customData?.joints as Point[];
            if (!joints) break;
            const maxLength = ent.size;

            if (joints.length < maxLength && !isPetrified) {
              const lastJoint = joints[joints.length - 1];
              // Grow climbing branches upward with sine waves
              const angleOffset = Math.sin(joints.length * 0.6 + Date.now() * 0.004) * 0.25;
              const growAngle = -Math.PI / 2 + angleOffset;
              // Ease-out: growth steps shrink as the vine approaches full length
              const nextLen = 14 - (joints.length / maxLength) * 8; 
              const nextPt: Point = {
                x: lastJoint.x + Math.cos(growAngle) * nextLen,
                y: lastJoint.y + Math.sin(growAngle) * nextLen,
              };
              joints.push(nextPt);
              
              // Seed green leaves
              if (Math.random() < 0.35) {
                particlesRef.current.push({
                  id: Math.random().toString(),
                  x: nextPt.x,
                  y: nextPt.y,
                  vx: Math.random() * 0.4 - 0.2,
                  vy: -0.1,
                  size: Math.random() * 6 + 4,
                  color: ent.color,
                  alpha: 1,
                  life: 0,
                  maxLife: 200,
                  type: 'leaf',
                  customData: { angle: Math.random() * Math.PI },
                });
              }
            }

            // Render joint-by-joint vine branches
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = isPetrified ? '#636E72' : ent.color;
            ctx.lineWidth = 7;

            ctx.beginPath();
            joints.forEach((pt, jIdx) => {
              if (jIdx === 0) ctx.moveTo(pt.x, pt.y);
              else ctx.lineTo(pt.x, pt.y);
            });
            ctx.stroke();

            // Inner bark tube line
            ctx.strokeStyle = isPetrified ? '#2D3436' : '#2D3436';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Draw little blossoming flowers at tip node
            if (joints.length >= 8) {
              const tip = joints[joints.length - 1];
              ctx.fillStyle = isPetrified ? '#2D3436' : '#FD79A8';
              ctx.beginPath();
              ctx.arc(tip.x, tip.y, 6, 0, Math.PI * 2);
              ctx.fill();

              // Flower petals
              for (let petal = 0; petal < 5; petal++) {
                const angle = (petal / 5) * Math.PI * 2 + (Date.now() * 0.001);
                ctx.fillStyle = isPetrified ? '#636E72' : '#FF7675';
                ctx.beginPath();
                ctx.arc(tip.x + Math.cos(angle) * 7, tip.y + Math.sin(angle) * 7, 3.5, 0, Math.PI * 2);
                ctx.fill();
              }
            }
            break;
          }

          case 'fireball': {
            // Fast launching balls
            // Muzzle-flash sparks burst at the moment of launch
            if ((ent.life ?? 0) === 0) {
              for (let flash = 0; flash < 8; flash++) {
                const flashAngle = Math.random() * Math.PI * 2;
                const flashSpeed = Math.random() * 2.5 + 0.8;
                particlesRef.current.push({
                  id: Math.random().toString(),
                  x: ent.x,
                  y: ent.y,
                  vx: Math.cos(flashAngle) * flashSpeed,
                  vy: Math.sin(flashAngle) * flashSpeed,
                  size: Math.random() * 3 + 1.5,
                  color: '#FFEAA7',
                  alpha: 1,
                  life: 0,
                  maxLife: 14 + Math.random() * 10,
                  type: 'spark',
                });
              }
            }
            ent.x += ent.vx ?? 4;
            ent.y += ent.vy ?? -2;

            // Simple gravity/slow
            if (isSleepMistActive) {
              ent.x -= (ent.vx ?? 4) * 0.4;
              ent.y -= (ent.vy ?? -2) * 0.4;
            }

            // Boundary collision
            if (ent.x - ent.size < 0 || ent.x + ent.size > w) {
              ent.vx = -(ent.vx ?? 4) * 0.9;
              mystSynth.playDrawingHum(300); // trigger dynamic pitch hum on collision
            }
            if (ent.y - ent.size < 0 || ent.y + ent.size > h) {
              ent.vy = -(ent.vy ?? -2) * 0.9;
            }

            // Render highly stylized real fire shape with procedural curves and cometary tails
            ctx.save();
            ctx.translate(ent.x, ent.y);

            // Rotate the fireball to align with its velocity vector
            const vx = ent.vx ?? 4;
            const vy = ent.vy ?? -2;
            const angle = Math.atan2(vy, vx);
            ctx.rotate(angle + Math.PI); // face away from movement direction to show trailing fire

            const size = ent.size;
            const time = Date.now() * 0.015;

            ctx.shadowBlur = size * 1.5;
            ctx.shadowColor = '#FF3E3E';

            // Outer roaring plasma trail shell
            const outerG = ctx.createRadialGradient(0, 0, 1, 0, 0, size * 1.8);
            outerG.addColorStop(0, 'rgba(255, 118, 117, 1)');
            outerG.addColorStop(0.4, 'rgba(235, 94, 40, 0.95)');
            outerG.addColorStop(0.7, 'rgba(214, 48, 49, 0.8)');
            outerG.addColorStop(1, 'rgba(214, 48, 49, 0)');

            ctx.fillStyle = outerG;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            
            // Draw a gorgeous fluid flame tail stretching behind the movement
            ctx.bezierCurveTo(size, size * 1.1, size * 2.5, size * 1.2 + Math.sin(time) * 4, size * 3.2, 0); // Upper tail wisp
            ctx.bezierCurveTo(size * 2.5, -size * 1.2 + Math.cos(time) * 4, size, -size * 1.1, 0, 0); // Lower tail wisp
            ctx.arc(0, 0, size, Math.PI / 2, -Math.PI / 2, true); // Round head
            ctx.fill();

            // Inner molten white-hot energy core
            const innerG = ctx.createRadialGradient(-size * 0.15, 0, 1, -size * 0.15, 0, size * 0.95);
            innerG.addColorStop(0, '#FFFFFF');
            innerG.addColorStop(0.35, '#FFEAA7');
            innerG.addColorStop(0.7, 'rgba(253, 203, 110, 0.5)');
            innerG.addColorStop(1, 'rgba(253, 203, 110, 0)');
            
            ctx.fillStyle = innerG;
            ctx.beginPath();
            ctx.arc(-size * 0.15, 0, size * 0.8, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();

            // Spawn smoke and flame tail trails
            particlesRef.current.push({
              id: Math.random().toString(),
              x: ent.x,
              y: ent.y,
              vx: (Math.random() - 0.5) * 1.5,
              vy: (Math.random() - 0.5) * 1.5,
              size: Math.random() * 8 + 4,
              color: ent.color,
              alpha: 0.9,
              life: 0,
              maxLife: 25 + Math.random() * 15,
              type: 'flame',
            });

            // Spark combustion life decay timer
            ent.life = (ent.life ?? 0) + 1;
            if (ent.life > (ent.maxLife ?? 180)) {
              keep = false;
              // Explode on expiration
              mystSynth.playFireExplosion();
              for (let exp = 0; exp < 18; exp++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = Math.random() * 3 + 1;
                particlesRef.current.push({
                  id: Math.random().toString(),
                  x: ent.x,
                  y: ent.y,
                  vx: Math.cos(angle) * speed,
                  vy: Math.sin(angle) * speed,
                  size: Math.random() * 6 + 2,
                  color: '#FF7675',
                  alpha: 1,
                  life: 0,
                  maxLife: 30 + Math.random() * 20,
                  type: 'spark',
                });
              }
            }
            break;
          }

          case 'portal': {
            // Keep persistent. Animate spatial rotation
            const custom = ent.customData;
            custom.angle += 0.045;
            // Organic wobble: gentle vertical squash/stretch oscillation
            const squashY = 1 + Math.sin(Date.now() * 0.0021) * 0.04;

            // Apply the wobble inside a save/restore so the transform never
            // leaks into subsequent entity drawing or the next frame.
            ctx.save();
            ctx.translate(ent.x, ent.y);
            ctx.scale(1, squashY);
            ctx.translate(-ent.x, -ent.y);

            // 1. Swirling dimensional distortion shadow
            ctx.shadowColor = ent.color;
            ctx.shadowBlur = 18;
            
            // Draw a spinning outer portal frame
            const pulse = 1.0 + Math.sin(Date.now() * 0.003) * 0.05;
            const size = ent.size * pulse;

            // Gradient line border
            const lineGrad = ctx.createLinearGradient(ent.x - size, ent.y - size, ent.x + size, ent.y + size);
            lineGrad.addColorStop(0, ent.color);
            lineGrad.addColorStop(0.5, '#FFF');
            lineGrad.addColorStop(1, '#9B59B6'); // purple wisp overlay
            ctx.strokeStyle = lineGrad;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(ent.x, ent.y, size, 0, Math.PI * 2);
            ctx.stroke();

            // 2. Translucent vortex deep background
            const radialPortal = ctx.createRadialGradient(ent.x, ent.y, 2, ent.x, ent.y, size);
            radialPortal.addColorStop(0, 'rgba(10, 10, 15, 0.98)');
            radialPortal.addColorStop(0.5, 'rgba(44, 44, 84, 0.92)');
            radialPortal.addColorStop(0.85, 'rgba(129, 236, 236, 0.45)');
            radialPortal.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = radialPortal;
            ctx.beginPath();
            ctx.arc(ent.x, ent.y, size * 0.98, 0, Math.PI * 2);
            ctx.fill();

            // 3. Mathematical vortex spiral streaks (resembling a real spacetime warp shader)
            ctx.shadowBlur = 0;
            ctx.lineWidth = 1.5;
            const spiralSlices = 62;
            const loops = 1.6;
            ctx.beginPath();
            for (let i = 0; i < spiralSlices; i++) {
              const t = i / (spiralSlices - 1);
              const r = t * size * 0.92;
              const a = t * Math.PI * 2 * loops + custom.angle * 2;
              const px = ent.x + Math.cos(a) * r;
              const py = ent.y + Math.sin(a) * r;
              
              // Fade color closer to center
              ctx.strokeStyle = `rgba(129, 236, 236, ${t * 0.6})`;
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.stroke();

            // 4. Secondary reversing spiral wisp (offset phase and purple tint)
            ctx.beginPath();
            for (let i = 0; i < spiralSlices; i++) {
              const t = i / (spiralSlices - 1);
              const r = t * size * 0.92;
              const a = t * Math.PI * 2 * loops - custom.angle * 2.5 + Math.PI;
              const px = ent.x + Math.cos(a) * r;
              const py = ent.y + Math.sin(a) * r;
              
              ctx.strokeStyle = `rgba(155, 89, 182, ${t * 0.5})`;
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.stroke();

            // Draw swirly portal outer notches
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 2.5;
            for (let Notch = 0; Notch < 5; Notch++) {
              const ringAngle = custom.angle + (Notch / 5) * Math.PI * 2;
              ctx.beginPath();
              ctx.arc(ent.x, ent.y, size + 2, ringAngle, ringAngle + 0.3);
              ctx.stroke();
            }
            // Spawn portal vacuum dust particles
            if (Math.random() < 0.12) {
              const vacuumAngle = Math.random() * Math.PI * 2;
              const spawnDist = ent.size + 15;
              particlesRef.current.push({
                id: Math.random().toString(),
                x: ent.x + Math.cos(vacuumAngle) * spawnDist,
                y: ent.y + Math.sin(vacuumAngle) * spawnDist,
                // Vacuum pull velocity towards portal center
                vx: -Math.cos(vacuumAngle) * 0.8,
                vy: -Math.sin(vacuumAngle) * 0.8,
                size: Math.random() * 2 + 1,
                color: ent.color,
                alpha: 0.8,
                life: 0,
                maxLife: 20,
                type: 'portal_dust',
              });
            }
            ctx.restore();
            break;
          }
        }


        // Element-On-Element Intersections Reactions (Fire melting Ice, Burning Plant Vines)
        if (ent.type === 'fireball') {
          entitiesRef.current.forEach((targetEnt) => {
            if (targetEnt.type === 'ice_pillar') {
              const dx = targetEnt.x - ent.x;
              const dy = targetEnt.y - ent.y;
              const elementDist = Math.sqrt(dx * dx + dy * dy);
              if (elementDist < ent.size + 25) {
                // Melt Ice: shorten height
                if (targetEnt.customData.height > 10) {
                  targetEnt.customData.height -= 12; // melt block
                  // Trigger steam particles
                  for (let steamIdx = 0; steamIdx < 3; steamIdx++) {
                    particlesRef.current.push({
                      id: Math.random().toString(),
                      x: targetEnt.x,
                      y: targetEnt.y - targetEnt.customData.height,
                      vx: Math.random() * 0.8 - 0.4,
                      vy: -Math.random() * 1.5,
                      size: Math.random() * 12 + 6,
                      color: '#ECEFF1',
                      alpha: 0.5,
                      life: 0,
                      maxLife: 60,
                      type: 'smoke',
                    });
                  }
                  mystSynth.playIceSprout(); // crack crunch sound
                } else {
                  targetEnt.customData.height = 0;
                }
              }
            }

            if (targetEnt.type === 'plant_vine') {
              // Compare joints coordinates of plants
              const joints = targetEnt.customData?.joints as Point[];
              if (joints) {
                joints.forEach((joint, jIdx) => {
                  const dx = joint.x - ent.x;
                  const dy = joint.y - ent.y;
                  const vineDist = Math.sqrt(dx * dx + dy * dy);
                  if (vineDist < ent.size + 15) {
                    // Fire consumes vine. Shrink vine segments from tip
                    if (joints.length > 2) {
                      joints.length = Math.max(2, joints.length - 2);
                      // Spawn charcoal fire dust
                      particlesRef.current.push({
                        id: Math.random().toString(),
                        x: joint.x,
                        y: joint.y,
                        vx: (Math.random() - 0.5) * 1.5,
                        vy: (Math.random() - 0.5) * 1.5,
                        size: Math.random() * 5 + 2,
                        color: '#E07A5F',
                        alpha: 0.9,
                        life: 0,
                        maxLife: 30,
                        type: 'flame',
                      });
                    }
                  }
                });
              }
            }
          });
        }

        if (keep) {
          nextEntities.push(ent);
        }
      });

      entitiesRef.current = nextEntities;

      // --- 4. Master-Level "Monster Arm" (Procedural abomination arm using Inverse Kinematics or target follow) ---
      const hasMonsterSpell = entitiesRef.current.some((e) => e.customData?.isArm);
      if (hasMonsterSpell) {
        // Find or create Monster Arm segments
        const armColor = '#2F3542'; // Dark purplish abomination clay
        const targetX = lastMousePosRef.current.x;
        const targetY = lastMousePosRef.current.y;

        // Anchor at bottom-left corner
        const anchorX = w * 0.15;
        const anchorY = h;

        // Segment joints calculation (smoothed spring interpolation)
        let armJoints: Point[] = [];
        const existingArm = entitiesRef.current.find((e) => e.customData?.isArm);
        if (existingArm && existingArm.customData.armJoints) {
          armJoints = existingArm.customData.armJoints;
        } else {
          // Initialize joints points
          for (let seg = 0; seg < 6; seg++) {
            armJoints.push({ x: anchorX, y: anchorY - seg * 40 });
          }
          if (existingArm) existingArm.customData.armJoints = armJoints;
        }

        // Kinematics solver: first segment follows anchor, last follows mouse with elastic tension
        armJoints[0] = { x: anchorX, y: anchorY };
        for (let seg = 1; seg < armJoints.length; seg++) {
          const prev = armJoints[seg - 1];
          const curr = armJoints[seg];

          // Vector pointing forward
          let dx = curr.x - prev.x;
          let dy = curr.y - prev.y;
          let angle = Math.atan2(dy, dx);

          // If last segment, drag towards target cursor
          if (seg === armJoints.length - 1) {
            const dragDx = targetX - curr.x;
            const dragDy = targetY - curr.y;
            // Smoothly move towards mouse with spring scale
            curr.x += dragDx * 0.12;
            curr.y += dragDy * 0.12;
          }

          // Force standard length separation (40px)
          dx = curr.x - prev.x;
          dy = curr.y - prev.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          const limitDist = 42;
          if (length > limitDist) {
            curr.x = prev.x + Math.cos(angle) * limitDist;
            curr.y = prev.y + Math.sin(angle) * limitDist;
          }
        }

        // Render thick abomination branch arm
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = armColor;
        ctx.lineWidth = 32;

        ctx.beginPath();
        armJoints.forEach((j, idx) => {
          if (idx === 0) ctx.moveTo(j.x, j.y);
          else ctx.lineTo(j.x, j.y);
        });
        ctx.stroke();

        // Inner glowing magic core
        ctx.strokeStyle = '#FEA47F';
        ctx.lineWidth = 6;
        ctx.stroke();

        // Claw / Hand grabbing head
        const tipFinger = armJoints[armJoints.length - 1];
        ctx.fillStyle = '#FD9644';
        ctx.beginPath();
        ctx.arc(tipFinger.x, tipFinger.y, 14, 0, Math.PI * 2);
        ctx.fill();

        // Claw teeth
        for (let claw = 0; claw < 3; claw++) {
          const toothAngle = (claw / 3) * Math.PI * 2 + (Date.now() * 0.003);
          ctx.fillStyle = '#D35400';
          ctx.beginPath();
          ctx.moveTo(tipFinger.x + Math.cos(toothAngle) * 12, tipFinger.y + Math.sin(toothAngle) * 12);
          ctx.lineTo(tipFinger.x + Math.cos(toothAngle + 0.5) * 22, tipFinger.y + Math.sin(toothAngle + 0.5) * 22);
          ctx.lineTo(tipFinger.x + Math.cos(toothAngle - 0.2) * 15, tipFinger.y + Math.sin(toothAngle - 0.2) * 15);
          ctx.fill();
        }

        // Claw captures loose floating light particles!
        particlesRef.current.forEach((p) => {
          const dx = p.x - tipFinger.x;
          const dy = p.y - tipFinger.y;
          const clawDist = Math.sqrt(dx * dx + dy * dy);
          if (clawDist < 80) {
            // vacuum snap towards hand claw
            p.vx += -dx * 0.05;
            p.vy += -dy * 0.05;
            if (clawDist < 18) {
              p.life = p.maxLife; // consume / absorb!
              mystSynth.playDrawingHum(440); // play high pitch pop
            }
          }
        });
      }

      // --- 5. Update & Render Particles (Flames, Shards, Leaves, Sleep Mist) ---
      const nextParticles: MagicParticle[] = [];

      particlesRef.current.forEach((part) => {
        // Gravity & Drag constants
        let localGravity = isSafetyHoverActive ? 0.03 : 0.12; 
        let horizontalDrag = 0.99;

        // Apply Sleep Mist slowdowns
        if (isSleepMistActive) {
          horizontalDrag = 0.92;
          localGravity = 0.02;
        }

        part.life++;

        // Wind Vortex attraction: pull and swirl nearby particles inside the active tornado
        if (activeVortex) {
          const dx = activeVortex.x - part.x;
          const dy = activeVortex.y - part.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 360) {
             const pullFactor = (1 - dist / 360) * 0.95;
             // Swirl orbit + collapse pull + vertical updraft drift
             part.vx += (dy / dist) * 1.6 * pullFactor + (dx / dist) * 0.35 * pullFactor;
             part.vy += (-dx / dist) * 1.6 * pullFactor + (dy / dist) * 0.35 * pullFactor - 0.24 * pullFactor;
          }
        }

        if (part.type === 'flame' || part.type === 'smoke') {
          part.x += part.vx;
          part.y += part.vy;
          part.size *= 0.96; // fade size
          part.alpha = 1 - part.life / part.maxLife;
        } else if (part.type === 'spark') {
          part.vy += localGravity; // fall
          part.x += part.vx;
          part.y += part.vy;
          part.alpha = 1 - part.life / part.maxLife;
        } else if (part.type === 'frost') {
          part.vy *= 0.92; // rapid horizontal drag
          part.x += part.vx;
          part.y += part.vy;
          part.alpha = 0.8 * (1 - part.life / part.maxLife);
        } else if (part.type === 'leaf') {
          // Floating leaf: gravity + fluttering air resistance
          part.vy = 0.45;
          part.vx = Math.sin(part.life * 0.04) * 0.6;
          part.x += part.vx;
          part.y += part.vy;

          if (part.y > h - 10) part.y = h - 10; // rest on floor

          part.customData.angle += 0.01;
        } else if (part.type === 'mist') {
          // Purple sleepy gas swirling gently
          part.x += part.vx + Math.sin(Date.now() * 0.0015 + part.size) * 0.3;
          part.y += part.vy + Math.cos(Date.now() * 0.001 - part.size) * 0.2;
          part.alpha = 0.45 * (1 - part.life / part.maxLife);
        } else if (part.type === 'portal_dust' || part.type === 'sparkle') {
          part.x += part.vx;
          part.y += part.vy;
          part.alpha = 1 - part.life / part.maxLife;
        }

        if (part.life < part.maxLife) {
          nextParticles.push(part);
        }

        // Draw particle style
        ctx.save();
        ctx.globalAlpha = part.alpha;

        if (part.type === 'flame') {
          // Flame shape using beautiful layered bezier curves to map out natural flame contours
          ctx.save();
          ctx.translate(part.x, part.y);
          
          // Add a subtle flickering rotate sway based on particle x coord and timer
          const flicker = Math.sin((Date.now() * 0.015) + (part.x * 0.04)) * 0.12;
          ctx.rotate(flicker);

          const s = part.size * 1.6;

          // Double color layer: warm red/orange shell with glowing yellow inner core
          const flameGradient = ctx.createLinearGradient(0, s, 0, -s);
          flameGradient.addColorStop(0, '#D63031'); // Dark crimson base
          flameGradient.addColorStop(0.4, '#FF7675'); // Radiant orange core
          flameGradient.addColorStop(0.85, '#FFEAA7'); // Gold crown
          flameGradient.addColorStop(1, 'rgba(255, 255, 255, 0)'); // Soft tips fade
          
          ctx.beginPath();
          ctx.moveTo(0, s); // starts at base center
          ctx.bezierCurveTo(-s * 0.82, s * 0.95, -s * 1.05, 0, 0, -s * 1.15); // left curvature to tapering tip
          ctx.bezierCurveTo(s * 1.05, 0, s * 0.82, s * 0.95, 0, s); // right curvature back down
          ctx.closePath();
          
          ctx.fillStyle = flameGradient;
          ctx.shadowBlur = s * 1.4;
          ctx.shadowColor = '#D63031';
          ctx.fill();

          // Hot inner core shell
          if (part.size > 2) {
            const innerS = s * 0.45;
            const innerGradient = ctx.createLinearGradient(0, innerS, 0, -innerS);
            innerGradient.addColorStop(0, '#FFEAA7');
            innerGradient.addColorStop(1, 'rgba(255,255,255,0)');
            
            ctx.beginPath();
            ctx.moveTo(0, innerS);
            ctx.bezierCurveTo(-innerS * 0.75, innerS * 0.9, -innerS * 0.95, 0, 0, -innerS * 1.15);
            ctx.bezierCurveTo(innerS * 0.95, 0, innerS * 0.75, innerS * 0.9, 0, innerS);
            ctx.closePath();
            ctx.fillStyle = innerGradient;
            ctx.shadowBlur = 0;
            ctx.fill();
          }

          ctx.restore();
        } else if (part.type === 'smoke') {
          ctx.fillStyle = '#4A4A4A';
          ctx.beginPath();
          ctx.arc(part.x, part.y, part.size * 1.2, 0, Math.PI * 2);
          ctx.fill();
        } else if (part.type === 'spark' || part.type === 'sparkle' || part.type === 'portal_dust') {
          ctx.fillStyle = part.color;
          ctx.fillRect(part.x - part.size / 2, part.y - part.size / 2, part.size, part.size);
        } else if (part.type === 'frost') {
          ctx.fillStyle = part.color;
          ctx.beginPath();
          // Draw diamond ice flakes
          ctx.moveTo(part.x, part.y - part.size);
          ctx.lineTo(part.x + part.size, part.y);
          ctx.lineTo(part.x, part.y + part.size);
          ctx.lineTo(part.x - part.size, part.y);
          ctx.closePath();
          ctx.fill();
        } else if (part.type === 'leaf') {
          ctx.fillStyle = part.color;
          ctx.translate(part.x, part.y);
          ctx.rotate(part.customData?.angle ?? 0);
          ctx.beginPath();
          // leaf oval shape
          ctx.ellipse(0, 0, part.size, part.size / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        } else if (part.type === 'mist') {
          // large gaseous smoke clouds
          const gradient = ctx.createRadialGradient(part.x, part.y, 2, part.x, part.y, part.size);
          gradient.addColorStop(0, 'rgba(162, 155, 254, 0.55)');
          gradient.addColorStop(0.5, 'rgba(108, 92, 231, 0.25)');
          gradient.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(part.x, part.y, part.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });

      particlesRef.current = nextParticles;

      // --- 6. Draw Drawing Strokes (Tapered glow-ink trails) ---
      const strokeInkColor = currentSpellRef.current?.color || '#FFFFFF';
      const strokeInkGlow = currentSpellRef.current?.shadowColor || '#00CEC9';
      const castingBoost = castingTransRef.current ? 2 + Math.sin(Date.now() * 0.03) * 1.5 : 0;

      const allRenderStrokes = [
        ...strokesRenderRef.current.completed,
        ...(strokesRenderRef.current.current.length > 0
          ? [{ id: 'current', points: strokesRenderRef.current.current }]
          : []),
      ];

      // Variable-width polyline: slower movement draws thicker (3px..7px), like real ink
      allRenderStrokes.forEach((str) => {
        if (str.points.length < 2) return;

        ctx.save();
        ctx.shadowColor = strokeInkGlow;
        ctx.shadowBlur = 12;
        ctx.strokeStyle = strokeInkColor;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (let pIdx = 1; pIdx < str.points.length; pIdx++) {
          const pPrev = str.points[pIdx - 1];
          const pCurr = str.points[pIdx];
          const segDist = Math.sqrt((pCurr.x - pPrev.x) ** 2 + (pCurr.y - pPrev.y) ** 2);
          const dt = Math.max(1, (pCurr.t ?? Date.now()) - (pPrev.t ?? Date.now()));
          const speed = segDist / dt; // px per ms
          // Map speed to width: slow strokes (~0.1px/ms) -> 7px, fast (~1.5px/ms) -> 3px
          const speedFactor = Math.min(1, Math.max(0, (1.5 - speed) / 1.4));
          const width = 3 + speedFactor * 4 + castingBoost;
          ctx.lineWidth = width;

          ctx.beginPath();
          ctx.moveTo(pPrev.x, pPrev.y);
          ctx.lineTo(pCurr.x, pCurr.y);
          ctx.stroke();
        }
        ctx.restore();
      });

      // Occasional sparkle trail along the tip of the in-progress stroke
      const liveStrokePoints = strokesRenderRef.current.current;
      if (
        liveStrokePoints.length > 4 &&
        particlesRef.current.length < MAX_PARTICLES &&
        Math.random() < 0.3
      ) {
        const tip = liveStrokePoints[liveStrokePoints.length - 1];
        particlesRef.current.push({
          id: Math.random().toString(),
          x: tip.x + (Math.random() * 8 - 4),
          y: tip.y + (Math.random() * 8 - 4),
          vx: Math.random() * 0.5 - 0.25,
          vy: -Math.random() * 0.4,
          size: Math.random() * 2.5 + 1,
          color: strokeInkColor,
          alpha: 1,
          life: 0,
          maxLife: 18 + Math.random() * 12,
          type: 'sparkle',
        });
      }

      // --- 7. Optical Lens bending/refraction (Invisibility overlay) ---
      if (isInvisActiveRef.current) {
        // Draw dramatic refraction rings focused at center screen
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, Math.max(0, Math.min(w, h) * 0.25 + Math.sin(Date.now() * 0.003) * 15), 0, Math.PI * 2);
        ctx.stroke();

        // Draw refractive glass overlay tint
        ctx.fillStyle = 'rgba(223, 230, 233, 0.04)';
        ctx.fillRect(0, 0, w, h);
      }

      animationFrameRef.current = requestAnimationFrame(updateAndDraw);
    };

    updateAndDraw();

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  // Handle ticking the Invisibility breath gauge
  useEffect(() => {
    let breathTimer: NodeJS.Timeout;
    if (isInvisActive) {
      breathTimer = setInterval(() => {
        setBreathMeter((prev) => {
          if (prev <= 1.5) {
            // Breath ran out! Break Invisibility
            isInvisActiveRef.current = false;
            setIsInvisActive(false);
            mystSynth.playFizzle();
            return 100;
          }
          return prev - 1.5;
        });
      }, 100);
    } else {
      setBreathMeter(100);
    }
    return () => clearInterval(breathTimer);
  }, [isInvisActive]);

  // --- 8. Somatic Spell Trigger Activation Parser (Ast Ast compiling) ---
  const activateTriggerSpell = (
    recognizedType: ElementType,
    accuracyOverride?: number,
    scores?: Record<string, number>,
    options?: { notify?: boolean },
    strokes?: Stroke[]
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Centroid of drawn geometry becomes magic origin point.
    // Strokes are passed explicitly to avoid stale render-time closures.
    const sourceStrokes = strokes ?? strokesRenderRef.current.completed;
    const allCapturedPoints = sourceStrokes.flatMap((s) => s.points);
    let sumX = 0, sumY = 0;
    let totalPointsCount = 0;

    if (allCapturedPoints.length === 0) {
      // Setup fallback coordinates to center of screen
      sumX = canvas.width / 2;
      sumY = canvas.height / 2;
    } else {
      allCapturedPoints.forEach((p) => {
        sumX += p.x;
        sumY += p.y;
        totalPointsCount++;
      });
      sumX /= totalPointsCount;
      sumY /= totalPointsCount;
    }

    const castX = sumX;
    const castY = sumY;

    // Determine what exact spell compiles
    // Is it a guided trace spell? Use currentSpell. Otherwise classify via gesture
    let spellToCast = currentSpell;
    if (!practiceMode) {
      // Find database item which implements element
      const matchingSpell = SPELLS_DATABASE.find((s) => s.primaryElement === recognizedType && s.type === 'primitive');
      if (matchingSpell) spellToCast = matchingSpell;
    }

    if (!spellToCast || spellToCast.id === 'unknown') {
      mystSynth.playFizzle();
      onFizzle();
      return;
    }

    // Interactive Trigger Success Effects
    castingTransRef.current = true;
    setIsCastingTrans(true);
    setTimeout(() => {
      castingTransRef.current = false;
      setIsCastingTrans(false);
    }, 800);

    // Dynamic Sound Synthesis
    mystSynth.playActivationSuccess();

    // Notify parent widget of score (instant cast notifies itself beforehand)
    if (options?.notify !== false) {
      onSpellRecognized(spellToCast.id, accuracyOverride ?? 92, scores);
    }

    // Activation burst: radial sparks + expanding shockwave ring at the cast origin
    spawnActivationBurst(castX, castY, spellToCast.color);

    // Spawning Spells entities & Particle engines
    const color = spellToCast.color;
    switch (spellToCast.id) {
      case 'light':
        // Light golden spheres
        entitiesRef.current.push({
          id: Math.random().toString(),
          type: 'light_sphere',
          x: castX,
          y: castY,
          size: 35 + Math.random() * 15,
          vx: Math.random() * 1.2 - 0.6,
          vy: -Math.random() * 0.8 - 0.2,
          color: color,
        });
        break;

      case 'ice':
        // Growth jagged pillars side-by-side
        mystSynth.playIceSprout();
        entitiesRef.current.push({
          id: Math.random().toString(),
          type: 'ice_pillar',
          x: castX,
          y: canvas.height, // Rise from floor level
          size: 130 + Math.random() * 50,
          color: color,
          customData: { height: 0 },
        });
        break;

      case 'plant':
        // Proc botanical sprout vines
        mystSynth.playPlantSprout();
        entitiesRef.current.push({
          id: Math.random().toString(),
          type: 'plant_vine',
          x: castX,
          y: canvas.height, // start bottom anchor
          size: 12 + Math.floor(Math.random() * 8), // joints count
          color: color,
          customData: { joints: [{ x: castX, y: canvas.height }] },
        });
        break;

      case 'fire':
        // Launch blazing combustion meteors
        mystSynth.playFireExplosion();
        for (let meteors = 0; meteors < 3; meteors++) {
          entitiesRef.current.push({
            id: Math.random().toString(),
            type: 'fireball',
            x: castX,
            y: castY,
            size: 20 + Math.random() * 10,
            vx: (Math.random() - 0.5) * 8,
            vy: -Math.random() * 5 - 2,
            color: color,
            life: 0,
            maxLife: 150 + Math.random() * 50,
          });
        }
        break;

      case 'sleep_mist':
        // Spawns 25 lavender cloud nodes filling screen
        for (let mist = 0; mist < 25; mist++) {
          particlesRef.current.push({
            id: Math.random().toString(),
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 0.6,
            vy: (Math.random() - 0.5) * 0.4,
            size: 80 + Math.random() * 80,
            color: color,
            alpha: 0.55,
            life: 0,
            maxLife: 600 + Math.random() * 200,
            type: 'mist',
          });
        }
        break;

      case 'wind_vortex':
        // Vortex tornado
        entitiesRef.current.push({
          id: 'tornado-vortex',
          type: 'light_sphere',
          x: castX,
          y: castY,
          size: 120,
          vx: 0,
          vy: 0,
          color: color,
          customData: { isVortex: true },
        });
        break;

      case 'invisibility':
        // Shroud opacity refraction lens
        isInvisActiveRef.current = true;
        setIsInvisActive(true);
        break;

      case 'safety_hover':
        // Gravity bubble shield
        entitiesRef.current.push({
          id: Math.random().toString(),
          type: 'light_sphere',
          x: castX,
          y: castY,
          size: 180,
          vx: 0,
          vy: 0,
          color: color,
          customData: { isGravityBubble: true },
        });
        break;

      case 'petrification':
        // Freeze and calcify plants/fire into stone
        entitiesRef.current.forEach((e) => {
          if (e.type === 'plant_vine' || e.type === 'light_sphere') {
            e.customData = { ...e.customData, isStone: true };
          }
        });
        break;

      case 'monster_arm':
        // Sprout IK arm attachment
        entitiesRef.current.push({
          id: 'mutation-arm',
          type: 'plant_vine',
          x: anchorXCoord(),
          y: canvas.height,
          size: 6,
          color: color,
          customData: { isArm: true },
        });
        break;

      case 'teleportation':
        // Teleport portal portals relocate helper seeds. Do not append, resets portal anchors
        const pA = entitiesRef.current.find((e) => e.id === 'portal-a');
        const pB = entitiesRef.current.find((e) => e.id === 'portal-b');
        if (pA && pB) {
          pA.x = castX - 100;
          pA.y = castY;
          pB.x = castX + 100;
          pB.y = castY;
        }
        break;
    }
  };

  // Activation burst: ~26 radial spark/sparkle particles + one expanding shockwave ring
  const spawnActivationBurst = (x: number, y: number, color: string) => {
    const roomForSparks = particlesRef.current.length < MAX_PARTICLES;

    if (roomForSparks) {
      for (let i = 0; i < 26; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 3.5 + 1;
        particlesRef.current.push({
          id: Math.random().toString(),
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.4,
          size: Math.random() * 3 + 1.5,
          color,
          alpha: 1,
          life: 0,
          maxLife: 22 + Math.random() * 16,
          type: Math.random() < 0.6 ? 'spark' : 'sparkle',
        });
      }
    }

    entitiesRef.current.push({
      id: Math.random().toString(),
      type: 'light_sphere',
      x,
      y,
      size: 10,
      color,
      maxLife: 36,
      customData: { isRing: true, baseRadius: 12, age: 0 },
    });
  };

  const anchorXCoord = () => {
    const canvas = canvasRef.current;
    return canvas ? canvas.width * 0.15 : 100;
  };

  // Release the pointer capture taken on pointerdown; harmless if none held.
  const releasePointerCapture = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  };

  // --- Mid-stroke interruption safety ---
  // Phone calls, notification banners, and palm rejection fire 'pointercancel'
  // or steal window focus mid-gesture. Without cleanup, isDrawing sticks true
  // and the half-finished stroke lingers forever. Aborting drops the gesture
  // silently: no cast, no score, no sound, as if it never happened.
  const cancelActiveStroke = () => {
    const draggedId = dragEntityIdRef.current;
    if (draggedId) {
      const dragged = entitiesRef.current.find((ent) => ent.id === draggedId);
      if (dragged) {
        dragged.customData = { ...dragged.customData, isDragged: false };
      }
      dragEntityIdRef.current = null;
    }
    setIsDrawing(false);
    setCurrentStroke([]);
  };

  useEffect(() => {
    const handleWindowBlur = () => {
      // strokesRenderRef mirrors drawing state for the mount-once loop, so it
      // doubles as a fresh, dependency-free signal of a gesture in flight.
      if (dragEntityIdRef.current || strokesRenderRef.current.current.length > 0) {
        cancelActiveStroke();
      }
    };
    window.addEventListener('blur', handleWindowBlur);
    return () => window.removeEventListener('blur', handleWindowBlur);
  }, []);

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    releasePointerCapture(e);
    cancelActiveStroke();
  };

  // --- Mouse & Draw Captured event listeners (Touch compatibility) ---
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Track the pointer even when it leaves the canvas mid-stroke (a finger
    // drifting over the tool rails). Some browsers throw for mouse pointers.
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Capture unavailable: default hit-target tracking still applies.
    }

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    lastMousePosRef.current = { x, y };

    // Interactive Dragging detection: Clicked on a portable light sphere or portal node?
    const clickedEntity = entitiesRef.current.find((ent) => {
      if (ent.type === 'light_sphere' || ent.type === 'portal') {
        const dx = ent.x - x;
        const dy = ent.y - y;
        return Math.sqrt(dx * dx + dy * dy) < ent.size;
      }
      return false;
    });

    if (clickedEntity) {
      if (clickedEntity.type === 'ice_pillar' && clickedEntity.customData?.isStone) {
        // Shatter stone
        shatterPillar(clickedEntity);
        return;
      }
      dragEntityIdRef.current = clickedEntity.id;
      clickedEntity.customData = { ...clickedEntity.customData, isDragged: true };
      return;
    }

    // Shatter ice pillars on click
    const clickedPillar = entitiesRef.current.find((ent) => {
      if (ent.type === 'ice_pillar') {
        const distToFloor = canvas.height - y;
        return Math.abs(ent.x - x) < 40 && distToFloor < ent.customData.height;
      }
      return false;
    });

    if (clickedPillar) {
      shatterPillar(clickedPillar);
      return;
    }

    // Start drawing
    setIsDrawing(true);
    setCurrentStroke([{ x, y, t: Date.now() }]);
    mystSynth.playDrawingHum(180);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    lastMousePosRef.current = { x, y };

    // Move dragged objects
    if (dragEntityIdRef.current) {
      const ent = entitiesRef.current.find((e) => e.id === dragEntityIdRef.current);
      if (ent) {
        ent.x = x;
        ent.y = y;
      }
      return;
    }

    if (!isDrawing) return;

    const prevPt = currentStroke[currentStroke.length - 1];
    const d = prevPt ? Math.sqrt((prevPt.x - x)**2 + (prevPt.y - y)**2) : 0;

    // Add point if moved at least 2 pixels to optimize points count
    if (d > 2) {
      setCurrentStroke((prev) => [...prev, { x, y, t: Date.now() }]);
      if (Math.random() < 0.25) {
        mystSynth.playDrawingHum(180 + d * 3);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (dragEntityIdRef.current) {
      const ent = entitiesRef.current.find((e) => e.id === dragEntityIdRef.current);
      if (ent) {
        ent.customData = { ...ent.customData, isDragged: false };
      }
      dragEntityIdRef.current = null;
      return;
    }

    if (!isDrawing) return;
    setIsDrawing(false);

    if (currentStroke.length < 3) {
      setCurrentStroke([]);
      return;
    }

    const newStroke: Stroke = {
      id: Math.random().toString(),
      points: currentStroke,
    };

    const nextStrokes = [...completedStrokes, newStroke];
    setCompletedStrokes(nextStrokes);
    setCurrentStroke([]);

    // Check if drawing has completed the trace or if we are free-drawing.
    // In practice/trace mode, compile spell when trace matches accuracy.
    // In Sandbox free-draw, compile immediately if they finished the geometric shape (or automatically if circle drawn!)
    // For comfort, let's allow they compile on clicking "Activate" OR auto-trigger if a completed closed circle is drawn
    if (practiceMode && currentSpell) {
      // Trace mode: analyze current trace accuracy using rotation-invariant matcher.
      // Auto-compile ONLY on genuine similarity to the practiced glyph.
      const res = recognizeGesture(nextStrokes);
      const targetScore = scoreAgainstTarget(nextStrokes, currentSpell.primaryElement);

      const matched =
        res.name === currentSpell.primaryElement || targetScore >= TRACE_CAST_THRESHOLD;

      if (matched) {
        // Honest accuracy derived from the raw target similarity, clamped for display
        const accuracy = Math.min(99, Math.max(50, Math.round(targetScore * 100)));

        setCompletedStrokes([]);
        activateTriggerSpell(
          currentSpell.primaryElement as ElementType,
          accuracy,
          res.scores,
          undefined,
          nextStrokes
        );
      }
    }
  };

  const shatterPillar = (icePillar: AmbientEntity) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Play shatter noise
    mystSynth.playIceSprout();
    // Spawn falling shattering triangle ice blocks
    for (let shard = 0; shard < 10; shard++) {
      particlesRef.current.push({
        id: Math.random().toString(),
        x: icePillar.x + (Math.random() * 40 - 20),
        y: canvas.height - (Math.random() * icePillar.customData.height),
        vx: (Math.random() - 0.5) * 5,
        vy: -Math.random() * 4 - 1,
        size: Math.random() * 12 + 6,
        color: icePillar.customData?.isStone ? '#636E72' : '#74B9FF',
        alpha: 1,
        life: 0,
        maxLife: 80 + Math.random() * 40,
        type: 'spark', // Bounces and falls
      });
    }
    // Delete pillar
    entitiesRef.current = entitiesRef.current.filter((e) => e.id !== icePillar.id);
  };

  // Explicit Activation trigger from Button Panel
  const compileSandboxSpells = () => {
    if (completedStrokes.length === 0) {
      mystSynth.playFizzle();
      onFizzle();
      return;
    }

    const res = recognizeGesture(completedStrokes);

    // Sync render refs eagerly so the mount-once RAF loop stops drawing the
    // consumed strokes before React re-renders.
    strokesRenderRef.current = { completed: [], current: [] };
    setCompletedStrokes([]);

    // Capture the pre-clear strokes once: scoring, accuracy grading and the cast
    // origin must all see the same drawing even after setCompletedStrokes([]).
    const strokesForScoring = completedStrokes;

    // Success requires an actual classification (never 'unknown')
    let success = false;
    let finalElement: ElementType = 'light';
    if (practiceMode && currentSpell) {
      finalElement = currentSpell.primaryElement as ElementType;
      if (res.name === currentSpell.primaryElement) {
        success = true;
      } else {
        const targetScore = scoreAgainstTarget(strokesForScoring, currentSpell.primaryElement);
        if (targetScore >= TRACE_CAST_THRESHOLD) {
          success = true;
        }
      }
    } else if (res.name !== 'unknown') {
      success = true;
      finalElement = res.name as ElementType;
    }

    if (success) {
      // Honest accuracy: in trace mode grade against the practiced glyph's own
      // templates; in sandbox the global classifier score is already the truth.
      const accuracy = practiceMode && currentSpell
        ? Math.max(
            Math.round(res.score * 100),
            Math.round(scoreAgainstTarget(strokesForScoring, currentSpell.primaryElement) * 100),
          )
        : Math.round(res.score * 100);
      activateTriggerSpell(finalElement, accuracy, res.scores, undefined, strokesForScoring);
    } else {
      mystSynth.playFizzle();
      // Surface the target similarity so a NEAR-MISS trace (e.g. 53% vs the practiced
      // glyph) shows "Faulty <Element> Attempt" instead of a generic scribble. The
      // attempt WAS aimed at something. A confidently-recognized bare ring likewise
      // reports itself rather than reading as noise.
      const nearMissTarget = practiceMode && currentSpell
        ? scoreAgainstTarget(strokesForScoring, currentSpell.primaryElement)
        : 0;
      const scores = res.matchedTemplate === 'circle' && res.score >= RECOGNIZE_THRESHOLD_DISPLAY
        ? { ...res.scores, circle: Math.max(res.score, nearMissTarget) }
        : nearMissTarget > (res.scores?.[currentSpell?.primaryElement ?? ''] ?? 0)
          ? { ...res.scores, [currentSpell!.primaryElement]: nearMissTarget }
          : res.scores;
      onFizzle(scores);
    }
  };


  // Tracing Auto-Cast Bypass / Demo Action
  const handleInstantCast = () => {
    if (!currentSpell) return;

    // Wipe any existing messy ink strokes first (sync render refs eagerly so
    // the mount-once RAF loop sees cleared strokes before React re-renders)
    strokesRenderRef.current = { completed: [], current: [] };
    setCompletedStrokes([]);
    setCurrentStroke([]);

    // Instantly play success audio/visual transitions
    mystSynth.playActivationSuccess();
    castingTransRef.current = true;
    setIsCastingTrans(true);
    setTimeout(() => {
      castingTransRef.current = false;
      setIsCastingTrans(false);
    }, 800);

    // Notify parent frame that spell triggered perfectly! (exactly once)
    onSpellRecognized(currentSpell.id, 100);

    // Launch element visualizer in the default central coordinates
    activateTriggerSpell(currentSpell.primaryElement as ElementType, 100, undefined, { notify: false });
  };

  const clearCanvas = () => {
    setCompletedStrokes([]);
    setCurrentStroke([]);
    entitiesRef.current = entitiesRef.current.filter((e) => e.type === 'portal'); // Keep portal, wipe rest
    particlesRef.current = [];
    isInvisActiveRef.current = false;
    setIsInvisActive(false);
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[60vh] lg:h-auto lg:flex-1 lg:min-h-0 bg-[#180E21] border border-amber-950 rounded-2xl overflow-hidden shadow-2xl group"
    >
      {/* Background active energy glow aura depending on invisibility shrouds */}
      <canvas
        id="glyph-canvas"
        ref={canvasRef}
        tabIndex={0}
        role="application"
        aria-label="Glyph drawing canvas. Draw with a mouse, touch, or pen. Results are announced below."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={(e) => {
          // Allow Space/Enter to be non-destructive: keep canvas focus but do
          // nothing so keyboard users can pass through without triggering a cast.
          if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
        }}
        className="block w-full h-full cursor-crosshair touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-inset"
      />

      {/* Visually hidden live hint that the canvas is interactive */}
      <span className="sr-only" aria-live="polite">
        {isInvisActive ? 'Invisibility is active. Press M to mute, T for trace mode, or S for sandbox.' : 'Glyph canvas ready. Draw a glyph to cast.'}
      </span>

      {/* Rhythmic Invisibility Exhalation Breath Gauge */}
      {isInvisActive && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 w-72 bg-[#120816]/95 backdrop-blur-md rounded-full border border-amber-500/30 p-2 text-center select-none shadow-amber-500/20 shadow-lg flex items-center gap-3">
          <span id="breath-meter-label" className="font-mono text-[10px] text-amber-400 tracking-wider pl-2 uppercase font-medium">Lungs:</span>
          <div
            role="progressbar"
            aria-labelledby="breath-meter-label"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(breathMeter)}
            className="flex-grow bg-[#21152B] h-2 rounded-full overflow-hidden"
          >
            <div
              className="bg-gradient-to-r from-amber-500 to-rose-400 h-full transition-all duration-100 ease-linear"
              style={{ width: `${breathMeter}%` }}
            />
          </div>
          <span className="font-mono text-[9px] text-amber-300 pr-2">{Math.round(breathMeter)}s</span>
        </div>
      )}

      {/* Canvas Tool Rails */}
      <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-center gap-2 sm:justify-between pointer-events-none">
        <div className="flex flex-wrap items-center justify-center gap-2 pointer-events-auto">
          <button
            id="clear-canvas-btn"
            type="button"
            onClick={clearCanvas}
            className="px-3.5 py-2.5 min-h-[44px] min-w-[44px] bg-[#251532]/90 hover:bg-[#341F46] text-amber-200/90 hover:text-white rounded-lg border border-amber-900/50 hover:border-amber-700/60 transition-all text-xs font-mono tracking-wide flex items-center gap-1.5 shadow-lg shadow-black/30 cursor-pointer"
          >
            Wipe Ink
          </button>
          {completedStrokes.length > 0 && (
            <button
              id="undo-stroke-btn"
              type="button"
              onClick={() => setCompletedStrokes((prev) => prev.slice(0, -1))}
              className="px-3.5 py-2.5 min-h-[44px] min-w-[44px] bg-[#251532]/90 hover:bg-[#341F46] text-amber-200/90 hover:text-white rounded-lg border border-amber-900/50 hover:border-amber-700/60 transition-all text-xs font-mono tracking-wide flex items-center gap-1.5 shadow-lg shadow-black/30 cursor-pointer"
            >
              Undo Stroke
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 pointer-events-auto">
          {practiceMode && (
            <span className="hidden sm:inline-flex px-3 py-1.5 bg-[#251532]/90 border border-amber-800/40 text-amber-300 rounded-lg text-xs font-mono tracking-wider items-center gap-2 shadow-lg shadow-black/30 animate-pulse">
              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-ping" />
              Guidelines Active
            </span>
          )}
          {practiceMode && (
            <button
              id="instant-cast-btn"
              type="button"
              onClick={handleInstantCast}
              className="px-3.5 py-2.5 min-h-[44px] min-w-[44px] bg-gradient-to-r from-purple-700 to-indigo-700 hover:from-purple-600 hover:to-indigo-600 text-amber-100 rounded-lg border border-purple-500/40 hover:border-purple-400/50 transition-all text-xs font-mono tracking-wider flex items-center gap-1.5 shadow-lg shadow-black/30 cursor-pointer active:scale-95"
              title="Instantly manifest the active spellcast visual effects and entities!"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
              <span>Instant Cast</span>
            </button>
          )}
          <button
            id="compile-spell-btn"
            type="button"
            onClick={compileSandboxSpells}
            disabled={completedStrokes.length === 0}
            className={`px-4 py-2.5 min-h-[44px] min-w-[44px] rounded-lg text-xs font-mono tracking-wider font-semibold transition-all shadow-lg flex items-center gap-1.5 ${
              completedStrokes.length > 0
                ? 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 border border-amber-400 active:scale-95 cursor-pointer'
                : 'bg-[#251532]/45 text-amber-300/30 border border-amber-900/40 cursor-not-allowed'
            }`}
          >
            Activate Glyph
          </button>
        </div>
      </div>

      {/* Floating Canvas Guide Note */}
      <span className="hidden sm:inline absolute top-4 left-4 font-mono text-[9px] text-amber-200/40 tracking-wider select-none pointer-events-none uppercase">
        Boiling Isles Wild Magic Canvas Grid v2.1
      </span>
    </div>
  );
}
