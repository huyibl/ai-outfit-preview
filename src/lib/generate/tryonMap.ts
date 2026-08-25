import type { ClothingItem } from "../../types";

export function pickTryOnGarments(items: ClothingItem[], imageUrls: Record<string, string>) {
  const withImage = items.filter((item) => imageUrls[item.imageId]);
  const onePiece = withImage.find((item) => item.category === "dress");
  const outer = withImage.find((item) => item.category === "outerwear");
  const top = withImage.find((item) => item.category === "top");
  const bottom = withImage.find((item) => item.category === "bottom");
  const topItem = onePiece ?? outer ?? top;
  const bottomItem = onePiece ? undefined : bottom;
  return {
    topItem,
    bottomItem,
    usable: Boolean(topItem || bottomItem),
  };
}
