import { useEffect, useRef, useState, type Dispatch, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { Icon } from '@/components/Icon';
import { FeatureGraphicView } from '@/components/FeatureGraphicView';
import { SlideView, type SlideEditing } from '@/components/SlideView';
import { getPreset, groupOf } from '@/config/storeSizes';
import { FEATURE_GRAPHIC_SIZE, MAX_SLIDES, previewSizeFor, slideDims } from '@/lib/constants';
import type { Design, ElementBox, SlideElement } from '@/lib/types';
import { MAX_ELEMENT_SCALE, MIN_ELEMENT_SCALE, type EditorAction } from '@/store/editorReducer';

const ZOOMS = [0.35, 0.45, 0.55, 0.7, 0.85];
/** Snap distance to a centre line, in screen pixels. */
const SNAP_PX = 6;
/** A press that moves less than this (screen px) is a click, not a drag. */
const DRAG_THRESHOLD_PX = 3;

interface CanvasProps {
  design: Design;
  selected: number;
  dispatch: Dispatch<EditorAction>;
  onDropOnSlide: (files: File[], index: number) => void;
  /** The Play feature graphic is selected (instead of slide `selected`). */
  featureSelected: boolean;
  /** Image dropped on the feature graphic → becomes its app icon. */
  onDropIcon: (files: File[]) => void;
}

/** The feature graphic is shown a bit larger than the slides' zoom, so its 1024 × 500 shape reads well. */
const FEATURE_PREVIEW_BOOST = 1.4;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * The element's current box: its stored one, or — the first time it's moved — the centre of
 * where the default layout put it, so it doesn't jump. Measured with getBoundingClientRect
 * (fractional) rather than offsetLeft/Width (rounded to whole pixels, which shifted elements
 * by up to half a unit). In the default layout the frame itself is never transformed, so its
 * rect is exact; dividing by the zoom converts screen pixels to slide units.
 */
function currentBox(stored: ElementBox | undefined, frame: HTMLElement, zoom: number): ElementBox {
  if (stored) return stored;
  const slideEl = frame.closest('[data-slide]');
  const f = frame.getBoundingClientRect();
  const s = slideEl ? slideEl.getBoundingClientRect() : { left: 0, top: 0 };
  return {
    x: (f.left + f.width / 2 - s.left) / zoom,
    y: (f.top + f.height / 2 - s.top) / zoom,
    scale: 1,
    rotate: 0,
  };
}

export function Canvas({ design, selected, dispatch, onDropOnSlide, featureSelected, onDropIcon }: CanvasProps) {
  const [zoomIndex, setZoomIndex] = useState(2);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [activeEl, setActiveEl] = useState<SlideElement | null>(null);
  const [guides, setGuides] = useState({ x: false, y: false });
  const dragCount = useRef(0);
  const endDrag = useRef<(() => void) | null>(null);
  const zoom = ZOOMS[zoomIndex];
  const size = previewSizeFor(design);
  const sizePreset = getPreset(design.sizeId);
  const groupLabel = sizePreset ? groupOf(sizePreset).label : '';
  const showFeature = design.store === 'play';
  const editingSlide = !featureSelected;
  const count = design.slides.length;
  const { W, H } = slideDims(size); // 414 on the short side; landscape slides are wide
  const slide = design.slides[selected];

  // A different slide: nothing is selected on it yet. Also stop any drag in progress.
  useEffect(() => {
    setActiveEl(null);
    return () => endDrag.current?.();
  }, [selected]);

  const storedBox = (el: SlideElement) => (el === 'text' ? slide?.textBox : slide?.deviceBox);
  /** Keep the centre on the slide so an element can't be lost off-canvas. */
  const keepOnSlide = (b: ElementBox): ElementBox => ({ ...b, x: clamp(b.x, 0, W), y: clamp(b.y, 0, H) });

  const onPointerDown: SlideEditing['onPointerDown'] = (el, kind, e: PointerEvent<HTMLElement>, frame) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection or native image drag (this also skips the default focus…)
    e.stopPropagation();
    frame.focus({ preventScroll: true }); // …so focus here, for arrow-key nudges
    setActiveEl(el);
    endDrag.current?.();

    const start = currentBox(storedBox(el), frame, zoom);
    const rect = frame.getBoundingClientRect();
    const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const startDist = Math.max(1, Math.hypot(e.clientX - centre.x, e.clientY - centre.y));
    const startX = e.clientX;
    const startY = e.clientY;
    const key = `drag:${++dragCount.current}`; // every move of this drag merges into one undo step
    const index = selected;
    const snap = SNAP_PX / zoom;
    let moved = false;

    const move = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
      moved = true;
      let box: ElementBox;
      let gx = false;
      let gy = false;
      if (kind === 'move') {
        let x = start.x + (ev.clientX - startX) / zoom;
        let y = start.y + (ev.clientY - startY) / zoom;
        if (!ev.altKey) {
          // Alt/Option turns snapping off for fine placement near the centre.
          if (Math.abs(x - W / 2) <= snap) {
            x = W / 2;
            gx = true;
          }
          if (Math.abs(y - H / 2) <= snap) {
            y = H / 2;
            gy = true;
          }
        }
        box = keepOnSlide({ ...start, x, y });
      } else {
        const dist = Math.hypot(ev.clientX - centre.x, ev.clientY - centre.y);
        box = { ...start, scale: clamp(start.scale * (dist / startDist), MIN_ELEMENT_SCALE, MAX_ELEMENT_SCALE) };
      }
      setGuides((g) => (g.x === gx && g.y === gy ? g : { x: gx, y: gy }));
      dispatch({ type: 'moveElement', index, element: el, box, key });
    };

    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      setGuides({ x: false, y: false });
      endDrag.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    endDrag.current = stop;
  };

  const onKeyDown: SlideEditing['onKeyDown'] = (el, e: KeyboardEvent<HTMLElement>, frame) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave Ctrl+Z etc. to the editor
    if (e.key === 'Escape') {
      setActiveEl(null);
      frame.blur();
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const start = currentBox(storedBox(el), frame, zoom);
    let box: ElementBox | null = null;
    if (delta[e.key]) {
      const [dx, dy] = delta[e.key];
      box = keepOnSlide({ ...start, x: start.x + dx, y: start.y + dy });
    } else if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
      const factor = (e.key === '-' || e.key === '_' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.02);
      box = { ...start, scale: clamp(start.scale + factor, MIN_ELEMENT_SCALE, MAX_ELEMENT_SCALE) };
    }
    if (!box) return;
    e.preventDefault(); // don't scroll the canvas
    setActiveEl(el);
    // A run of nudges on the same element is one undo step.
    dispatch({ type: 'moveElement', index: selected, element: el, box, key: `nudge:${selected}:${el}` });
  };

  const editing: SlideEditing = { active: activeEl, guides, zoom, onPointerDown, onKeyDown };

  const dropProps = (i: number) => ({
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setDropTarget(i);
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      dispatch({ type: 'select', index: i });
      onDropOnSlide(Array.from(e.dataTransfer.files), i);
    },
  });

  return (
    <main className="canvas">
      <div className="canvas__bar">
        <span>
          {editingSlide
            ? `Slide ${selected + 1} of ${count} · ${groupLabel} · ${size.width} × ${size.height}`
            : `Feature graphic · ${FEATURE_GRAPHIC_SIZE.width} × ${FEATURE_GRAPHIC_SIZE.height}`}
        </span>
        <div className="canvas__tools">
          <button
            type="button"
            className="icon-btn"
            aria-label="Move slide left"
            disabled={!editingSlide || selected === 0}
            onClick={() => dispatch({ type: 'moveSlide', from: selected, to: selected - 1 })}
          >
            <Icon name="left" />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Move slide right"
            disabled={!editingSlide || selected === count - 1}
            onClick={() => dispatch({ type: 'moveSlide', from: selected, to: selected + 1 })}
          >
            <Icon name="right" />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Delete slide"
            disabled={!editingSlide || count <= 1}
            onClick={() => dispatch({ type: 'removeSlide', index: selected })}
          >
            <Icon name="trash" />
          </button>
          <span className="canvas__divider" aria-hidden="true" />
          <button type="button" className="icon-btn" aria-label="Zoom out" disabled={zoomIndex === 0} onClick={() => setZoomIndex((z) => z - 1)}>
            −
          </button>
          <span className="canvas__zoom">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Zoom in"
            disabled={zoomIndex === ZOOMS.length - 1}
            onClick={() => setZoomIndex((z) => z + 1)}
          >
            +
          </button>
        </div>
      </div>

      <div className="canvas__scroll">
        <div className="canvas__row">
          {design.slides.map((s, i) =>
            i === selected && editingSlide ? (
              // The selected slide is a plain container (not a button) so its elements can be dragged.
              <div
                key={s.id}
                role="group"
                aria-label={`Slide ${i + 1}, editing`}
                className={`slide-btn is-selected ${dropTarget === i ? 'is-drop' : ''}`}
                onPointerDown={() => setActiveEl(null)} // a press on the background deselects
                {...dropProps(i)}
              >
                <SlideView design={design} slide={s} index={i} size={size} scale={zoom} editing={editing} />
              </div>
            ) : (
              <button
                key={s.id}
                type="button"
                className={`slide-btn ${dropTarget === i ? 'is-drop' : ''}`}
                aria-label={`Edit slide ${i + 1}`}
                aria-pressed={false}
                onClick={() => dispatch({ type: 'select', index: i })}
                {...dropProps(i)}
              >
                <SlideView design={design} slide={s} index={i} size={size} scale={zoom} />
              </button>
            ),
          )}
          {count < MAX_SLIDES && (
            <button
              type="button"
              className="add-slide"
              style={{ height: H * zoom }}
              onClick={() => dispatch({ type: 'addSlide' })}
            >
              <Icon name="plus" size={22} />
              Add slide
            </button>
          )}
          {showFeature && (
            <button
              type="button"
              className={`slide-btn ${featureSelected ? 'is-selected' : ''} ${dropTarget === -1 ? 'is-drop' : ''}`}
              aria-label="Edit feature graphic"
              aria-pressed={featureSelected}
              title="Google Play feature graphic (1024 × 500)"
              style={{ alignSelf: 'center' }}
              onClick={() => dispatch({ type: 'selectFeature' })}
              onDragOver={(e) => {
                e.preventDefault();
                setDropTarget(-1);
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDropTarget(null);
                dispatch({ type: 'selectFeature' });
                onDropIcon(Array.from(e.dataTransfer.files));
              }}
            >
              <FeatureGraphicView design={design} scale={zoom * FEATURE_PREVIEW_BOOST} />
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
