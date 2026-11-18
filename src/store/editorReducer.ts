import { MAX_SLIDES, makeSlide, projectBackdrop, storeDefaults, textFor } from '@/lib/constants';
import type { Backdrop, Design, ElementBox, FeatureGraphic, SlideElement, Store } from '@/lib/types';

const HISTORY_LIMIT = 60;

export const MIN_ELEMENT_SCALE = 0.2;
export const MAX_ELEMENT_SCALE = 4;

const BOX_FIELD = { text: 'textBox', device: 'deviceBox' } as const;

/** Rounds to `decimals` places without float noise (194.23, not 194.23000000000002). */
const round = (n: number, decimals: number) => Number(n.toFixed(decimals));

/** Keeps stored boxes small and sane (finite numbers, scale in range, rotate in -180..180). */
function cleanBox(b: ElementBox): ElementBox {
  const finite = (n: number, fallback: number) => (Number.isFinite(n) ? n : fallback);
  const rotate = ((((finite(b.rotate, 0) + 180) % 360) + 360) % 360) - 180;
  return {
    // 0.01 units ≈ 0.03 px even at the largest export size: invisible, but keeps JSON short.
    x: round(finite(b.x, 0), 2),
    y: round(finite(b.y, 0), 2),
    scale: round(Math.min(MAX_ELEMENT_SCALE, Math.max(MIN_ELEMENT_SCALE, finite(b.scale, 1))), 3),
    rotate: round(rotate, 1),
  };
}

export interface EditorState {
  design: Design;
  selected: number;
  past: Design[];
  future: Design[];
  /** Consecutive edits with the same key merge into one undo step (typing). */
  lastKey: string | null;
  /** The Google Play feature graphic is selected instead of a slide (Play projects only). */
  featureSelected: boolean;
}

const EMPTY_FEATURE: FeatureGraphic = { headline: {}, iconUrl: null, iconPath: null };

export type EditorAction =
  | { type: 'load'; design: Design }
  /** `key`: consecutive sets with the same key merge into one undo step (e.g. dragging a colour picker). */
  | { type: 'set'; patch: Partial<Design>; key?: string }
  | { type: 'setStore'; store: Store }
  | { type: 'select'; index: number }
  | { type: 'setText'; field: 'headline' | 'subtitle'; value: string }
  | { type: 'addSlide' }
  | { type: 'removeSlide'; index: number }
  | { type: 'moveSlide'; from: number; to: number }
  | { type: 'setImages'; images: { url: string; path: string | null }[]; startIndex: number }
  | { type: 'clearImage'; index: number }
  /** `key`: moves with the same key merge into one undo step (one drag, or a run of arrow-key nudges). */
  | { type: 'moveElement'; index: number; element: SlideElement; box: ElementBox; key?: string }
  /** Back to the design's default layout for one slide. */
  | { type: 'resetLayout'; index: number }
  | { type: 'addLocale'; code: string }
  | { type: 'removeLocale'; code: string }
  | { type: 'setLocale'; code: string }
  /**
   * Change the background of the whole project or of one slide (its override).
   * A slide override starts as a copy of the project background. `key` merges colour-picker drags.
   */
  | { type: 'setBackdrop'; target: 'project' | number; patch: Partial<Backdrop>; key?: string }
  /** Slide goes back to the project background. */
  | { type: 'clearSlideBackdrop'; index: number }
  /** Fills one locale's headline/subtitle from an auto-translation (one undo step). */
  | { type: 'applyTranslation'; locale: string; slides: { id: string; headline: string; subtitle: string }[] }
  | { type: 'selectFeature' }
  | { type: 'setFeatureText'; value: string }
  | { type: 'setFeatureIcon'; url: string | null; path: string | null }
  | { type: 'undo' }
  | { type: 'redo' };

export const initEditor = (design: Design): EditorState => ({
  design,
  selected: 0,
  past: [],
  future: [],
  lastKey: null,
  featureSelected: false,
});

/** Applies a design change and records an undo step. */
function commit(state: EditorState, design: Design, key: string | null = null, selected = state.selected): EditorState {
  const merge = key !== null && key === state.lastKey;
  return {
    design,
    selected: Math.max(0, Math.min(selected, design.slides.length - 1)),
    past: merge ? state.past : [...state.past, state.design].slice(-HISTORY_LIMIT),
    future: [],
    lastKey: key,
    // The feature graphic only exists for Google Play.
    featureSelected: state.featureSelected && design.store === 'play',
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const d = state.design;

  switch (action.type) {
    case 'load':
      return initEditor(action.design);

    case 'set':
      return commit(state, { ...d, ...action.patch }, action.key ?? null);

    case 'setStore':
      if (action.store === d.store) return state;
      return commit(state, { ...d, store: action.store, ...storeDefaults(action.store) });

    case 'select':
      return { ...state, selected: action.index, lastKey: null, featureSelected: false };

    case 'setBackdrop': {
      const { target, patch } = action;
      if (target === 'project') {
        const next: Design = { ...d };
        if ('color' in patch && patch.color) next.background = patch.color;
        if ('gradient' in patch) next.gradient = patch.gradient ?? null;
        if ('image' in patch) next.backgroundImage = patch.image ?? null;
        return commit(state, next, action.key ?? null);
      }
      const slide = d.slides[target];
      if (!slide) return state;
      const backdrop: Backdrop = { ...(slide.backdrop ?? projectBackdrop(d)), ...patch };
      const slides = d.slides.map((s, i) => (i === target ? { ...s, backdrop } : s));
      return commit(state, { ...d, slides }, action.key ?? null, target);
    }

    case 'clearSlideBackdrop': {
      const slide = d.slides[action.index];
      if (!slide?.backdrop) return state;
      const slides = d.slides.map((s, i) => {
        if (i !== action.index) return s;
        const { backdrop: _b, ...rest } = s; // eslint-disable-line @typescript-eslint/no-unused-vars
        return rest;
      });
      return commit(state, { ...d, slides }, null, action.index);
    }

    case 'applyTranslation': {
      if (!d.locales.includes(action.locale)) return state;
      const byId = new Map(action.slides.map((t) => [t.id, t]));
      let changed = false;
      const slides = d.slides.map((s) => {
        const t = byId.get(s.id);
        if (!t) return s; // slide added after the translation started: leave it
        changed = true;
        return {
          ...s,
          headline: { ...s.headline, [action.locale]: t.headline },
          subtitle: { ...s.subtitle, [action.locale]: t.subtitle },
        };
      });
      return changed ? commit(state, { ...d, slides }) : state;
    }

    case 'selectFeature':
      if (d.store !== 'play') return state;
      return { ...state, featureSelected: true, lastKey: null };

    case 'setFeatureText': {
      const fg = d.featureGraphic ?? EMPTY_FEATURE;
      const featureGraphic = { ...fg, headline: { ...fg.headline, [d.activeLocale]: action.value } };
      return commit(state, { ...d, featureGraphic }, `feature:${d.activeLocale}`);
    }

    case 'setFeatureIcon': {
      const featureGraphic = { ...(d.featureGraphic ?? EMPTY_FEATURE), iconUrl: action.url, iconPath: action.path };
      return commit(state, { ...d, featureGraphic });
    }

    case 'setText': {
      const slides = d.slides.map((s, i) =>
        i === state.selected ? { ...s, [action.field]: { ...s[action.field], [d.activeLocale]: action.value } } : s,
      );
      return commit(state, { ...d, slides }, `text:${state.selected}:${action.field}:${d.activeLocale}`);
    }

    case 'addSlide': {
      if (d.slides.length >= MAX_SLIDES) return state;
      const slide = makeSlide('New headline', 'Supporting line', d.activeLocale);
      return { ...commit(state, { ...d, slides: [...d.slides, slide] }, null, d.slides.length), featureSelected: false };
    }

    case 'removeSlide': {
      if (d.slides.length <= 1) return state;
      const slides = d.slides.filter((_, i) => i !== action.index);
      return commit(state, { ...d, slides }, null, Math.min(state.selected, slides.length - 1));
    }

    case 'moveSlide': {
      const { from, to } = action;
      if (to < 0 || to >= d.slides.length || from === to) return state;
      const slides = [...d.slides];
      const [moved] = slides.splice(from, 1);
      slides.splice(to, 0, moved);
      return commit(state, { ...d, slides }, null, to);
    }

    case 'setImages': {
      const slides = [...d.slides];
      action.images.forEach((img, k) => {
        const i = action.startIndex + k;
        if (i >= MAX_SLIDES) return;
        if (i >= slides.length) {
          const copy = textFor(slides[slides.length - 1]?.headline ?? {}, d.activeLocale);
          slides.push(makeSlide(copy || 'New headline', 'Supporting line', d.activeLocale));
        }
        slides[i] = { ...slides[i], imageUrl: img.url, imagePath: img.path };
      });
      return { ...commit(state, { ...d, slides }), featureSelected: false };
    }

    case 'clearImage': {
      const slides = d.slides.map((s, i) => (i === action.index ? { ...s, imageUrl: null, imagePath: null } : s));
      return commit(state, { ...d, slides });
    }

    case 'moveElement': {
      const target = d.slides[action.index];
      if (!target) return state;
      const field = BOX_FIELD[action.element];
      const box = cleanBox(action.box);
      const prev = target[field];
      if (prev && prev.x === box.x && prev.y === box.y && prev.scale === box.scale && prev.rotate === box.rotate) {
        return state;
      }
      const slides = d.slides.map((s, i) => (i === action.index ? { ...s, [field]: box } : s));
      return commit(state, { ...d, slides }, action.key ?? null, action.index);
    }

    case 'resetLayout': {
      const target = d.slides[action.index];
      if (!target || (!target.textBox && !target.deviceBox)) return state;
      const slides = d.slides.map((s, i) => {
        if (i !== action.index) return s;
        const { textBox: _t, deviceBox: _d, ...rest } = s; // eslint-disable-line @typescript-eslint/no-unused-vars
        return rest;
      });
      return commit(state, { ...d, slides }, null, action.index);
    }

    case 'addLocale': {
      if (d.locales.includes(action.code)) return { ...state, design: { ...d, activeLocale: action.code } };
      // Start the new language with a copy of the current text, ready to translate.
      const slides = d.slides.map((s) => ({
        ...s,
        headline: { ...s.headline, [action.code]: textFor(s.headline, d.activeLocale) },
        subtitle: { ...s.subtitle, [action.code]: textFor(s.subtitle, d.activeLocale) },
      }));
      const featureGraphic = d.featureGraphic && {
        ...d.featureGraphic,
        headline: { ...d.featureGraphic.headline, [action.code]: textFor(d.featureGraphic.headline, d.activeLocale) },
      };
      return commit(state, {
        ...d,
        slides,
        locales: [...d.locales, action.code],
        activeLocale: action.code,
        ...(featureGraphic ? { featureGraphic } : {}),
      });
    }

    case 'removeLocale': {
      if (d.locales.length <= 1) return state;
      const locales = d.locales.filter((l) => l !== action.code);
      const slides = d.slides.map((s) => {
        const headline = { ...s.headline };
        const subtitle = { ...s.subtitle };
        delete headline[action.code];
        delete subtitle[action.code];
        return { ...s, headline, subtitle };
      });
      const activeLocale = d.activeLocale === action.code ? locales[0] : d.activeLocale;
      let featureGraphic = d.featureGraphic;
      if (featureGraphic) {
        const headline = { ...featureGraphic.headline };
        delete headline[action.code];
        featureGraphic = { ...featureGraphic, headline };
      }
      return commit(state, { ...d, slides, locales, activeLocale, ...(featureGraphic ? { featureGraphic } : {}) });
    }

    case 'setLocale':
      return { ...state, design: { ...d, activeLocale: action.code }, lastKey: null };

    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        design: prev,
        selected: Math.min(state.selected, prev.slides.length - 1),
        past: state.past.slice(0, -1),
        future: [state.design, ...state.future],
        lastKey: null,
        featureSelected: state.featureSelected && prev.store === 'play',
      };
    }

    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        design: next,
        selected: Math.min(state.selected, next.slides.length - 1),
        past: [...state.past, state.design],
        future: state.future.slice(1),
        lastKey: null,
        featureSelected: state.featureSelected && next.store === 'play',
      };
    }
  }
}
