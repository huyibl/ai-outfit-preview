import { useEffect, useState } from "react";
import type { GenerateMode } from "../lib/generate/adapter";
import { MODEL_ASSETS, resolveModelGender, type ModelChoice } from "../lib/models";
import { useApp } from "../store";

const MODEL_CHOICES: Array<{ id: ModelChoice; label: string }> = [
  { id: "auto", label: "自动" },
  { id: "female", label: "女模" },
  { id: "male", label: "男模" },
];

const GEN_MODES: Array<{ id: GenerateMode; label: string; hint: string }> = [
  { id: "txt2img", label: "文生图", hint: "免费 · Kolors" },
  { id: "img2img", label: "图生图", hint: "约 ¥0.30/张" },
];

export function ResultPanel() {
  const {
    previewUrl,
    previewPrompt,
    previewSource,
    generating,
    generate,
    outfits,
    loadOutfit,
    selectedItems,
    modelChoice,
    setModelChoice,
    generateMode,
    setGenerateMode,
  } = useApp();
  const [apiReady, setApiReady] = useState(false);
  const resolved = resolveModelGender(modelChoice, selectedItems);

  useEffect(() => {
    void fetch("/api/preview")
      .then((response) => response.json())
      .then((data: { configured?: boolean }) => setApiReady(Boolean(data.configured)))
      .catch(() => setApiReady(false));
  }, [previewSource, generating]);

  return (
    <section className="panel result" data-testid="result-panel">
      <div className="panel-head">
        <div>
          <h2>套装</h2>
          <p data-testid="api-status">
            {apiReady
              ? generateMode === "img2img"
                ? "图生图 · 需账户余额"
                : "文生图 · Kolors 免费"
              : "未配置 Key，使用本地合成"}
          </p>
        </div>
        <button
          type="button"
          className="btn primary"
          data-testid="generate-preview"
          disabled={generating}
          onClick={() => void generate()}
        >
          {generating ? "生成中…" : "生成穿搭预览"}
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

      {generateMode === "img2img" ? (
        <div className="model-preview">
          <img src={MODEL_ASSETS[resolved].src} alt={MODEL_ASSETS[resolved].label} />
        </div>
      ) : null}

      <div className="preview-stage">
        {generating ? <div className="spinner" data-testid="generating" /> : null}
        {previewUrl ? (
          <img src={previewUrl} alt="穿搭预览" data-testid="preview-image" />
        ) : (
          <p className="empty-hint">
            {generateMode === "img2img"
              ? "图生图：以模特底图 + 单品参考板出图"
              : "文生图：按单品描述生成全身穿搭（免费）"}
          </p>
        )}
      </div>

      {previewPrompt ? (
        <p className="prompt-box" data-testid="preview-prompt">
          <strong>{previewSource === "api" ? "AI 接口" : "本地合成"}</strong>
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
