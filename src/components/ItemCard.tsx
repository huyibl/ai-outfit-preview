import { CATEGORY_LABELS, SEASON_LABELS } from "../lib/labels";
import { useApp } from "../store";
import type { ClothingItem } from "../types";

export function ItemCard({
  item,
  draggable = false,
}: {
  item: ClothingItem;
  draggable?: boolean;
}) {
  const { imageUrls, addToMatch, openEdit } = useApp();
  const src = imageUrls[item.imageId];

  return (
    <article
      className="item-card"
      draggable={draggable}
      data-testid={`item-card-${item.id}`}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-clothing-id", item.id);
        event.dataTransfer.setData("text/plain", item.id);
        event.dataTransfer.effectAllowed = "copy";
      }}
    >
      <div className="item-thumb">
        {src ? <img src={src} alt={item.name} /> : <div className="thumb-fallback">无图</div>}
      </div>
      <div className="item-meta">
        <h3>{item.name}</h3>
        <div className="tags">
          <span>{item.color}</span>
          <span>{CATEGORY_LABELS[item.category]}</span>
          {item.season !== "all" ? <span>{SEASON_LABELS[item.season]}</span> : null}
        </div>
        <div className="item-actions">
          <button
            type="button"
            className="btn tiny"
            data-testid={`add-${item.id}`}
            onClick={() => addToMatch(item.id)}
          >
            加入搭配
          </button>
          <button type="button" className="btn tiny ghost" onClick={() => openEdit(item.id)}>
            编辑
          </button>
        </div>
      </div>
    </article>
  );
}
