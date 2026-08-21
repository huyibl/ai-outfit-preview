import { hasCategory } from "../lib/canvasRules";
import { CATEGORY_LABELS } from "../lib/labels";
import { useApp } from "../store";
import type { ClothingItem } from "../types";

function downloadItem(item: ClothingItem, url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${item.name}.png`;
  anchor.click();
}

function CanvasCard({ item }: { item: ClothingItem }) {
  const { imageUrls, removeFromCanvas, setZoom } = useApp();
  const src = imageUrls[item.imageId];

  return (
    <article className="canvas-card" data-testid={`canvas-item-${item.id}`}>
      <button
        type="button"
        className="close-x"
        aria-label="移除"
        onClick={() => removeFromCanvas(item.id)}
      >
        ×
      </button>
      <div className="canvas-thumb">{src ? <img src={src} alt={item.name} /> : null}</div>
      <p>{item.name}</p>
      <span className="mini-tag">{CATEGORY_LABELS[item.category]}</span>
      <div className="hover-toolbar">
        <button type="button" title="放大" onClick={() => setZoom(item.id)}>
          ＋
        </button>
        <button type="button" title="移除" onClick={() => removeFromCanvas(item.id)}>
          🗑
        </button>
        <button
          type="button"
          title="下载"
          onClick={() => {
            if (src) downloadItem(item, src);
          }}
        >
          ⬇
        </button>
      </div>
    </article>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="slot-placeholder">
      <span>{label}</span>
    </div>
  );
}

export function CanvasPanel() {
  const { selectedItems, addToMatch, clearCanvas, saveOutfit, zoomItemId, setZoom, imageUrls, items } =
    useApp();
  const zoomItem = items.find((item) => item.id === zoomItemId);

  return (
    <section
      className="canvas-panel"
      data-testid="canvas-panel"
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const id =
          event.dataTransfer.getData("application/x-clothing-id") ||
          event.dataTransfer.getData("text/plain");
        if (id) addToMatch(id);
      }}
    >
      <div className="canvas-toolbar">
        <button type="button" className="btn ghost" data-testid="clear-canvas" onClick={clearCanvas}>
          清空
        </button>
        <button type="button" className="btn primary" data-testid="save-outfit" onClick={saveOutfit}>
          保存套装
        </button>
      </div>

      <div className="canvas-board">
        {selectedItems.length === 0 ? (
          <p className="empty-hint canvas-hint">从左侧拖入单品，或点击「加入搭配」</p>
        ) : null}
        {selectedItems.map((item) => (
          <CanvasCard key={item.id} item={item} />
        ))}
        {!hasCategory(selectedItems, "accessory") ? <Placeholder label="配饰" /> : null}
        {!hasCategory(selectedItems, "bag") ? <Placeholder label="包" /> : null}
      </div>

      {zoomItem && imageUrls[zoomItem.imageId] ? (
        <div className="lightbox" onClick={() => setZoom(null)} data-testid="lightbox">
          <img src={imageUrls[zoomItem.imageId]} alt={zoomItem.name} />
        </div>
      ) : null}
    </section>
  );
}
