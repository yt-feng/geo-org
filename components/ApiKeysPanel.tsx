"use client";

import { useState } from "react";

type ApiKeyRecord = {
  id: string;
  label: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export function ApiKeysPanel({ initialKeys }: { initialKeys: ApiKeyRecord[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [createdKey, setCreatedKey] = useState("");
  const [label, setLabel] = useState("Default key");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function createKey() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const result = (await response.json()) as {
        error?: string;
        key?: string;
        record?: ApiKeyRecord;
      };
      if (!response.ok || !result.key || !result.record) {
        throw new Error(result.error || "密钥创建失败。");
      }
      setCreatedKey(result.key);
      setKeys((current) => [
        {
          ...result.record!,
          created_at: new Date().toISOString(),
          last_used_at: null,
          revoked_at: null,
        },
        ...current,
      ]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "密钥创建失败。");
    } finally {
      setPending(false);
    }
  }

  async function revokeKey(id: string) {
    if (!window.confirm("停用后无法恢复，确认继续？")) return;
    const response = await fetch(`/api/keys?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setKeys((current) =>
        current.map((item) =>
          item.id === id ? { ...item, revoked_at: new Date().toISOString() } : item,
        ),
      );
    }
  }

  async function copyKey() {
    await navigator.clipboard.writeText(createdKey);
    setMessage("密钥已复制。");
  }

  return (
    <section className="panel keys-panel">
      <div className="panel-header">
        <div>
          <span className="section-kicker">ACCESS KEYS</span>
          <h2>API 密钥</h2>
        </div>
        <div className="key-create-row">
          <input
            aria-label="密钥备注"
            maxLength={60}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="密钥备注"
            value={label}
          />
          <button className="button button-primary" disabled={pending} onClick={createKey} type="button">
            {pending ? "生成中…" : "新建密钥"}
          </button>
        </div>
      </div>

      {createdKey ? (
        <div className="new-key-callout" role="status">
          <div>
            <strong>请立即保存这枚密钥</strong>
            <span>关闭后将无法再次查看完整值。</span>
          </div>
          <code>{createdKey}</code>
          <button className="button button-dark" onClick={copyKey} type="button">
            复制
          </button>
        </div>
      ) : null}

      {message ? <p className="inline-message">{message}</p> : null}
      <div className="keys-list">
        {keys.length ? (
          keys.map((item) => (
            <div className={`key-row ${item.revoked_at ? "revoked" : ""}`} key={item.id}>
              <div>
                <strong>{item.label}</strong>
                <code>{item.key_prefix}••••••••••••</code>
              </div>
              <div className="key-meta">
                <span>{item.revoked_at ? "已停用" : item.last_used_at ? "已使用" : "未使用"}</span>
                {!item.revoked_at ? (
                  <button onClick={() => revokeKey(item.id)} type="button">
                    停用
                  </button>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">还没有 API 密钥。</div>
        )}
      </div>
    </section>
  );
}
