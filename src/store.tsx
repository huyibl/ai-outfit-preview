import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type { Category, ClothingItem, EditorMode, Outfit, WardrobeFilters } from "./types";
import { downloadJson, exportBackup, importBackup } from "./lib/backup";
import { addToCanvas, canvasItems } from "./lib/canvasRules";
import { blobToDataUrl, dataUrlToBlob, deleteImage, getImage, putImage } from "./lib/db";
import { apiFetch, errorMessage } from "./lib/apiClient";
import { generatePreview, type GenerateMode } from "./lib/generate/adapter";
import { createId } from "./lib/ids";
import { guessFromFilename } from "./lib/guessItem";
import { CUSTOM_MODEL_ID, resolveModelGender, resolveModelSrc, type ModelChoice } from "./lib/models";
import { BudgetExhaustedError } from "./lib/generate/adapter";
import { reportEvent } from "./lib/beacon";
import { countDeviceTryon, deviceQuotaLeft, DEVICE_TRYON_DAILY_LIMIT } from "./lib/deviceQuota";
import { addFeedback, summarizePreference } from "./lib/feedback";
import { seedIfNeeded } from "./lib/seed";
import { loadItems, loadOutfits, saveItems, saveOutfits } from "./lib/storage";

export interface PlanCard {
  id: string;
  styleName: string;
  occasion: string;
  itemIds: string[];
  reason: string;
  styleTags: string[];
  status: "imaging" | "done" | "failed" | "noimage";
  progressText?: string;
  url?: string;
  error?: string;
  inspired?: boolean;
  source?: "llm" | "rule";
  degradedLevel?: "qwen" | "collage";
}

export interface EmbeddedItemEntry {
  dataUrl: string;
  name?: string;
  category?: Category;
}

interface AppState {  items: ClothingItem[];
  outfits: Outfit[];
  canvasIds: string[];
  previewUrl: string | null;
  previewPrompt: string;
  previewSource: "api" | "mock" | null;
  generating: boolean;
  generateProgress: string | null;
  hydrated: boolean;
  imageUrls: Record<string, string>;
  editor: EditorMode | null;
  zoomItemId: string | null;
  notice: string | null;
  filters: WardrobeFilters;
  modelChoice: ModelChoice;
  generateMode: GenerateMode;
  customModelUrl: string | null;
  plans: PlanCard[];
  planGaps: string[];
}

type Action =
  | {
      type: "HYDRATE";
      items: ClothingItem[];
      outfits: Outfit[];
      imageUrls: Record<string, string>;
      customModelUrl?: string | null;
    }
  | { type: "UPSERT_ITEM"; item: ClothingItem; url: string }
  | { type: "DELETE_ITEM"; id: string }
  | { type: "ADD_TO_CANVAS"; id: string }
  | { type: "REMOVE_FROM_CANVAS"; id: string }
  | { type: "CLEAR_CANVAS" }
  | { type: "SET_PREVIEW"; url: string; prompt: string; source: "api" | "mock" }
  | { type: "SET_GENERATING"; value: boolean }
  | { type: "SET_GENERATE_PROGRESS"; text: string | null }
  | { type: "SAVE_OUTFIT"; outfit: Outfit }
  | { type: "LOAD_OUTFIT"; id: string }
  | {
      type: "REPLACE_ALL";
      items: ClothingItem[];
      outfits: Outfit[];
      imageUrls: Record<string, string>;
    }
  | { type: "SET_EDITOR"; editor: EditorMode | null }
  | { type: "SET_ZOOM"; id: string | null }
  | { type: "SET_NOTICE"; notice: string | null }
  | { type: "SET_FILTERS"; filters: Partial<WardrobeFilters> }
  | { type: "SET_MODEL_CHOICE"; choice: ModelChoice }
  | { type: "SET_GENERATE_MODE"; mode: GenerateMode }
  | { type: "SET_CUSTOM_MODEL"; url: string | null }
  | { type: "PATCH_ITEM_META"; id: string; patch: Partial<ClothingItem> }
  | { type: "SET_PLANS"; plans: PlanCard[]; gaps: string[] }
  | { type: "PATCH_PLAN"; id: string; patch: Partial<PlanCard> }
  | { type: "CLEAR_PLANS" };

const initialFilters: WardrobeFilters = {
  query: "",
  category: "all",
  season: "all",
  occasion: "all",
};

const initialState: AppState = {
  items: [],
  outfits: [],
  canvasIds: [],
  previewUrl: null,
  previewPrompt: "",
  previewSource: null,
  generating: false,
  generateProgress: null,
  hydrated: false,
  imageUrls: {},
  editor: null,
  zoomItemId: null,
  notice: null,
  filters: initialFilters,
  modelChoice: "auto",
  generateMode: "tryon",
  customModelUrl: null,
  plans: [],
  planGaps: [],
};

function revokeAll(urls: Record<string, string>) {
  Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "HYDRATE":
      return {
        ...state,
        items: action.items,
        outfits: action.outfits,
        imageUrls: action.imageUrls,
        customModelUrl: action.customModelUrl ?? state.customModelUrl,
        hydrated: true,
      };
    case "UPSERT_ITEM": {
      const exists = state.items.some((item) => item.id === action.item.id);
      const items = exists
        ? state.items.map((item) => (item.id === action.item.id ? action.item : item))
        : [action.item, ...state.items];
      const prev = state.imageUrls[action.item.imageId];
      if (prev && prev !== action.url) {
        URL.revokeObjectURL(prev);
      }
      return {
        ...state,
        items,
        imageUrls: { ...state.imageUrls, [action.item.imageId]: action.url },
        editor: null,
      };
    }
    case "DELETE_ITEM": {
      const target = state.items.find((item) => item.id === action.id);
      const imageUrls = { ...state.imageUrls };
      if (target) {
        const url = imageUrls[target.imageId];
        if (url) URL.revokeObjectURL(url);
        delete imageUrls[target.imageId];
      }
      return {
        ...state,
        items: state.items.filter((item) => item.id !== action.id),
        canvasIds: state.canvasIds.filter((id) => id !== action.id),
        imageUrls,
      };
    }
    case "ADD_TO_CANVAS":
      return { ...state, canvasIds: addToCanvas(state.canvasIds, state.items, action.id) };
    case "REMOVE_FROM_CANVAS":
      return { ...state, canvasIds: state.canvasIds.filter((id) => id !== action.id) };
    case "CLEAR_CANVAS":
      return { ...state, canvasIds: [], previewUrl: null, previewPrompt: "", previewSource: null };
    case "SET_PREVIEW":
      return {
        ...state,
        previewUrl: action.url,
        previewPrompt: action.prompt,
        previewSource: action.source,
        generating: false,
        generateProgress: null,
      };
    case "SET_GENERATING":
      return {
        ...state,
        generating: action.value,
        generateProgress: action.value ? state.generateProgress : null,
      };
    case "SET_GENERATE_PROGRESS":
      return { ...state, generateProgress: action.text };
    case "SAVE_OUTFIT": {
      return { ...state, outfits: [action.outfit, ...state.outfits], notice: "套装已保存" };
    }
    case "LOAD_OUTFIT": {
      const outfit = state.outfits.find((entry) => entry.id === action.id);
      if (!outfit) return state;
      return {
        ...state,
        canvasIds: outfit.itemIds.filter((id) => state.items.some((item) => item.id === id)),
        previewUrl: outfit.previewDataUrl ?? state.imageUrls[`outfit-img:${outfit.id}`] ?? null,
        previewPrompt: "",
        previewSource: null,
      };
    }
    case "REPLACE_ALL":
      revokeAll(state.imageUrls);
      return {
        ...state,
        items: action.items,
        outfits: action.outfits,
        imageUrls: action.imageUrls,
        canvasIds: [],
        previewUrl: null,
        previewPrompt: "",
        previewSource: null,
      };
    case "SET_EDITOR":
      return { ...state, editor: action.editor };
    case "SET_ZOOM":
      return { ...state, zoomItemId: action.id };
    case "SET_NOTICE":
      return { ...state, notice: action.notice };
    case "SET_FILTERS":
      return { ...state, filters: { ...state.filters, ...action.filters } };
    case "SET_MODEL_CHOICE":
      return { ...state, modelChoice: action.choice };
    case "SET_GENERATE_MODE":
      return { ...state, generateMode: action.mode };
    case "SET_CUSTOM_MODEL": {
      if (state.customModelUrl && state.customModelUrl !== action.url) {
        URL.revokeObjectURL(state.customModelUrl);
      }
      return { ...state, customModelUrl: action.url };
    }
    case "PATCH_ITEM_META":
      return {
        ...state,
        items: state.items.map((item) => (item.id === action.id ? { ...item, ...action.patch } : item)),
      };
    case "SET_PLANS":
      return { ...state, plans: action.plans, planGaps: action.gaps };
    case "PATCH_PLAN":
      return {
        ...state,
        plans: state.plans.map((plan) => (plan.id === action.id ? { ...plan, ...action.patch } : plan)),
      };
    case "CLEAR_PLANS":
      return { ...state, plans: [], planGaps: [] };
    default:
      return state;
  }
}

interface AppContextValue extends AppState {
  filteredItems: ClothingItem[];
  selectedItems: ClothingItem[];
  addToMatch: (id: string) => void;
  removeFromCanvas: (id: string) => void;
  clearCanvas: () => void;
  saveOutfit: () => void;
  loadOutfit: (id: string) => void;
  openCreate: () => void;
  openEdit: (id: string) => void;
  closeEditor: () => void;
  saveItem: (input: Omit<ClothingItem, "id" | "imageId"> & { id?: string; imageId?: string; file?: File }) => Promise<{ id: string; imageId: string }>;
  removeItem: (id: string) => Promise<void>;
  generate: () => Promise<void>;
  cancelGenerate: () => void;
  generateStylistPlans: (intent: string) => Promise<void>;
  retryPlan: (id: string) => Promise<void>;
  votePlan: (id: string, vote: 1 | -1) => void;
  exportData: () => Promise<void>;
  importData: (file: File) => Promise<void>;
  setFilters: (filters: Partial<WardrobeFilters>) => void;
  setModelChoice: (choice: ModelChoice) => void;
  setGenerateMode: (mode: GenerateMode) => void;
  setCustomModelPhoto: (file: File) => Promise<void>;
  clearCustomModelPhoto: () => Promise<void>;
  addImageFiles: (files: File[]) => Promise<void>;
  addEmbeddedItems: (entries: EmbeddedItemEntry[]) => Promise<void>;
  setZoom: (id: string | null) => void;
  clearNotice: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const generateAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = loadItems();
        const outfits = loadOutfits();
        const seeded = await seedIfNeeded(existing.length);
        const items = seeded.length > 0 ? seeded : existing;
        const imageUrls: Record<string, string> = {};
        for (const item of items) {
          const blob = await getImage(item.imageId);
          if (blob) {
            imageUrls[item.imageId] = URL.createObjectURL(blob);
          }
        }
        const customBlob = await getImage(CUSTOM_MODEL_ID);
        const customModelUrl = customBlob ? URL.createObjectURL(customBlob) : null;
        for (const outfit of outfits) {
          const blob = await getImage(`outfit-img:${outfit.id}`);
          if (blob) {
            imageUrls[`outfit-img:${outfit.id}`] = URL.createObjectURL(blob);
          }
        }
        if (!cancelled) {
          dispatch({ type: "HYDRATE", items, outfits, imageUrls, customModelUrl });
        }
      } catch (error) {
        if (!cancelled) {
          dispatch({
            type: "HYDRATE",
            items: [],
            outfits: [],
            imageUrls: {},
          });
          dispatch({
            type: "SET_NOTICE",
            notice: error instanceof Error ? error.message : "初始化失败",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    saveItems(state.items);
    saveOutfits(state.outfits);
    // 备份提醒的"有改动"标记：内容指纹变化才标脏
    try {
      const fingerprint = JSON.stringify(state.items.map((item) => [item.id, item.name, item.category]));
      if (localStorage.getItem("ai-outfit-preview:items-fingerprint") !== fingerprint) {
        localStorage.setItem("ai-outfit-preview:items-fingerprint", fingerprint);
        localStorage.setItem("ai-outfit-preview:backup-dirty", "1");
      }
    } catch {
      // 忽略
    }
  }, [state.hydrated, state.items, state.outfits]);

  // 备份提醒：距上次备份>7天 且 有改动 且 距上次忽略>7天（每周最多一次）
  useEffect(() => {
    if (!state.hydrated) return;
    try {
      const now = Date.now();
      const day = 86_400_000;
      const dirty = localStorage.getItem("ai-outfit-preview:backup-dirty") === "1";
      const lastBackup = Number(localStorage.getItem("ai-outfit-preview:last-backup") || 0);
      const lastDismiss = Number(localStorage.getItem("ai-outfit-preview:backup-dismissed") || 0);
      if (dirty && now - lastBackup > 7 * day && now - lastDismiss > 7 * day) {
        localStorage.setItem("ai-outfit-preview:backup-dismissed", String(now));
        dispatch({
          type: "SET_NOTICE",
          notice: `衣橱里有 ${state.items.length} 件单品且近期有改动，建议点右上角「导出备份」防止清缓存丢失`,
        });
      }
    } catch {
      // 忽略
    }
  }, [state.hydrated, state.items.length]);

  useEffect(() => {
    if (!state.notice) return;
    const timer = window.setTimeout(() => dispatch({ type: "SET_NOTICE", notice: null }), 3600);
    return () => window.clearTimeout(timer);
  }, [state.notice]);

  const filteredItems = useMemo(() => {
    const q = state.filters.query.trim().toLowerCase();
    return state.items.filter((item) => {
      if (state.filters.category !== "all" && item.category !== state.filters.category) return false;
      if (state.filters.season !== "all" && item.season !== "all" && item.season !== state.filters.season) {
        return false;
      }
      if (
        state.filters.occasion !== "all" &&
        item.occasion !== "all" &&
        item.occasion !== state.filters.occasion
      ) {
        return false;
      }
      if (!q) return true;
      return [item.name, item.color, item.notes ?? ""].join(" ").toLowerCase().includes(q);
    });
  }, [state.items, state.filters]);

  const selectedItems = useMemo(
    () => canvasItems(state.canvasIds, state.items),
    [state.canvasIds, state.items],
  );

  const addToMatch = useCallback((id: string) => dispatch({ type: "ADD_TO_CANVAS", id }), []);
  const removeFromCanvas = useCallback(
    (id: string) => dispatch({ type: "REMOVE_FROM_CANVAS", id }),
    [],
  );
  const clearCanvas = useCallback(() => dispatch({ type: "CLEAR_CANVAS" }), []);
  const saveOutfit = useCallback(() => {
    const selected = canvasItems(state.canvasIds, state.items);
    if (selected.length === 0) {
      dispatch({ type: "SET_NOTICE", notice: "请先在搭配区加入单品" });
      return;
    }
    const outfit: Outfit = {
      id: createId("outfit"),
      itemIds: [...state.canvasIds],
      createdAt: new Date().toISOString(),
    };
    void (async () => {
      // 预览图进 IndexedDB（key: outfit-img:<id>），localStorage 只存轻量套装记录
      if (state.previewUrl) {
        try {
          const blob = await (await fetch(state.previewUrl)).blob();
          await putImage(`outfit-img:${outfit.id}`, blob);
        } catch {
          // 图存不下就只存搭配本身
        }
      }
      dispatch({ type: "SAVE_OUTFIT", outfit });
    })();
  }, [state.canvasIds, state.items, state.previewUrl]);
  const loadOutfit = useCallback((id: string) => dispatch({ type: "LOAD_OUTFIT", id }), []);
  const openCreate = useCallback(() => dispatch({ type: "SET_EDITOR", editor: { kind: "create" } }), []);
  const openEdit = useCallback(
    (id: string) => dispatch({ type: "SET_EDITOR", editor: { kind: "edit", id } }),
    [],
  );
  const closeEditor = useCallback(() => dispatch({ type: "SET_EDITOR", editor: null }), []);
  const setFilters = useCallback(
    (filters: Partial<WardrobeFilters>) => dispatch({ type: "SET_FILTERS", filters }),
    [],
  );
  const setModelChoice = useCallback(
    (choice: ModelChoice) => dispatch({ type: "SET_MODEL_CHOICE", choice }),
    [],
  );
  const setGenerateMode = useCallback(
    (mode: GenerateMode) => dispatch({ type: "SET_GENERATE_MODE", mode }),
    [],
  );
  const setZoom = useCallback((id: string | null) => dispatch({ type: "SET_ZOOM", id }), []);
  const clearNotice = useCallback(() => dispatch({ type: "SET_NOTICE", notice: null }), []);

  const saveItem = useCallback(
    async (input: Omit<ClothingItem, "id" | "imageId"> & { id?: string; imageId?: string; file?: File }): Promise<{ id: string; imageId: string }> => {
      const id = input.id ?? createId("item");
      const imageId = input.imageId ?? createId("img");
      let url = state.imageUrls[imageId];
      if (input.file) {
        await putImage(imageId, input.file);
        url = URL.createObjectURL(input.file);
      }
      if (!url) {
        throw new Error("请上传衣服图片");
      }
      dispatch({
        type: "UPSERT_ITEM",
        item: {
          id,
          imageId,
          name: input.name,
          category: input.category,
          color: input.color,
          season: input.season,
          occasion: input.occasion,
          notes: input.notes,
          style: input.style,
          material: input.material,
          fit: input.fit,
          pattern: input.pattern,
        },
        url,
      });
      return { id, imageId };
    },
    [state.imageUrls],
  );

  const addImageFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((file) => file.type.startsWith("image/"));
      if (images.length === 0) {
        dispatch({ type: "SET_NOTICE", notice: "请选择图片文件" });
        return;
      }
      const saved: Array<{ id: string; imageId: string; file: File }> = [];
      for (const file of images) {
        const guessed = guessFromFilename(file.name);
        const record = await saveItem({
          name: guessed.name,
          category: guessed.category,
          color: guessed.color,
          season: "all",
          occasion: "daily",
          file,
        });
        saved.push({ ...record, file });
      }
      dispatch({
        type: "SET_NOTICE",
        notice: `已导入 ${images.length} 件，可点「编辑」补全品类颜色`,
      });
      // AI 自动打标（风格/材质/版型/图案），失败静默，用户可手动编辑
      void (async () => {
        for (const record of saved) {
          try {
            const imageDataUrl = await blobToDataUrl(record.file);
            const tag = await apiFetch<{ style?: string; material?: string; fit?: string; pattern?: string }>(
              "/api/v1/tag",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ imageDataUrl }),
              },
            );
            if (!tag.ok) continue;
            const patch: Partial<ClothingItem> = {};
            if (tag.data.style) patch.style = tag.data.style;
            if (tag.data.material) patch.material = tag.data.material;
            if (tag.data.fit) patch.fit = tag.data.fit;
            if (tag.data.pattern) patch.pattern = tag.data.pattern;
            if (Object.keys(patch).length > 0) {
              dispatch({ type: "PATCH_ITEM_META", id: record.id, patch });
            }
          } catch {
            // 打标失败不影响导入
          }
        }
      })();
    },
    [saveItem],
  );

  const addEmbeddedItems = useCallback(
    async (entries: EmbeddedItemEntry[]) => {
      let added = 0;
      for (const entry of entries) {
        if (typeof entry?.dataUrl !== "string" || !entry.dataUrl.startsWith("data:image/")) continue;
        try {
          const blob = dataUrlToBlob(entry.dataUrl);
          const file = new File([blob], entry.name || `embed-item-${added + 1}.png`, {
            type: blob.type || "image/png",
          });
          const guessed = guessFromFilename(file.name);
          await saveItem({
            name: entry.name || guessed.name,
            category: entry.category || guessed.category,
            color: guessed.color,
            season: "all",
            occasion: "daily",
            file,
          });
          added += 1;
        } catch {
          // 跳过宿主页给的坏数据
        }
      }
      if (added > 0) {
        dispatch({ type: "SET_NOTICE", notice: `已从宿主页导入 ${added} 件单品` });
      }
    },
    [saveItem],
  );

  const removeItem = useCallback(async (id: string) => {
    const item = state.items.find((entry) => entry.id === id);
    if (item) {
      await deleteImage(item.imageId);
    }
    dispatch({ type: "DELETE_ITEM", id });
  }, [state.items]);

  const setCustomModelPhoto = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      dispatch({ type: "SET_NOTICE", notice: "请选择图片文件" });
      return;
    }
    const preview = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("图片无法读取"));
        el.src = preview;
      });
      const { analyzeBody, assertFullBody } = await import("./lib/generate/pose");
      const error = assertFullBody(await analyzeBody(image));
      if (error) {
        URL.revokeObjectURL(preview);
        dispatch({ type: "SET_NOTICE", notice: error });
        return;
      }
      await putImage(CUSTOM_MODEL_ID, file);
      dispatch({ type: "SET_CUSTOM_MODEL", url: preview });
      dispatch({ type: "SET_NOTICE", notice: "已使用你的全身照作为模特" });
    } catch (error) {
      URL.revokeObjectURL(preview);
      dispatch({
        type: "SET_NOTICE",
        notice: error instanceof Error ? error.message : "上传模特失败",
      });
    }
  }, []);

  const clearCustomModelPhoto = useCallback(async () => {
    await deleteImage(CUSTOM_MODEL_ID);
    dispatch({ type: "SET_CUSTOM_MODEL", url: null });
    dispatch({ type: "SET_NOTICE", notice: "已改回默认模特" });
  }, []);

  const generate = useCallback(async () => {
    if (state.generateMode === "stylist") {
      // 帮我搭由 generateStylistPlans 编排
      return;
    }
    if (selectedItems.length === 0) {
      dispatch({ type: "SET_NOTICE", notice: "请先在搭配区加入单品" });
      return;
    }
    const isTryonRun = state.generateMode === "tryon";
    if (isTryonRun && deviceQuotaLeft() <= 0) {
      dispatch({
        type: "SET_NOTICE",
        notice: `今日 AI 试衣次数已用完（${DEVICE_TRYON_DAILY_LIMIT} 次），明天恢复`,
      });
      return;
    }
    dispatch({ type: "SET_GENERATING", value: true });
    const controller = new AbortController();
    generateAbortRef.current = controller;
    // 总超时：试衣两轮最长约 4 分钟，其余路径远快于此
    const timeout = window.setTimeout(
      () => controller.abort(new DOMException("生成超时", "TimeoutError")),
      300_000,
    );
    let budgetHit = false;
    try {
      const gender = resolveModelGender(state.modelChoice, selectedItems);
      const result = await generatePreview(selectedItems, state.imageUrls, {
        gender,
        modelSrc: state.customModelUrl ?? (await resolveModelSrc(gender)),
        mode: state.generateMode,
        signal: controller.signal,
        onProgress: (text) => dispatch({ type: "SET_GENERATE_PROGRESS", text }),
      });
      dispatch({
        type: "SET_PREVIEW",
        url: result.url,
        prompt: result.prompt,
        source: result.source,
      });
      if (result.degradedLevel) {
        reportEvent({ event: "tryon_degraded", level: result.degradedLevel, mode: "single" });
      }
      if (result.warning) {
        dispatch({ type: "SET_NOTICE", notice: result.warning });
      } else if (result.source === "api") {
        dispatch({
          type: "SET_NOTICE",
          notice:
            state.generateMode === "tryon"
              ? "虚拟试衣已完成"
              : state.generateMode === "img2img"
                ? `分层换装已完成（约 ¥0.30 × ${selectedItems.length} 件）`
                : "文生图已完成（Kolors 免费）",
        });
      }
    } catch (error) {
      if (error instanceof BudgetExhaustedError) budgetHit = true;
      if (controller.signal.aborted) {
        const timeoutHit = controller.signal.reason instanceof DOMException && controller.signal.reason.name === "TimeoutError";
        dispatch({ type: "SET_NOTICE", notice: timeoutHit ? "生成超时，请稍后重试" : "已取消生成" });
      } else {
        dispatch({
          type: "SET_NOTICE",
          notice: error instanceof Error ? error.message : "生成失败",
        });
      }
    } finally {
      window.clearTimeout(timeout);
      generateAbortRef.current = null;
      // 设备层配额：只在真实消耗试衣时计数；全局预算耗尽（服务端连坐）不计数
      if (isTryonRun && !budgetHit) countDeviceTryon();
    }
  }, [selectedItems, state.imageUrls, state.modelChoice, state.generateMode, state.customModelUrl]);

  const runPlan = useCallback(
    async (plan: PlanCard, signal: AbortSignal) => {
      let budgetHit = false;
      const items = plan.itemIds
        .map((id) => state.items.find((item) => item.id === id))
        .filter((item): item is ClothingItem => Boolean(item));
      if (items.length === 0) {
        dispatch({ type: "PATCH_PLAN", id: plan.id, patch: { status: "failed", error: "单品图片缺失" } });
        return;
      }
      dispatch({
        type: "PATCH_PLAN",
        id: plan.id,
        patch: { status: "imaging", progressText: "搭配上身中…", error: undefined },
      });
      const urls: Record<string, string> = {};
      for (const item of items) {
        const url = state.imageUrls[item.imageId];
        if (url) urls[item.imageId] = url;
      }
      const gender = resolveModelGender(state.modelChoice, items);
      try {
        const modelSrc = state.customModelUrl ?? (await resolveModelSrc(gender));
        const result = await generatePreview(items, urls, {
          gender,
          modelSrc,
          mode: "tryon",
          signal,
          onProgress: (text) => dispatch({ type: "PATCH_PLAN", id: plan.id, patch: { progressText: text } }),
        });
        if (result.qualityFailed) {
          dispatch({
            type: "PATCH_PLAN",
            id: plan.id,
            patch: { status: "noimage", error: "这套出图效果未达标，可点击重试" },
          });
        } else {
          if (result.degradedLevel) {
            reportEvent({ event: "tryon_degraded", level: result.degradedLevel, mode: "stylist" });
          }
          dispatch({
            type: "PATCH_PLAN",
            id: plan.id,
            patch: {
              status: "done",
              url: result.url,
              progressText: undefined,
              degradedLevel: result.degradedLevel,
            },
          });
        }
      } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof BudgetExhaustedError) {
          budgetHit = true;
          dispatch({ type: "PATCH_PLAN", id: plan.id, patch: { progressText: "试衣额度已用完，出灵感图…" } });
          try {
            const modelSrc = state.customModelUrl ?? (await resolveModelSrc(gender));
            const result = await generatePreview(items, urls, { gender, modelSrc, mode: "txt2img", signal });
            dispatch({
              type: "PATCH_PLAN",
              id: plan.id,
              patch: { status: "done", url: result.url, inspired: true },
            });
          } catch (fallbackError) {
            if (signal.aborted) throw fallbackError;
            dispatch({
              type: "PATCH_PLAN",
              id: plan.id,
              patch: { status: "failed", error: "今日试衣额度已用完" },
            });
          }
          return;
        }
        dispatch({
          type: "PATCH_PLAN",
          id: plan.id,
          patch: { status: "failed", error: error instanceof Error ? error.message : "生成失败" },
        });
      } finally {
        // 设备层配额按套计数；全局预算耗尽（服务端连坐）不计数
        if (!budgetHit) countDeviceTryon();
      }
    },
    [state.items, state.imageUrls, state.modelChoice, state.customModelUrl],
  );

  const generateStylistPlans = useCallback(
    async (intent: string) => {
      if (state.items.length === 0) {
        dispatch({ type: "SET_NOTICE", notice: "衣橱还是空的，先导入几件单品" });
        return;
      }
      if (!intent.trim()) {
        dispatch({ type: "SET_NOTICE", notice: "说说场合或想要的感觉，比如：秋天通勤显干净" });
        return;
      }
      if (deviceQuotaLeft() <= 0) {
        dispatch({
          type: "SET_NOTICE",
          notice: `今日 AI 试衣次数已用完（${DEVICE_TRYON_DAILY_LIMIT} 次），明天恢复`,
        });
        return;
      }
      dispatch({ type: "SET_GENERATING", value: true });
      dispatch({ type: "CLEAR_PLANS" });
      const controller = new AbortController();
      generateAbortRef.current = controller;
      const timeout = window.setTimeout(
        () => controller.abort(new DOMException("生成超时", "TimeoutError")),
        600_000,
      );
      try {
        const pref = summarizePreference();
        const wardrobe = state.items.map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          color: item.color,
          style: item.style,
          material: item.material,
          fit: item.fit,
          pattern: item.pattern,
          season: item.season,
          occasion: item.occasion,
          notes: item.notes,
        }));
        const response = await apiFetch<{
          outfits?: Array<{ styleName: string; occasion: string; itemIds: string[]; reason: string; styleTags: string[] }>;
          wardrobeGaps?: string[];
          mode?: "llm" | "rule" | "inspire";
        }>("/api/v1/stylist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent, outfitCount: 3, wardrobe, preference: pref.summary }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(errorMessage(response));
        }
        const outfits = response.data.outfits ?? [];
        if (outfits.length === 0) {
          dispatch({ type: "SET_NOTICE", notice: "没能组合出方案，试试补几件衣服或换个说法" });
          dispatch({ type: "SET_GENERATING", value: false });
          return;
        }
        const plans: PlanCard[] = outfits.map((outfit, index) => ({
          id: "plan-" + index + "-" + Date.now(),
          styleName: outfit.styleName || "方案 " + (index + 1),
          occasion: outfit.occasion || "daily",
          itemIds: outfit.itemIds,
          reason: outfit.reason,
          styleTags: outfit.styleTags,
          status: "imaging",
          progressText: "排队中",
          source: response.data.mode === "llm" ? "llm" : "rule",
        }));
        dispatch({ type: "SET_PLANS", plans, gaps: response.data.wardrobeGaps ?? [] });
        const queue = [...plans];
        const worker = async () => {
          while (queue.length > 0) {
            const plan = queue.shift();
            if (!plan) break;
            await runPlan(plan, controller.signal);
          }
        };
        await Promise.all([worker(), worker()]);
        dispatch({ type: "SET_NOTICE", notice: "搭配方案已生成，点👍👎帮我更懂你" });
      } catch (error) {
        if (controller.signal.aborted) {
          const timeoutHit =
            controller.signal.reason instanceof DOMException && controller.signal.reason.name === "TimeoutError";
          dispatch({ type: "SET_NOTICE", notice: timeoutHit ? "生成超时，请稍后重试" : "已取消生成" });
        } else {
          dispatch({ type: "SET_NOTICE", notice: error instanceof Error ? error.message : "搭配失败" });
        }
      } finally {
        window.clearTimeout(timeout);
        generateAbortRef.current = null;
        dispatch({ type: "SET_GENERATING", value: false });
      }
    },
    [state.items, state.modelChoice, state.customModelUrl, runPlan],
  );

  const retryPlan = useCallback(
    async (id: string) => {
      const plan = state.plans.find((entry) => entry.id === id);
      if (!plan || plan.status === "imaging") return;
      dispatch({ type: "SET_GENERATING", value: true });
      const controller = new AbortController();
      generateAbortRef.current = controller;
      try {
        await runPlan(plan, controller.signal);
      } catch {
        // runPlan 内部已处理失败展示
      } finally {
        generateAbortRef.current = null;
        dispatch({ type: "SET_GENERATING", value: false });
      }
    },
    [state.plans, runPlan],
  );

  const votePlan = useCallback(
    (id: string, vote: 1 | -1) => {
      const plan = state.plans.find((entry) => entry.id === id);
      if (!plan) return;
      addFeedback(vote, plan.styleTags, plan.occasion);
      dispatch({ type: "SET_NOTICE", notice: vote === 1 ? "已记下你的喜好" : "好的，这类搭配会少推荐" });
    },
    [state.plans],
  );

  const cancelGenerate = useCallback(() => {
    generateAbortRef.current?.abort(new DOMException("用户取消", "AbortError"));
  }, []);

  const exportData = useCallback(async () => {
    const backup = await exportBackup(state.items, state.outfits);
    downloadJson(`outfit-backup-${new Date().toISOString().slice(0, 10)}.json`, backup);
    try {
      localStorage.setItem("ai-outfit-preview:last-backup", String(Date.now()));
      localStorage.setItem("ai-outfit-preview:backup-dirty", "0");
    } catch {
      // 忽略
    }
    dispatch({ type: "SET_NOTICE", notice: "备份已导出" });
  }, [state.items, state.outfits]);

  const importData = useCallback(async (file: File) => {
    const raw = await file.text();
    const next = await importBackup(raw);
    dispatch({
      type: "REPLACE_ALL",
      items: next.items,
      outfits: next.outfits,
      imageUrls: next.imageUrls,
    });
    // 导入可能覆盖或保留了 IndexedDB 里的模特照，重新读取以同步显示
    const customBlob = await getImage(CUSTOM_MODEL_ID);
    dispatch({ type: "SET_CUSTOM_MODEL", url: customBlob ? URL.createObjectURL(customBlob) : null });
    dispatch({ type: "SET_NOTICE", notice: "备份已导入" });
  }, []);

  const value: AppContextValue = {
    ...state,
    filteredItems,
    selectedItems,
    addToMatch,
    removeFromCanvas,
    clearCanvas,
    saveOutfit,
    loadOutfit,
    openCreate,
    openEdit,
    closeEditor,
    saveItem,
    removeItem,
    generate,
    cancelGenerate,
    generateStylistPlans,
    retryPlan,
    votePlan,
    exportData,
    importData,
    setFilters,
    setModelChoice,
    setGenerateMode,
    setCustomModelPhoto,
    clearCustomModelPhoto,
    addImageFiles,
    addEmbeddedItems,
    setZoom,
    clearNotice,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) {
    throw new Error("useApp must be used within AppProvider");
  }
  return value;
}
