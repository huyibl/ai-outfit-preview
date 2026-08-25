import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type { ClothingItem, EditorMode, Outfit, WardrobeFilters } from "./types";
import { downloadJson, exportBackup, importBackup } from "./lib/backup";
import { addToCanvas, canvasItems } from "./lib/canvasRules";
import { deleteImage, getImage, putImage } from "./lib/db";
import { generatePreview, type GenerateMode } from "./lib/generate/adapter";
import { createId } from "./lib/ids";
import { guessFromFilename } from "./lib/guessItem";
import { resolveModelGender, resolveModelSrc, type ModelChoice } from "./lib/models";
import { seedIfNeeded } from "./lib/seed";
import { loadItems, loadOutfits, saveItems, saveOutfits } from "./lib/storage";

interface AppState {
  items: ClothingItem[];
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
}

type Action =
  | {
      type: "HYDRATE";
      items: ClothingItem[];
      outfits: Outfit[];
      imageUrls: Record<string, string>;
    }
  | { type: "UPSERT_ITEM"; item: ClothingItem; url: string }
  | { type: "DELETE_ITEM"; id: string }
  | { type: "ADD_TO_CANVAS"; id: string }
  | { type: "REMOVE_FROM_CANVAS"; id: string }
  | { type: "CLEAR_CANVAS" }
  | { type: "SET_PREVIEW"; url: string; prompt: string; source: "api" | "mock" }
  | { type: "SET_GENERATING"; value: boolean }
  | { type: "SET_GENERATE_PROGRESS"; text: string | null }
  | { type: "SAVE_OUTFIT" }
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
  | { type: "SET_GENERATE_MODE"; mode: GenerateMode };

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
      const selected = canvasItems(state.canvasIds, state.items);
      if (selected.length === 0) {
        return { ...state, notice: "请先在搭配区加入单品" };
      }
      const outfit: Outfit = {
        id: createId("outfit"),
        itemIds: [...state.canvasIds],
        previewDataUrl: state.previewUrl ?? undefined,
        createdAt: new Date().toISOString(),
      };
      return { ...state, outfits: [outfit, ...state.outfits], notice: "套装已保存" };
    }
    case "LOAD_OUTFIT": {
      const outfit = state.outfits.find((entry) => entry.id === action.id);
      if (!outfit) return state;
      return {
        ...state,
        canvasIds: outfit.itemIds.filter((id) => state.items.some((item) => item.id === id)),
        previewUrl: outfit.previewDataUrl ?? null,
        previewPrompt: "",
        previewSource: outfit.previewDataUrl ? state.previewSource : null,
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
  saveItem: (input: Omit<ClothingItem, "id" | "imageId"> & { id?: string; imageId?: string; file?: File }) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  generate: () => Promise<void>;
  exportData: () => Promise<void>;
  importData: (file: File) => Promise<void>;
  setFilters: (filters: Partial<WardrobeFilters>) => void;
  setModelChoice: (choice: ModelChoice) => void;
  setGenerateMode: (mode: GenerateMode) => void;
  addImageFiles: (files: File[]) => Promise<void>;
  setZoom: (id: string | null) => void;
  clearNotice: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

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
        if (!cancelled) {
          dispatch({ type: "HYDRATE", items, outfits, imageUrls });
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
  }, [state.hydrated, state.items, state.outfits]);

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
  const saveOutfit = useCallback(() => dispatch({ type: "SAVE_OUTFIT" }), []);
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
    async (input: Omit<ClothingItem, "id" | "imageId"> & { id?: string; imageId?: string; file?: File }) => {
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
        },
        url,
      });
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
      for (const file of images) {
        const guessed = guessFromFilename(file.name);
        await saveItem({
          name: guessed.name,
          category: guessed.category,
          color: guessed.color,
          season: "all",
          occasion: "daily",
          file,
        });
      }
      dispatch({
        type: "SET_NOTICE",
        notice: `已导入 ${images.length} 件，可点「编辑」补全品类颜色`,
      });
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

  const generate = useCallback(async () => {
    if (selectedItems.length === 0) {
      dispatch({ type: "SET_NOTICE", notice: "请先在搭配区加入单品" });
      return;
    }
    dispatch({ type: "SET_GENERATING", value: true });
    try {
      const gender = resolveModelGender(state.modelChoice, selectedItems);
      const result = await generatePreview(selectedItems, state.imageUrls, {
        gender,
        modelSrc: await resolveModelSrc(gender),
        mode: state.generateMode,
        onProgress: (text) => dispatch({ type: "SET_GENERATE_PROGRESS", text }),
      });
      dispatch({
        type: "SET_PREVIEW",
        url: result.url,
        prompt: result.prompt,
        source: result.source,
      });
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
      dispatch({ type: "SET_GENERATING", value: false });
      dispatch({
        type: "SET_NOTICE",
        notice: error instanceof Error ? error.message : "生成失败",
      });
    }
  }, [selectedItems, state.imageUrls, state.modelChoice, state.generateMode]);

  const exportData = useCallback(async () => {
    const backup = await exportBackup(state.items, state.outfits);
    downloadJson(`outfit-backup-${new Date().toISOString().slice(0, 10)}.json`, backup);
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
    exportData,
    importData,
    setFilters,
    setModelChoice,
    setGenerateMode,
    addImageFiles,
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
