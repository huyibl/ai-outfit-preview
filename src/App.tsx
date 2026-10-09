import { useEffect, useMemo, useState } from "react";
import { CanvasPanel } from "./components/CanvasPanel";
import { Header } from "./components/Header";
import { ItemModal } from "./components/ItemModal";
import { ResultPanel } from "./components/ResultPanel";
import { TokenBanner } from "./components/TokenBanner";
import { WardrobePanel } from "./components/WardrobePanel";
import { useApp } from "./store";

type MobileTab = "wardrobe" | "canvas" | "result";

const MOBILE_TABS: Array<{ id: MobileTab; label: string }> = [
  { id: "wardrobe", label: "衣橱" },
  { id: "canvas", label: "搭配" },
  { id: "result", label: "套装" },
];

/** iframe 嵌入模式：与宿主页面按 postMessage 协议通信 */
function useEmbedBridge(enabled: boolean) {
  const { addEmbeddedItems, previewUrl, previewSource } = useApp();

  useEffect(() => {
    if (!enabled) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; items?: unknown } | null;
      if (!data || typeof data !== "object") return;
      if (data.type === "outfit-preview:set-items" && Array.isArray(data.items)) {
        void addEmbeddedItems(data.items as Parameters<typeof addEmbeddedItems>[0]);
      }
    };
    window.addEventListener("message", onMessage);
    window.parent?.postMessage({ type: "outfit-preview:ready" }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [enabled, addEmbeddedItems]);

  useEffect(() => {
    if (!enabled || !previewUrl) return;
    window.parent?.postMessage(
      { type: "outfit-preview:result", url: previewUrl, source: previewSource },
      "*",
    );
  }, [enabled, previewUrl, previewSource]);
}

export default function App() {
  const { hydrated, notice, clearNotice } = useApp();
  const [tab, setTab] = useState<MobileTab>("canvas");
  const isEmbed = useMemo(
    () => new URLSearchParams(window.location.search).get("embed") === "1",
    [],
  );
  useEmbedBridge(isEmbed);

  if (!hydrated) {
    return <div className="boot">加载衣橱…</div>;
  }

  return (
    <div className={`app${isEmbed ? " embed" : ""}`}>
      {isEmbed ? null : <Header />}
      {isEmbed ? null : <TokenBanner />}
      <main className={`workspace tab-${tab}`}>
        <WardrobePanel />
        <CanvasPanel />
        <ResultPanel />
      </main>
      {isEmbed ? null : (
        <nav className="mobile-tabs" data-testid="mobile-tabs">
          {MOBILE_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? "chip active" : "chip"}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      )}
      <ItemModal />
      {notice ? (
        <div className="toast" data-testid="toast" onClick={clearNotice}>
          {notice}
        </div>
      ) : null}
    </div>
  );
}
