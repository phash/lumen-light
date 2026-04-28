/**
 * Editor-Canvas mit Pan/Zoom-Transform und Overlay-Stack.
 *
 * Stateless: Pan + Zoom-Werte und Mask-Refs kommen vom Parent. Wraps
 * das WebGL-Canvas mit dem Transform-Wrapper, blendet Crop-, Linear-,
 * Radial- und Compare-Split-Overlays daruebergelegt.
 */
import { type Ref, useMemo } from "react";

import Canvas, { type CanvasHandle } from "./Canvas";
import CompareSplitOverlay from "./CompareSplitOverlay";
import CropOverlay from "./CropOverlay";
import LinearMaskOverlay from "./LinearMaskOverlay";
import {
  type LinearMaskInstance,
  type RadialMaskInstance,
} from "./mask";
import RadialMaskOverlay from "./RadialMaskOverlay";
import {
  type AspectRatio,
  type CropRect,
  defaultCropRect,
  invertUvTransform,
  uvTransformMatrix,
} from "./transform";

const IDENTITY_CROP: CropRect = defaultCropRect();

interface Props {
  readonly canvasHandleRef: Ref<CanvasHandle>;
  readonly onTick: () => void;
  readonly onError: (msg: string) => void;
  readonly onCanvasMount: (canvas: HTMLCanvasElement) => void;

  readonly pan: { x: number; y: number };
  readonly zoom: number;
  readonly isPanning: boolean;

  readonly hasImage: boolean;
  readonly cropMode: boolean;
  readonly cropRect: CropRect;
  readonly aspect: AspectRatio;
  readonly imageAspect: number;
  readonly onCropChange: (rect: CropRect) => void;

  readonly selectedLinear: LinearMaskInstance | null;
  readonly selectedRadial: RadialMaskInstance | null;
  readonly onLinearMaskPoint: (
    id: string,
    which: "p1" | "p2",
    uv: { u: number; v: number },
  ) => void;
  readonly onRadialMaskCenter: (
    id: string,
    uv: { u: number; v: number },
  ) => void;
  readonly onRadialMaskRadii: (id: string, rx: number, ry: number) => void;

  readonly compareSnapshot: string | null;
  readonly splitX: number;
  readonly onSplitChange: (x: number) => void;

  readonly straightenAngle: number;
}

export default function EditorOverlayCanvas({
  canvasHandleRef,
  onTick,
  onError,
  onCanvasMount,
  pan,
  zoom,
  isPanning,
  hasImage,
  cropMode,
  cropRect,
  aspect,
  imageAspect,
  onCropChange,
  selectedLinear,
  selectedRadial,
  onLinearMaskPoint,
  onRadialMaskCenter,
  onRadialMaskRadii,
  compareSnapshot,
  splitX,
  onSplitChange,
  straightenAngle,
}: Props) {
  // Forward = Output-UV → Source-UV (Vertex-Shader macht dasselbe).
  // Inverse = Source-UV → Output-UV. Beide werden an die Mask-Overlays
  // gereicht, damit der User auf dem gecropten Output-Canvas dragged
  // und die Maske trotzdem im Source-Coordinate-System landet.
  // Im Crop-Modus zeigt das Canvas das volle Bild — Identity-Transform.
  const effCropForOverlay = cropMode ? IDENTITY_CROP : cropRect;
  const forwardUvTransform = useMemo(
    () => uvTransformMatrix(effCropForOverlay, straightenAngle),
    [effCropForOverlay, straightenAngle],
  );
  const inverseUvTransform = useMemo(
    () => invertUvTransform(forwardUvTransform),
    [forwardUvTransform],
  );

  return (
    <div
      className="relative max-w-full max-h-full"
      style={{
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        transformOrigin: "center center",
        transition: isPanning ? "none" : "transform 0.05s linear",
      }}
    >
      <Canvas
        ref={canvasHandleRef}
        onTick={onTick}
        onError={onError}
        onCanvasMount={onCanvasMount}
        cropMode={cropMode}
      />
      {hasImage && cropMode && (
        <CropOverlay
          cropRect={cropRect}
          aspect={aspect}
          imageAspect={imageAspect}
          onChange={onCropChange}
        />
      )}
      {hasImage && selectedLinear && (
        <LinearMaskOverlay
          mask={selectedLinear.mask}
          onChangePoint={(which, uv) =>
            onLinearMaskPoint(selectedLinear.id, which, uv)
          }
          forwardUvTransform={forwardUvTransform}
          inverseUvTransform={inverseUvTransform}
        />
      )}
      {hasImage && selectedRadial && (
        <RadialMaskOverlay
          mask={selectedRadial.mask}
          onChangeCenter={(uv) => onRadialMaskCenter(selectedRadial.id, uv)}
          onChangeRadii={(rx, ry) =>
            onRadialMaskRadii(selectedRadial.id, rx, ry)
          }
          forwardUvTransform={forwardUvTransform}
          inverseUvTransform={inverseUvTransform}
        />
      )}
      {hasImage && compareSnapshot && (
        <CompareSplitOverlay
          snapshotUrl={compareSnapshot}
          splitX={splitX}
          onSplitChange={onSplitChange}
        />
      )}
    </div>
  );
}
