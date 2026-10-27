"use client";

// WebGL renderer of the Production Floor. It only draws: every value it uses
// comes already derived from lib/product-mix-scene.ts and scaled by
// lib/product-mix-layout.ts. This module is loaded on the client only (see
// product-mix-view.tsx), so it may touch window and WebGL freely.

import {
  Canvas,
  events as pointerEvents,
  useFrame,
  useThree,
  type RootStore,
  type ThreeEvent,
} from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { NO_HIGHLIGHT, type Highlight } from "@/lib/highlight";
import {
  FLOOR,
  type FloorLayout,
  type PlacedChannel,
  type PlacedProduct,
  type PlacedResource,
} from "@/lib/product-mix-layout";
import { productTone, SCENE_COLORS, UNREPRESENTED_TONE } from "./tones";

export interface SceneLabel {
  key: string;
  kind: "resource" | "product" | "channel";
  /** World position the label points at. */
  anchor: [number, number, number];
  title: string;
  lines: string[];
  /** Highlighted entity or part of the highlighted relation. */
  emphasis: boolean;
}

export interface ProductMixCanvasProps {
  layout: FloorLayout;
  labels: SceneLabel[];
  highlight: Highlight;
  onHighlight: (highlight: Highlight) => void;
  /** Changing it returns the camera to its initial framing. */
  resetKey: number;
  onContextLost: () => void;
}

// Shared unit geometries, scaled per object. `dispose={null}` keeps React
// Three Fiber from disposing them when one object unmounts.
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_EDGES = new THREE.EdgesGeometry(UNIT_BOX);
const DASHED_EDGES = (() => {
  const geometry = new THREE.EdgesGeometry(UNIT_BOX);
  new THREE.LineSegments(geometry).computeLineDistances();
  return geometry;
})();

// Outlines are drawing aids, not targets. Three's default line threshold (one
// world unit) would otherwise make every edge catch the pointer from afar.
const NO_RAYCAST = () => {};

const PLINTH_HEIGHT = 0.1;
const PAD_HEIGHT = 0.06;
const VESSEL_WIDTH = 0.62;
const CAMERA_FOV = 30;
const CAMERA_POLAR = 0.98;
const CAMERA_AZIMUTH = 0.55;
const TARGET_HEIGHT = 0.45;
const FRAMING = 0.68;

/**
 * R3F's default events read `offsetX`, which some embedded or emulated
 * browsers report relative to a stale layout. The pointer is computed from
 * client coordinates and the canvas rectangle instead.
 */
function clientPointerEvents(store: RootStore) {
  return {
    ...pointerEvents(store),
    compute(event: { clientX: number; clientY: number }, state: ReturnType<RootStore["getState"]>) {
      const rect = state.gl.domElement.getBoundingClientRect();
      state.pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      state.raycaster.setFromCamera(state.pointer, state.camera);
    },
  };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function ProductMixCanvas({
  layout,
  labels,
  highlight,
  onHighlight,
  resetKey,
  onContextLost,
}: ProductMixCanvasProps) {
  const labelElements = useRef<(HTMLDivElement | null)[]>([]);
  const tones = useMemo(
    () =>
      new Map(
        layout.products.map((placed, index) => [
          placed.product.variableId,
          productTone(index),
        ]),
      ),
    [layout.products],
  );
  const interpretable = useMemo(
    () =>
      new Set(
        layout.resources
          .filter((placed) => placed.resource.capacityIssues.length === 0)
          .map((placed) => placed.resource.constraintId),
      ),
    [layout.resources],
  );

  return (
    <div className="scene-stage">
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        shadows="percentage"
        events={clientPointerEvents}
        gl={{ antialias: true, alpha: true }}
        camera={{ fov: CAMERA_FOV, near: 0.1, far: 200 }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", (event) => {
            event.preventDefault();
            onContextLost();
          });
        }}
        onPointerMissed={() => onHighlight(NO_HIGHLIGHT)}
      >
        <hemisphereLight args={["#fffdf6", "#cfc6b2", 1.9]} />
        <directionalLight
          position={[-4, 8, 5]}
          intensity={1.6}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-7}
          shadow-camera-right={7}
          shadow-camera-top={7}
          shadow-camera-bottom={-7}
          shadow-bias={-0.0005}
        />
        <CameraRig
          radius={layout.radius}
          centerZ={layout.platform.centerZ}
          resetKey={resetKey}
        />
        <Platform layout={layout} />
        {layout.channels.map((channel) => (
          <Channel
            key={`${channel.consumption.constraintId}:${channel.consumption.variableId}`}
            channel={channel}
            tone={tones.get(channel.consumption.variableId) ?? SCENE_COLORS.channel}
            interpretable={interpretable.has(channel.consumption.constraintId)}
            highlight={highlight}
            onHighlight={onHighlight}
          />
        ))}
        {layout.resources.map((placed) => (
          <ResourceStation
            key={placed.resource.constraintId}
            placed={placed}
            tones={tones}
            highlight={highlight}
            onHighlight={onHighlight}
          />
        ))}
        {layout.products.map((placed) => (
          <ProductStation
            key={placed.product.variableId}
            placed={placed}
            tone={tones.get(placed.product.variableId)!}
            highlight={highlight}
            onHighlight={onHighlight}
          />
        ))}
        <LabelProjector labels={labels} elements={labelElements} />
      </Canvas>
      <div className="scene-labels" aria-hidden="true">
        {labels.map((label, index) => (
          <div
            key={label.key}
            ref={(element) => {
              labelElements.current[index] = element;
            }}
            className={`scene-label scene-label-${label.kind}${label.emphasis ? " is-emphasis" : ""}`}
          >
            <span className="scene-label-title">{label.title}</span>
            {label.lines.map((line) => (
              <span key={line} className="scene-label-line">
                {line}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Orbit limited to a slightly isometric view: no panning, never below the
 * floor and never so far that the floor is lost. The target stays fixed.
 */
function CameraRig({
  radius,
  centerZ,
  resetKey,
}: {
  radius: number;
  centerZ: number;
  resetKey: number;
}) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const getState = useThree((state) => state.get);
  const controls = useRef<OrbitControls | null>(null);

  useEffect(() => {
    const orbit = new OrbitControls(camera, gl.domElement);
    orbit.enablePan = false;
    orbit.enableDamping = false;
    orbit.minPolarAngle = 0.35;
    orbit.maxPolarAngle = 1.25;
    orbit.minAzimuthAngle = -0.5;
    orbit.maxAzimuthAngle = 1.45;
    if (window.matchMedia("(pointer: coarse)").matches) {
      // One finger scrolls the page; two fingers orbit and zoom.
      orbit.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
      gl.domElement.style.touchAction = "pan-y";
    }
    const render = () => invalidate();
    orbit.addEventListener("change", render);
    controls.current = orbit;
    return () => {
      orbit.removeEventListener("change", render);
      orbit.dispose();
      controls.current = null;
    };
  }, [camera, gl, invalidate]);

  useEffect(() => {
    const orbit = controls.current;
    if (!orbit) {
      return;
    }
    const { size } = getState();
    const vertical = THREE.MathUtils.degToRad(camera.fov);
    const horizontal =
      2 * Math.atan(Math.tan(vertical / 2) * (size.width / Math.max(1, size.height)));
    // The bounding sphere is loose around a flat floor seen from above, so
    // the framing distance is tightened by FRAMING.
    const distance =
      (FRAMING * radius) / Math.sin(Math.min(vertical, horizontal) / 2);

    orbit.minDistance = distance * 0.6;
    orbit.maxDistance = distance * 1.6;
    orbit.target.set(0, TARGET_HEIGHT, centerZ);
    camera.position
      .setFromSpherical(new THREE.Spherical(distance, CAMERA_POLAR, CAMERA_AZIMUTH))
      .add(orbit.target);
    orbit.update();
    invalidate();
  }, [camera, getState, invalidate, radius, centerZ, resetKey]);

  return null;
}

/** Moves the HTML labels over their anchors whenever a frame is rendered. */
function LabelProjector({
  labels,
  elements,
}: {
  labels: SceneLabel[];
  elements: React.RefObject<(HTMLDivElement | null)[]>;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const point = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    invalidate();
  }, [labels, invalidate]);

  // With frameloop="demand" this only runs when the scene actually renders.
  useFrame(({ camera, size }) => {
    labels.forEach((label, index) => {
      const element = elements.current[index];
      if (!element) {
        return;
      }
      point.set(...label.anchor).project(camera);
      // Labels are centred on their anchor but kept inside the stage.
      const half = element.offsetWidth / 2;
      const x = Math.min(
        Math.max(((point.x + 1) / 2) * size.width, half + 4),
        Math.max(half + 4, size.width - half - 4),
      );
      const y = Math.max(
        ((1 - point.y) / 2) * size.height,
        element.offsetHeight + 4,
      );
      element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      element.style.visibility = point.z < 1 ? "visible" : "hidden";
    });
  });

  return null;
}

/**
 * A vertical box between `bottom` and `top` that eases towards new values,
 * so a change of solution reads as a change rather than a jump. It renders
 * on demand only while it moves.
 */
function Bar({
  bottom,
  top,
  width,
  color,
  opacity = 1,
}: {
  bottom: number;
  top: number;
  width: number;
  color: string;
  opacity?: number;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const current = useRef({ bottom, top: bottom });
  const invalidate = useThree((state) => state.invalidate);
  const reduced = useMemo(prefersReducedMotion, []);

  function apply() {
    const box = mesh.current;
    if (!box) {
      return;
    }
    const height = current.current.top - current.current.bottom;
    box.visible = height > 1e-4;
    box.scale.set(width, Math.max(height, 1e-4), width);
    box.position.y = current.current.bottom + height / 2;
  }

  useLayoutEffect(apply);
  useEffect(() => {
    invalidate();
  }, [bottom, top, invalidate]);

  useFrame((state, delta) => {
    const value = current.current;
    const step = reduced ? 1 : 1 - Math.exp(-Math.min(delta, 1 / 30) * 9);
    value.bottom += (bottom - value.bottom) * step;
    value.top += (top - value.top) * step;
    if (Math.abs(bottom - value.bottom) + Math.abs(top - value.top) > 1e-4) {
      state.invalidate();
    } else {
      value.bottom = bottom;
      value.top = top;
    }
    apply();
  });

  return (
    <mesh ref={mesh} geometry={UNIT_BOX} dispose={null} castShadow>
      <meshStandardMaterial
        color={color}
        roughness={0.85}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </mesh>
  );
}

function Outline({
  scale,
  y,
  color,
  dashed = false,
}: {
  scale: [number, number, number];
  y: number;
  color: string;
  dashed?: boolean;
}) {
  return (
    <lineSegments
      geometry={dashed ? DASHED_EDGES : UNIT_EDGES}
      dispose={null}
      scale={scale}
      position={[0, y, 0]}
      raycast={NO_RAYCAST}
    >
      {dashed ? (
        <lineDashedMaterial color={color} dashSize={0.05} gapSize={0.05} />
      ) : (
        <lineBasicMaterial color={color} />
      )}
    </lineSegments>
  );
}

function Platform({ layout }: { layout: FloorLayout }) {
  const { width, depth, centerZ } = layout.platform;
  return (
    <group position={[0, 0, centerZ]}>
      <mesh
        geometry={UNIT_BOX}
        dispose={null}
        scale={[width, 0.12, depth]}
        position={[0, -0.06, 0]}
        receiveShadow
      >
        <meshStandardMaterial color={SCENE_COLORS.platform} roughness={1} />
      </mesh>
      <Outline scale={[width, 0.12, depth]} y={-0.06} color={SCENE_COLORS.rule} />
    </group>
  );
}

function hoverHandlers(
  target: Highlight,
  onHighlight: (highlight: Highlight) => void,
) {
  return {
    onPointerOver(event: ThreeEvent<PointerEvent>) {
      event.stopPropagation();
      (event.nativeEvent.target as HTMLElement | null)?.style.setProperty(
        "cursor",
        "pointer",
      );
      onHighlight(target);
    },
    onPointerOut(event: ThreeEvent<PointerEvent>) {
      (event.nativeEvent.target as HTMLElement | null)?.style.removeProperty(
        "cursor",
      );
      onHighlight(NO_HIGHLIGHT);
    },
  };
}

function isRelated(
  highlight: Highlight,
  constraintId: string | null,
  variableId: string | null,
): boolean {
  const matchesConstraint =
    highlight.constraintId === null || highlight.constraintId === constraintId;
  const matchesVariable =
    highlight.variableId === null || highlight.variableId === variableId;
  return matchesConstraint && matchesVariable;
}

function hasHighlight(highlight: Highlight): boolean {
  return highlight.constraintId !== null || highlight.variableId !== null;
}

function Channel({
  channel,
  tone,
  interpretable,
  highlight,
  onHighlight,
}: {
  channel: PlacedChannel;
  tone: string;
  interpretable: boolean;
  highlight: Highlight;
  onHighlight: (highlight: Highlight) => void;
}) {
  const [x1, z1] = channel.from;
  const [x2, z2] = channel.to;
  const length = Math.hypot(x2 - x1, z2 - z1);
  const angle = Math.atan2(x2 - x1, z2 - z1);
  const { constraintId, variableId } = channel.consumption;
  const related = isRelated(highlight, constraintId, variableId);
  const opacity = !hasHighlight(highlight) ? 0.8 : related ? 1 : 0.18;

  return (
    <group
      position={[(x1 + x2) / 2, 0, (z1 + z2) / 2]}
      rotation={[0, angle, 0]}
      {...hoverHandlers({ constraintId, variableId }, onHighlight)}
    >
      <mesh
        geometry={UNIT_BOX}
        dispose={null}
        scale={[channel.width, 0.014, length]}
        position={[0, 0.007, 0]}
        receiveShadow
      >
        <meshStandardMaterial
          color={interpretable ? tone : SCENE_COLORS.rule}
          roughness={0.9}
          transparent
          opacity={opacity}
        />
      </mesh>
      {/* Wider invisible target so a thin relation is still easy to point at. */}
      <mesh
        geometry={UNIT_BOX}
        dispose={null}
        scale={[Math.max(channel.width, 0.3), 0.05, length * 0.6]}
        position={[0, 0.025, 0]}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

function ResourceStation({
  placed,
  tones,
  highlight,
  onHighlight,
}: {
  placed: PlacedResource;
  tones: Map<string, string>;
  highlight: Highlight;
  onHighlight: (highlight: Highlight) => void;
}) {
  const { resource, state, x, z, fillHeight, segments } = placed;
  const interpretable = resource.capacityIssues.length === 0;
  const emphasized =
    highlight.constraintId === resource.constraintId &&
    highlight.variableId === null;
  const height = FLOOR.vesselHeight;
  const base = PLINTH_HEIGHT;
  const inner = VESSEL_WIDTH - 0.08;

  return (
    <group
      position={[x, 0, z]}
      {...hoverHandlers(
        { constraintId: resource.constraintId, variableId: null },
        onHighlight,
      )}
    >
      <mesh
        geometry={UNIT_BOX}
        dispose={null}
        scale={[1.2, PLINTH_HEIGHT, 1.2]}
        position={[0, PLINTH_HEIGHT / 2, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color={emphasized ? "#d6e0da" : SCENE_COLORS.plinth}
          roughness={0.95}
        />
      </mesh>
      <Outline
        scale={[1.2, PLINTH_HEIGHT, 1.2]}
        y={PLINTH_HEIGHT / 2}
        color={emphasized ? SCENE_COLORS.accent : SCENE_COLORS.rule}
      />
      {/* The vessel: its full height is this resource's own capacity. */}
      <mesh
        geometry={UNIT_BOX}
        dispose={null}
        scale={[VESSEL_WIDTH, height, VESSEL_WIDTH]}
        position={[0, base + height / 2, 0]}
      >
        <meshStandardMaterial
          color="#ffffff"
          transparent
          opacity={0.22}
          depthWrite={false}
        />
      </mesh>
      <Outline
        scale={[VESSEL_WIDTH, height, VESSEL_WIDTH]}
        y={base + height / 2}
        color={
          emphasized
            ? SCENE_COLORS.accent
            : interpretable
              ? SCENE_COLORS.muted
              : SCENE_COLORS.rule
        }
        dashed={!interpretable}
      />
      {segments.length > 0
        ? segments.map((segment) => (
            <Bar
              key={segment.variableId ?? "unrepresented"}
              bottom={base + segment.bottom}
              top={base + segment.top}
              width={inner}
              color={
                segment.variableId
                  ? (tones.get(segment.variableId) ?? UNREPRESENTED_TONE)
                  : UNREPRESENTED_TONE
              }
            />
          ))
        : (
            <Bar
              bottom={base}
              top={base + fillHeight}
              width={inner}
              color={SCENE_COLORS.muted}
              opacity={0.55}
            />
          )}
      {state?.active ? (
        // Binding capacity: the vessel is closed by a cap.
        <mesh
          geometry={UNIT_BOX}
          dispose={null}
          scale={[VESSEL_WIDTH + 0.12, 0.04, VESSEL_WIDTH + 0.12]}
          position={[0, base + height + 0.02, 0]}
          castShadow
        >
          <meshStandardMaterial color={SCENE_COLORS.ink} roughness={0.7} />
        </mesh>
      ) : null}
    </group>
  );
}

function ProductStation({
  placed,
  tone,
  highlight,
  onHighlight,
}: {
  placed: PlacedProduct;
  tone: string;
  highlight: Highlight;
  onHighlight: (highlight: Highlight) => void;
}) {
  const { product, x, z, height } = placed;
  const emphasized =
    highlight.variableId === product.variableId &&
    highlight.constraintId === null;

  return (
    <group
      position={[x, 0, z]}
      {...hoverHandlers(
        { constraintId: null, variableId: product.variableId },
        onHighlight,
      )}
    >
      <mesh
        geometry={UNIT_BOX}
        dispose={null}
        scale={[1.3, PAD_HEIGHT, 1.3]}
        position={[0, PAD_HEIGHT / 2, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color={emphasized ? "#d6e0da" : SCENE_COLORS.plinth}
          roughness={0.95}
        />
      </mesh>
      <Outline
        scale={[1.3, PAD_HEIGHT, 1.3]}
        y={PAD_HEIGHT / 2}
        color={emphasized ? SCENE_COLORS.accent : SCENE_COLORS.rule}
      />
      {/* Identity mark: the product's tone exists before any quantity. */}
      <mesh
        geometry={UNIT_BOX}
        dispose={null}
        scale={[0.78, 0.012, 0.78]}
        position={[0, PAD_HEIGHT + 0.006, 0]}
      >
        <meshStandardMaterial color={tone} roughness={0.9} />
      </mesh>
      <Bar bottom={PAD_HEIGHT} top={PAD_HEIGHT + height} width={0.72} color={tone} />
    </group>
  );
}
