import { useEffect, useRef, useState } from "react";
import type { GenerateMode } from "../lib/generate/adapter";
import { MODEL_ASSETS, resolveModelGender, type ModelChoice } from "../lib/models";
import { useApp } from "../store";

const MODEL_CHOICES: Array<{ id: ModelChoice; label: string }> = [
  { id: "auto", label: "自动" },
  { id: "female", label: "女模" },
  { id: "male", label: "男模" },
];

const GEN_MODES: Array<{ id: GenerateMode; label: string; hint: string }> = [
  { id: "tryon", label: "虚拟试衣", hint: "先内搭再外套 · 鞋包后补" },
  { id: "txt2img", label: "文生图", hint: "免费 · Kolors" },
  { id: "img2img", label: "图生图", hint: "约 ¥0.30/件 · Qwen 分层换装" },
];

export function ResultPanel() {
  const {
    previewUrl,
    previewPrompt,
    previewSource,
    generating,
    generateProgress,
    generate,
    outfits,
    loadOutfit,
    selectedItems,
    modelChoice,
    setModelChoice,
    generateMode,
    setGenerateMode,
    customModelUrl,
    setCustomModelPhoto,
    clearCustomModelPhoto,
  } = useApp();
  const photoRef = useRef<HTMLInputElement>(null);
  const [apiReady, setApiReady] = useState(false);
  const [tryonReady, setTryonReady] = useState(false);
  const resolved = resolveModelGender(modelChoice, selectedItems);

  useEffect(() => {
    void fetch("/api/preview")
      .then((response) => response.json())
      .then((data: { configured?: boolean; tryon?: boolean }) => {
        setApiReady(Boolean(data.configured));
        setTryonReady(Boolean(data.tryon));
      })
      .catch(() => {
        setApiReady(false);
        setTryonReady(false);
      });
  }, [previewSource, generating]);

  useEffect(() => {
    if (generateMode !== "img2img") return;
    const image = new Image();
    image.src = MODEL_ASSETS[resolved].src;
    image.onload = () => {
      void import("../lib/generate/pose").then((mod) => mod.analyzeBody(image));
    };
  }, [generateMode, resolved]);

  const statusText = !apiReady
    ? "未配置 Key，使用本地合成"
    : generateMode === "tryon"
      ? generateProgress || (tryonReady ? "虚拟试衣 · 内搭后再穿外套" : "试衣未配置，将用 Qwen 兜底")
      : generateMode === "img2img"
        ? generateProgress || "图生图 · Qwen 分层换装"
        : "文生图 · Kolors 免费";

  const emptyHint =
    generateMode === "tryon"
      ? "虚拟试衣：把上衣/下装穿到当前模特身上（可先上传全身照）"
      : generateMode === "img2img"
        ? "图生图：按身体轮廓换装，并对齐原模特姿态"
        : "文生图：按单品描述生成全身穿搭（免费）";

  const sourceLabel = previewSource === "api" ? "AI 接口" : "本地合成";

  return (
    <section className="panel result" data-testid="result-panel">
      <div className="panel-head">
        <div>
          <h2>套装</h2>
          <p data-testid="api-status">{statusText}</p>
        </div>
        <button
          type="button"
          className="btn primary"
          data-testid="generate-preview"
          disabled={generating}
          onClick={() => void generate()}
        >
          {generating ? generateProgress || "生成中…" : "生成穿搭预览"}
        </button>
      </div>

      <div className="model-picker" data-testid="generate-mode">
        {GEN_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={generateMode === mode.id ? "chip active" : "chip"}
            data-testid={`mode-${mode.id}`}
            onClick={() => setGenerateMode(mode.id)}
          >
            {mode.label}
          </button>
        ))}
        <span className="model-hint">
          {GEN_MODES.find((mode) => mode.id === generateMode)?.hint}
        </span>
      </div>

      <div className="model-picker" data-testid="model-picker">
        {MODEL_CHOICES.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className={modelChoice === choice.id ? "chip active" : "chip"}
            data-testid={`model-${choice.id}`}
            onClick={() => setModelChoice(choice.id)}
          >
            {choice.label}
          </button>
        ))}
        <span className="model-hint">当前 {MODEL_ASSETS[resolved].label}</span>
      </div>

      <div className="model-picker">
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          hidden
          data-testid="upload-model-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void setCustomModelPhoto(file);
          }}
        />
        <button
          type="button"
          className={customModelUrl ? "chip active" : "chip"}
          data-testid="upload-model"
          onClick={() => photoRef.current?.click()}
        >
          上传全身照
        </button>
        {customModelUrl ? (
          <button
            type="button"
            className="chip"
            data-testid="clear-model"
            onClick={() => void clearCustomModelPhoto()}
          >
            改回默认
          </button>
        ) : null}
        <span className="model-hint">
          {customModelUrl ? "当前使用你的全身照（需头和脚都在画面里）" : "默认模特 · 可换成自己的全身照"}
        </span>
      </div>

      <div className="preview-stage">
        {generating ? <div className="spinner" data-testid="generating" /> : null}
        {previewUrl ? (
          <img src={previewUrl} alt="穿搭预览" data-testid="preview-image" />
        ) : (
          <p className="empty-hint">{emptyHint}</p>
        )}
      </div>

      {previewPrompt ? (
        <p className="prompt-box" data-testid="preview-prompt">
          <strong>{sourceLabel}</strong>
          {previewPrompt}
        </p>
      ) : null}

      {outfits.length > 0 ? (
        <div className="outfit-history">
          <h3>已保存</h3>
          <div className="history-row">
            {outfits.map((outfit) => (
              <button
                key={outfit.id}
                type="button"
                className="history-card"
                data-testid={`outfit-${outfit.id}`}
                onClick={() => loadOutfit(outfit.id)}
              >
                {outfit.previewDataUrl ? (
                  <img src={outfit.previewDataUrl} alt="已保存套装" />
                ) : (
                  <span>{outfit.itemIds.length} 件</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
