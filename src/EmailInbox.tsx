import { useEffect, useRef, useState, type FormEvent } from 'react';
import { saveInboundSenders, type InboundInfo } from './api';
import { IconCheck, IconClose, IconCopy } from './icons';

type Info = Extract<InboundInfo, { enabled: true }>;

/** Settings for turning forwarded email (for example "Share to Outlook" in Teams) into tasks. */
export function EmailInboxDialog({ info, onClose, onSaved }: { info: Info; onClose: () => void; onSaved: (info: InboundInfo) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(info.senders.join('\n'));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const senders = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    setSaving(true);
    setError(null);
    try {
      const next = await saveInboundSenders(senders);
      if (next.enabled) setText(next.senders.join('\n'));
      onSaved(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={ref}
      className="import-dialog mcp-dialog"
      aria-labelledby="inbox-dialog-title"
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) ref.current?.close(); }}
    >
      <form onSubmit={(e) => void submit(e)}>
        <div className="mcp-head">
          <h2 id="inbox-dialog-title">Email to task</h2>
          <button type="button" className="icon-key" onClick={() => ref.current?.close()} aria-label="Close">
            <IconClose width={16} height={16} />
          </button>
        </div>
        <p className="mcp-lead">
          Forward or share a message (in Teams: <b>… → Share to Outlook</b>) to this address. Put the customer in the
          subject, the same way as in quick add.
        </p>
        <div className="mcp-body">
          <div className="mcp-field">
            <span className="mcp-field-label">Send to</span>
            <div className="mcp-field-row">
              <code className="mcp-value">{info.address}</code>
              <button
                type="button"
                className="icon-key"
                aria-label="Copy address"
                title="Copy"
                onClick={() => { void navigator.clipboard?.writeText(info.address).then(() => setCopied(true), () => undefined); }}
              >
                {copied ? <IconCheck width={16} height={16} /> : <IconCopy width={16} height={16} />}
              </button>
            </div>
          </div>
          <ul className="mcp-steps">
            <li><code>sg</code> — task on the customer with short name sg, titled with the first line of the message</li>
            <li><code>sg: Check the invoice fri !</code> — own title, due Friday, high priority</li>
            <li>No match? The task lands on the <b>Inbox</b> customer so you can move it.</li>
          </ul>
          <label className="mcp-field">
            <span className="mcp-field-label">Your sender addresses</span>
            <textarea
              className="quick-add-input inbox-senders"
              value={text}
              onChange={(e) => { setText(e.target.value); setSaved(false); }}
              placeholder="name@company.example"
              rows={3}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <p className="mcp-note">
            One per line. Only mail from these addresses becomes tasks on your board
            {info.requireDkim ? ', and only when it carries a valid DKIM signature from the sender’s domain' : ''}.
          </p>
          {error && <p className="mcp-note inbox-error" role="alert">{error}</p>}
        </div>
        <div className="import-actions">
          {saved && <span className="mcp-note" role="status">Saved</span>}
          <button type="button" className="crm-secondary" onClick={() => ref.current?.close()}>Close</button>
          <button type="submit" className="crm-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </dialog>
  );
}
