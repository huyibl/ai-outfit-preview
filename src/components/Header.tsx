import { useRef } from "react";
import { useApp } from "../store";

export function Header() {
  const { importData, exportData, addImageFiles } = useApp();
  const backupRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<HTMLInputElement>(null);

  return (
    <header className="topbar">
      <h1>AI 穿搭预演工具</h1>
      <div className="topbar-actions">
        <input
          ref={backupRef}
          type="file"
          accept="application/json"
          hidden
          data-testid="import-input"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) {
              try {
                await importData(file);
              } catch {
                alert("导入失败，请检查备份文件");
              }
            }
          }}
        />
        <input
          ref={photosRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          data-testid="add-photos-input"
          onChange={async (event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            if (files.length) await addImageFiles(files);
          }}
        />
        <button type="button" className="btn ghost" onClick={() => backupRef.current?.click()}>
          导入备份
        </button>
        <button type="button" className="btn ghost" data-testid="export-backup" onClick={() => void exportData()}>
          导出备份
        </button>
        <button
          type="button"
          className="btn primary"
          data-testid="add-clothes"
          onClick={() => photosRef.current?.click()}
        >
          添加衣服
        </button>
      </div>
    </header>
  );
}
