import { useRef } from "react";
import { FILTER_CATEGORIES, ITEM_OCCASIONS, ITEM_SEASONS, categoryLabel, OCCASION_LABELS, SEASON_LABELS } from "../lib/labels";
import { useApp } from "../store";
import { ItemCard } from "./ItemCard";

export function WardrobePanel() {
  const { items, filteredItems, filters, setFilters, addImageFiles } = useApp();
  const photosRef = useRef<HTMLInputElement>(null);

  return (
    <section className="panel wardrobe" data-testid="wardrobe-panel">
      <div className="panel-head">
        <div>
          <h2>衣橱</h2>
          <p data-testid="wardrobe-count">{items.length}件单品</p>
        </div>
        <input
          ref={photosRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={async (event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            if (files.length) await addImageFiles(files);
          }}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label="添加衣服"
          onClick={() => photosRef.current?.click()}
        >
          +
        </button>
      </div>

      <div className="filters">
        <input
          className="search"
          data-testid="wardrobe-search"
          placeholder="搜索名称、颜色或备注"
          value={filters.query}
          onChange={(event) => setFilters({ query: event.target.value })}
        />
        <div className="chips">
          {FILTER_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              className={filters.category === category ? "chip active" : "chip"}
              onClick={() => setFilters({ category })}
            >
              {categoryLabel(category)}
            </button>
          ))}
        </div>
        <div className="select-row">
          <label>
            季节
            <select
              value={filters.season}
              onChange={(event) => setFilters({ season: event.target.value as typeof filters.season })}
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
              value={filters.occasion}
              onChange={(event) =>
                setFilters({ occasion: event.target.value as typeof filters.occasion })
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
      </div>

      <div className="wardrobe-list">
        {filteredItems.map((item) => (
          <ItemCard key={item.id} item={item} draggable />
        ))}
        {filteredItems.length === 0 ? <p className="empty-hint">没有匹配的单品</p> : null}
      </div>
    </section>
  );
}
