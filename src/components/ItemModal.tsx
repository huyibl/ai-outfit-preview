import { useEffect, useState } from "react";
import { ITEM_CATEGORIES, ITEM_OCCASIONS, ITEM_SEASONS, CATEGORY_LABELS, OCCASION_LABELS, SEASON_LABELS } from "../lib/labels";
import { useApp } from "../store";
import type { Category, Occasion, Season } from "../types";

interface FormState {
  name: string;
  category: Category;
  color: string;
  season: Season;
  occasion: Occasion;
  notes: string;
  style: string;
  material: string;
  fit: string;
  pattern: string;
  file?: File;
}

const emptyForm: FormState = {
  name: "",
  category: "top",
  color: "",
  season: "all",
  occasion: "daily",
  notes: "",
  style: "",
  material: "",
  fit: "",
  pattern: "",
};

export function ItemModal() {
  const { editor, items, imageUrls, closeEditor, saveItem, removeItem } = useApp();
  const editing = editor?.kind === "edit" ? items.find((item) => item.id === editor.id) : undefined;
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState("");
  const [filePreview, setFilePreview] = useState("");

  useEffect(() => {
    if (!editor) return;
    setError("");
    if (editor.kind === "edit") {
      const item = items.find((entry) => entry.id === editor.id);
      if (item) {
        setForm({
          name: item.name,
          category: item.category,
          color: item.color,
          season: item.season,
          occasion: item.occasion,
          notes: item.notes ?? "",
          style: item.style ?? "",
          material: item.material ?? "",
          fit: item.fit ?? "",
          pattern: item.pattern ?? "",
        });
        return;
      }
    }
    setForm(emptyForm);
  }, [editor, items]);

  useEffect(() => {
    if (!form.file) {
      setFilePreview("");
      return;
    }
    const url = URL.createObjectURL(form.file);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [form.file]);

  if (!editor) return null;

  const preview = filePreview || (editing ? imageUrls[editing.imageId] : "");

  return (
    <div className="modal-backdrop" onClick={closeEditor}>
      <form
        className="modal"
        data-testid="item-modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await saveItem({
              id: editing?.id,
              imageId: editing?.imageId,
              name: form.name.trim(),
              category: form.category,
              color: form.color.trim() || "未填色",
              season: form.season,
              occasion: form.occasion,
              notes: form.notes.trim(),
              style: form.style.trim() || undefined,
              material: form.material.trim() || undefined,
              fit: form.fit.trim() || undefined,
              pattern: form.pattern.trim() || undefined,
              file: form.file,
            });
          } catch (err) {
            setError(err instanceof Error ? err.message : "保存失败");
          }
        }}
      >
        <h2>{editing ? "编辑衣服" : "添加衣服"}</h2>
        <label className="upload">
          {preview ? <img src={preview} alt="预览" /> : <span>点击上传图片</span>}
          <input
            type="file"
            accept="image/*"
            onChange={(event) => setForm((current) => ({ ...current, file: event.target.files?.[0] }))}
          />
        </label>
        <label>
          名称
          <input
            required
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <div className="select-row">
          <label>
            品类
            <select
              value={form.category}
              onChange={(event) =>
                setForm((current) => ({ ...current, category: event.target.value as Category }))
              }
            >
              {ITEM_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </label>
          <label>
            颜色
            <input
              value={form.color}
              onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
            />
          </label>
        </div>
        <div className="select-row">
          <label>
            季节
            <select
              value={form.season}
              onChange={(event) =>
                setForm((current) => ({ ...current, season: event.target.value as Season }))
              }
            >
              {ITEM_SEASONS.map((season) => (
                <option key={season} value={season}>
                  {SEASON_LABELS[season]}
                </option>
              ))}
            </select>
          </label>
          <label>
            场合
            <select
              value={form.occasion}
              onChange={(event) =>
                setForm((current) => ({ ...current, occasion: event.target.value as Occasion }))
              }
            >
              {ITEM_OCCASIONS.map((occasion) => (
                <option key={occasion} value={occasion}>
                  {OCCASION_LABELS[occasion]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          备注
          <input
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          />
        </label>
        <div className="select-row">
          <label>
            风格
            <input placeholder="极简/复古…" value={form.style} onChange={(event) => setForm((current) => ({ ...current, style: event.target.value }))} />
          </label>
          <label>
            材质
            <input placeholder="针织/牛仔…" value={form.material} onChange={(event) => setForm((current) => ({ ...current, material: event.target.value }))} />
          </label>
        </div>
        <div className="select-row">
          <label>
            版型
            <input placeholder="宽松/修身…" value={form.fit} onChange={(event) => setForm((current) => ({ ...current, fit: event.target.value }))} />
          </label>
          <label>
            图案
            <input placeholder="纯色/格纹…" value={form.pattern} onChange={(event) => setForm((current) => ({ ...current, pattern: event.target.value }))} />
          </label>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions">
          {editing ? (
            <button
              type="button"
              className="btn ghost danger"
              onClick={async () => {
                await removeItem(editing.id);
                closeEditor();
              }}
            >
              删除
            </button>
          ) : (
            <span />
          )}
          <div className="modal-actions-right">
            <button type="button" className="btn ghost" onClick={closeEditor}>
              取消
            </button>
            <button type="submit" className="btn primary">
              保存
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
