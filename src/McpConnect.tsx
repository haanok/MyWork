import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { McpInfo } from './api';
import { IconCheck, IconClose, IconCopy } from './icons';

type Info = Extract<McpInfo, { enabled: true }>;
type ClientTab = 'claude' | 'claude-code' | 'vscode' | 'other';

const TABS: { id: ClientTab; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'vscode', label: 'VS Code' },
  { id: 'other', label: 'Other clients' },
];

function CopyField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined);
  };
  return (
    <div className="mcp-field">
      <span className="mcp-field-label">{label}</span>
      <div className="mcp-field-row">
        {multiline ? <pre className="mcp-value">{value}</pre> : <code className="mcp-value">{value}</code>}
        <button type="button" className="icon-key" onClick={copy} aria-label={`Copy ${label}`} title="Copy">
          {copied ? <IconCheck width={16} height={16} /> : <IconCopy width={16} height={16} />}
        </button>
      </div>
    </div>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="mcp-steps">{children}</ol>;
}

function Callbacks({ urls }: { urls: string[] }) {
  return (
    <p className="mcp-note">
      Pocket ID must allow {urls.length === 1 ? 'this callback URL' : 'these callback URLs'} on the MCP client:{' '}
      {urls.map((u, i) => <span key={u}>{i > 0 && ', '}<code>{u}</code></span>)}
    </p>
  );
}

function TabBody({ tab, info }: { tab: ClientTab; info: Info }) {
  if (tab === 'claude') {
    return (
      <>
        <Steps>
          <li>In claude.ai or Claude Desktop, open <b>Settings → Connectors → Add custom connector</b>.</li>
          <li>Name it <b>MyWork</b> and paste the URL below.</li>
          <li>Under <b>Advanced settings</b>, paste the OAuth client ID.</li>
          <li>Click <b>Connect</b> and sign in with Pocket ID. The connector then also works in the mobile apps.</li>
        </Steps>
        <CopyField label="Server URL" value={info.url} />
        <CopyField label="OAuth client ID" value={info.clientId} />
        <Callbacks urls={['https://claude.ai/api/mcp/auth_callback']} />
      </>
    );
  }
  if (tab === 'claude-code') {
    const command = `claude mcp add --transport http --client-id ${info.clientId} --callback-port 8080 mywork ${info.url}`;
    return (
      <>
        <Steps>
          <li>Run this in a terminal. Add <code>--client-secret</code> if the Pocket ID client is confidential; Claude Code then asks for it.</li>
          <li>In Claude Code, run <code>/mcp</code>, choose <b>mywork</b> and sign in.</li>
        </Steps>
        <CopyField label="Command" value={command} multiline />
        <Callbacks urls={['http://localhost:8080/callback']} />
        <p className="mcp-note">A connector added on claude.ai is also available in Claude Code when you are signed in with the same account.</p>
      </>
    );
  }
  if (tab === 'vscode') {
    const config = JSON.stringify({ servers: { mywork: { type: 'http', url: info.url } } }, null, 2);
    return (
      <>
        <Steps>
          <li>Add this to <code>.vscode/mcp.json</code>, or run <b>MCP: Add Server…</b> and choose HTTP.</li>
          <li>Start the server. VS Code asks for a client ID because Pocket ID has no dynamic registration; paste the one below.</li>
          <li>Sign in with Pocket ID. The tools are then available in Copilot agent mode.</li>
        </Steps>
        <CopyField label="mcp.json" value={config} multiline />
        <CopyField label="OAuth client ID" value={info.clientId} />
        <Callbacks urls={['http://127.0.0.1:33418', 'https://vscode.dev/redirect']} />
      </>
    );
  }
  return (
    <>
      <p className="mcp-lead">
        Any MCP client works if it supports <b>Streamable HTTP</b> with <b>OAuth</b> and lets you enter a
        pre-registered client ID. Clients that only support dynamic client registration cannot connect,
        because Pocket ID does not offer it.
      </p>
      <CopyField label="Server URL" value={info.url} />
      <CopyField label="OAuth client ID" value={info.clientId} />
      <CopyField label="Authorization server" value={info.issuer} />
      <p className="mcp-note">
        Add the client's redirect URL to the MCP client in Pocket ID (<b>Administration → OIDC clients</b>).
        The client discovers the rest from <code>/.well-known/oauth-protected-resource</code>.
      </p>
    </>
  );
}

export function McpConnectDialog({ info, onClose }: { info: Info; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<ClientTab>('claude');

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="import-dialog mcp-dialog"
      aria-labelledby="mcp-dialog-title"
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) ref.current?.close(); }}
    >
      <div className="mcp-head">
        <h2 id="mcp-dialog-title">Connect an AI assistant</h2>
        <button type="button" className="icon-key" onClick={() => ref.current?.close()} aria-label="Close">
          <IconClose width={16} height={16} />
        </button>
      </div>
      <p className="mcp-lead">
        MyWork is a remote MCP server. Assistants you connect can read and update your customers, notes,
        contacts and tasks after you sign in with Pocket ID.
      </p>
      <div className="mcp-tabs" role="tablist" aria-label="Client">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className="mcp-tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mcp-body" role="tabpanel">
        <TabBody tab={tab} info={info} />
      </div>
    </dialog>
  );
}
