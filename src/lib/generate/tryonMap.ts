import type { ClothingItem } from "../../types";

export function pickTryOnGarments(items: ClothingItem[], imageUrls: Record<string, string>) {
  const withImage = items.filter((item) => imageUrls[item.imageId]);
  const onePiece = withImage.find((item) => item.category === "dress");
  const outer = withImage.find((item) => item.category === "outerwear");
  const top = withImage.find((item) => item.category === "top");
  const bottom = withImage.find((item) => item.category === "bottom");
  const innerTop = onePiece ?? top;
  const firstTop = innerTop ?? outer;
  const bottomItem = onePiece ? undefined : bottom;
  const outerItem = innerTop && outer ? outer : undefined;
  const extras = withImage.filter((item) => item.category === "shoes" || item.category === "bag");
  return {
    topItem: firstTop,
    bottomItem,
    outerItem,
    extras,
    usable: Boolean(firstTop || bottomItem),
  };
}
