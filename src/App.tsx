import { CanvasPanel } from "./components/CanvasPanel";
import { Header } from "./components/Header";
import { ItemModal } from "./components/ItemModal";
import { ResultPanel } from "./components/ResultPanel";
import { WardrobePanel } from "./components/WardrobePanel";
import { useApp } from "./store";

export default function App() {
  const { hydrated, notice, clearNotice } = useApp();

  if (!hydrated) {
    return <div className="boot">加载衣橱…</div>;
  }

  return (
    <div className="app">
      <Header />
      <main className="workspace">
        <WardrobePanel />
        <CanvasPanel />
        <ResultPanel />
      </main>
      <ItemModal />
      {notice ? (
        <div className="toast" data-testid="toast" onClick={clearNotice}>
          {notice}
        </div>
      ) : null}
    </div>
  );
}
