import { useEffect, useState } from "react";
import { getApiToken, setApiToken, subscribeUnauthorized } from "../lib/apiClient";

export function TokenBanner() {
  const [show, setShow] = useState(false);
  const [value, setValue] = useState(getApiToken());

  useEffect(() => subscribeUnauthorized(setShow), []);

  if (!show) return null;

  const submit = () => {
    setApiToken(value.trim());
    setShow(false);
  };

  return (
    <div className="token-banner" data-testid="token-banner">
      <span>服务器需要访问令牌：</span>
      <input
        type="password"
        placeholder="粘贴 ACCESS_TOKEN"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
        }}
      />
      <button type="button" className="btn primary tiny" onClick={submit}>
        保存
      </button>
    </div>
  );
}
