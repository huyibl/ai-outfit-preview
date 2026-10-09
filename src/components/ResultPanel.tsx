import { useEffect, useRef, useState } from "react";
import type { GenerateMode } from "../lib/generate/adapter";
import { apiFetch } from "../lib/apiClient";
import { MODEL_ASSETS, resolveModelGender, type ModelChoice } from "../lib/models";
import { useApp } from "../store";

const MODEL_CHOICES: Array<{ id: ModelChoice; label: string }> = [
  { id: "auto", label: "女模" },
  { id: "female", label: "女模" },
  { id: "male", label: "男模" },
];

const GEN_MODES: Array<{ id: GenerateMode; label: string; hint: string }> = [
  { id: "stylist", label: "帮我搭", hint: "AI 从你的衣橱出 3 套方案" },
  { id: "tryon", label: "虚拟试衣", hint: "先内搭再外套 · 鞋包后补" },
  { id: "txt2img", label: "文生图", hint: "免费 · Kolors" },
  { id: "img2img", label: "图生图", hint: "约 ¥0.30/件 · Qwen 分层换装" },
];

const SCENE_CHIPS = ["秋天通勤", "周末约会", "运动健身", "旅行拍照"];

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
    cancelGenerate,
    imageUrls,
    generateStylistPlans,
    retryPlan,
    votePlan,
    plans,
    planGaps,
    items,
  } = useApp();
  const photoRef = useRef<HTMLInputElement>(null);
  const [intent, setIntent] = useState("");
  const [apiReady, setApiReady] = useState(false);
  const [tryonReady, setTryonReady] = useState(false);
  const resolved = resolveModelGender(modelChoice, selectedItems);

  useEffect(() => {
    void apiFetch<{ configured?: boolean; tryon?: boolean }>("/api/v1/capabilities")
      .then((result) => {
        setApiReady(Boolean(result.data.configured));
        setTryonReady(Boolean(result.data.tryon));
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
    : generateMode === "stylist"
      ? generateProgress || "AI 搭配师 · 从衣橱出 3 套方案"
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
          onClick={() => {
            if (generateMode === "stylist") void generateStylistPlans(intent);
            else void generate();
          }}
        >
          {generating ? generateProgress || (generateMode === "stylist" ? "搭配中…" : "生成中…") : generateMode === "stylist" ? "帮我搭" : "生成穿搭预览"}
        </button>
        {generating ? (
          <button type="button" className="btn" data-testid="cancel-generate" onClick={cancelGenerate}>
            取消
          </button>
        ) : null}
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

      {generateMode === "stylist" ? (
        <div className="stylist-area">
          <div className="stylist-bar">
            <input
              data-testid="stylist-intent"
              placeholder="说说场合或感觉，比如：秋天通勤显干净"
              value={intent}
              onChange={(event) => setIntent(event.target.value)}
            />
          </div>
          <div className="chips stylist-chips">
            {SCENE_CHIPS.map((scene) => (
              <button key={scene} type="button" className="chip" data-testid={`scene-${scene}`} onClick={() => setIntent(scene)}>
                {scene}
              </button>
            ))}
          </div>
          {planGaps.length > 0 ? (
            <p className="plan-gaps" data-testid="plan-gaps">
              💡 {planGaps.join("；")}
            </p>
          ) : null}
          <div className="plans" data-testid="plans">
            {plans.map((plan, index) => (
              <article key={plan.id} className={`plan-card plan-${plan.status}`} data-testid={`plan-card-${index}`}>
                <div className="plan-media">
                  {plan.status === "done" && plan.url ? (
                    <img src={plan.url} alt={plan.styleName} data-testid={`plan-img-${index}`} />
                  ) : plan.status === "imaging" ? (
                    <div className="plan-loading">
                      <div className="spinner" />
                      <span>{plan.progressText || "生成中…"}</span>
                    </div>
                  ) : plan.status === "noimage" ? (
                    <div className="plan-noimage">
                      <div className="plan-thumbs">
                        {plan.itemIds.map((itemId) => {
                          const item = items.find((entry) => entry.id === itemId);
                          const src = item ? imageUrls[item.imageId] : undefined;
                          return src ? <img key={itemId} src={src} alt={item?.name ?? itemId} /> : null;
                        })}
                      </div>
                      <span>{plan.error || "出图优化中"}</span>
                    </div>
                  ) : (
                    <div className="plan-failed">
                      <span>{plan.error || "生成失败"}</span>
                      <button type="button" className="btn tiny" data-testid={`plan-retry-${index}`} onClick={() => void retryPlan(plan.id)}>
                        重试这套
                      </button>
                    </div>
                  )}
                </div>
                <div className="plan-meta">
                  <h3>
                    {plan.styleName}
                    {plan.degradedLevel === "qwen" ? <span className="mini-tag warn">备用模式 · 效果可能略有差异</span> : null}
                    {plan.degradedLevel === "collage" ? <span className="mini-tag warn">简易模式 · 效果仅供参考</span> : null}
                    {plan.inspired ? <span className="mini-tag">灵感参考</span> : null}
                    {plan.source === "rule" ? <span className="mini-tag">基础模式</span> : null}
                  </h3>
                  <div className="tags">
                    {plan.styleTags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                  {plan.reason ? <p>{plan.reason}</p> : null}
                  <div className="plan-actions">
                    <span className="plan-items">
                      {plan.itemIds.length} 件 ·{" "}
                      {plan.itemIds
                        .map((itemId) => items.find((entry) => entry.id === itemId)?.name)
                        .filter(Boolean)
                        .join("、")}
                    </span>
                    {plan.status === "done" ? (
                      <span className="plan-votes">
                        <button type="button" className="btn tiny" data-testid={`plan-up-${index}`} onClick={() => votePlan(plan.id, 1)}>
                          👍
                        </button>
                        <button type="button" className="btn tiny" data-testid={`plan-down-${index}`} onClick={() => votePlan(plan.id, -1)}>
                          👎
                        </button>
                      </span>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <div className="preview-stage">
          {generating ? <div className="spinner" data-testid="generating" /> : null}
          {previewUrl ? (
            <img src={previewUrl} alt="穿搭预览" data-testid="preview-image" />
          ) : (
            <p className="empty-hint">{emptyHint}</p>
          )}
        </div>
      )}

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
                {outfit.previewDataUrl || imageUrls[`outfit-img:${outfit.id}`] ? (
                  <img
                    src={outfit.previewDataUrl ?? imageUrls[`outfit-img:${outfit.id}`]}
                    alt="已保存套装"
                  />
                ) : (
                  <span>{outfit.itemIds.length} 件</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <p className="privacy-hint">隐私说明：使用 AI 生成时，你的全身照与衣物图会上传至阿里云百炼/硅基流动用于本次生成，不会公开展示；数据仅保存在你的浏览器本地。</p>
    </section>
  );
}
