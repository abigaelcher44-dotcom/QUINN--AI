import { useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2, Zap, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { detectLocalApi, setLocalApi, streamChat } from '@/lib/ai';
import { isNativeSecureStorage, readApiKeys, readPrimaryProvider, saveApiKeys } from '@/lib/secureApiKeys';
import { Capacitor } from '@capacitor/core';

type Row = { name: string; value: string };

const SUGGESTED = [
  'GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY', 'TOGETHER_API_KEY', 'DEEPSEEK_API_KEY', 'MISTRAL_API_KEY',
  'XAI_API_KEY', 'PERPLEXITY_API_KEY', 'ELEVENLABS_API_KEY', 'TAVILY_API_KEY',
];

const blank = (): Row => ({ name: '', value: '' });

export default function ApiKeysSection() {
  const [rows, setRows] = useState<Row[]>([blank(), blank()]);
  const [primary, setPrimary] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [providers, setProviders] = useState<string[]>([]);
  const [base, setBase] = useState('');
  const [probing, setProbing] = useState(true);

  const loadFrom = async (url: string) => {
    const d = await fetch(`${url}/keys`).then((r) => r.json());
    const existing: Row[] = (d.keys || []).map((k: any) => ({ name: k.name, value: '' }));
    setRows(existing.length ? [...existing, blank()] : [blank(), blank()]);
    setPrimary(d.primary || '');
    setProviders(d.providers || []);
  };

  const probe = async (force = false) => {
    setProbing(true);
    const found = await detectLocalApi(force);
    setBase(found);

    if (found) {
      await loadFrom(found).catch(() => {});
    } else {
      try {
        const saved = await readApiKeys();
        const savedPrimary = await readPrimaryProvider();
        const names = Object.keys(saved);
        setRows(names.length
          ? [...names.map((name) => ({ name, value: '' })), blank()]
          : [blank(), blank()]);
        setPrimary(savedPrimary);
        setProviders(names.map((name) => name.replace(/_API_KEY$/, '').toLowerCase()));
      } catch {
        setStatus({ ok: false, text: 'Could not access device key storage. Reopen the app and try again.' });
      }
    }

    setProbing(false);
    return found;
  };

  useEffect(() => { void probe(); }, []);


  const update = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const connect = async () => {
    let target = base;
    if (!target) target = await probe(true);

    // Native mobile builds store the owner's keys on this device and use the
    // HTTPS Edge Function. No desktop server or Supabase login is required.
    if (!target && Capacitor.isNativePlatform()) {
      setBusy(true);
      setStatus(null);
      try {
        const saved = await readApiKeys();
        const merged: Record<string, string> = { ...saved };

        for (const row of rows) {
          const name = row.name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
          const value = row.value.trim();
          if (name && value) merged[name] = value;
        }

        const cleaned = Object.fromEntries(
          Object.entries(merged).filter(([name, value]) =>
            /^[A-Z0-9_]+$/.test(name) && typeof value === 'string' && value.trim()
          )
        );

        if (!Object.keys(cleaned).length) {
          throw new Error('Enter a provider API key first. For Gemini, use GEMINI_API_KEY.');
        }

        const preferred = primary.trim().toLowerCase();
        const hasGemini = Boolean(cleaned.GEMINI_API_KEY);
        const hasOpenRouter = Boolean(cleaned.OPENROUTER_API_KEY);
        const selectedProvider = preferred || (hasGemini ? 'gemini' : hasOpenRouter ? 'openrouter' : '');

        if (!selectedProvider || (selectedProvider !== 'gemini' && selectedProvider !== 'openrouter')) {
          throw new Error('Select gemini or openrouter as the preferred provider, or enter a Gemini/OpenRouter key.');
        }

        if (selectedProvider === 'gemini' && !hasGemini) {
          throw new Error('The preferred provider is Gemini, but GEMINI_API_KEY is empty.');
        }
        if (selectedProvider === 'openrouter' && !hasOpenRouter) {
          throw new Error('The preferred provider is OpenRouter, but OPENROUTER_API_KEY is empty.');
        }

        await saveApiKeys(cleaned, selectedProvider);

        // Verify the actual cloud provider before reporting success.
        await streamChat(
          'quinn-chat',
          { messages: [{ role: 'user', content: 'Reply with exactly: QUINN CONNECTED' }], tools: false },
          () => {},
          { attempts: 1, timeoutMs: 45000 },
        );

        setProviders([selectedProvider]);
        setRows(
          [...Object.keys(cleaned).map((name) => ({ name, value: '' })), blank()],
        );
        setStatus({
          ok: true,
          text: `Connected to ${selectedProvider}. Your key is stored on this device and is sent over HTTPS only when QUINN requests a chat response.`,
        });
      } catch (e) {
        setStatus({
          ok: false,
          text: `Key saved on this device, but connection verification failed: ${(e as Error).message}`,
        });
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!target) {
      setStatus({
        ok: false,
        text:
          window.location.protocol === 'https:'
            ? 'The local API is not reachable from this hosted page. Start QUINN on your PC with npm run dev, then open http://localhost:8080.'
            : 'The local API is offline. Start QUINN with npm run dev, which launches both the API and the interface.',
      });
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const keys = rows
        .filter((r) => r.name.trim())
        .map((r) => ({ name: r.name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_'), value: r.value.trim() }));
      const res = await fetch(`${target}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys, primary: primary.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setProviders(data.providers || []);
      setRows(
        (data.keys || []).map((k: any) => ({ name: k.name, value: '' })).concat([blank()]),
      );
      setStatus({
        ok: (data.providers || []).length > 0,
        text:
          (data.providers || []).length > 0
            ? `Connected. Active providers: ${(data.providers || []).join(', ')}`
            : 'Saved, but no cloud provider answered — QUINN will use offline rules.',
      });
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-purple-200">
        <KeyRound className="w-5 h-5" />
        <h2 className="text-sm tracking-[0.3em] uppercase">API Keys</h2>
      </div>

      <p className="text-xs text-purple-400/60 leading-relaxed">
        {Capacitor.isNativePlatform()
          ? 'Enter your provider key below. On this phone, keys are stored in encrypted device storage and sent over HTTPS to the chat service only when a response is requested.'
          : 'Paste provider keys below. Desktop keys are saved by the local QUINN engine. Browser-based secure storage is not equivalent to native device encryption.'}
      </p>

      <div className="rounded-md border border-purple-500/20 p-3 space-y-2">
        <div className="flex items-center justify-between text-[10px] tracking-[0.25em] uppercase">
          <span className="text-purple-400/60">Local engine</span>
          <span className={base ? 'text-purple-200' : 'text-amber-300'}>
            {probing ? 'SCANNING…' : base ? `ONLINE · ${base}` : 'NOT DETECTED'}
          </span>
        </div>
        <div className="flex gap-2">
          <Input
            value={base}
            onChange={(e) => { setBase(e.target.value); setLocalApi(e.target.value); }}
            placeholder="http://localhost:8787"
            className="flex-1 bg-[#310d1c]/60 border-purple-500/25 text-purple-50 text-xs font-mono placeholder:text-purple-500/30"
          />
          <Button
            onClick={() => probe(true)}
            variant="ghost"
            className="text-[10px] tracking-[0.2em] text-purple-200 border border-purple-500/25"
          >
            RETRY
          </Button>
        </div>
      </div>



      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-2">
            <Input
              list="quinn-key-names"
              value={row.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="KEY NAME"
              className="w-2/5 bg-[#310d1c]/60 border-purple-500/25 text-purple-50 text-xs font-mono placeholder:text-purple-500/30"
            />
            <Input
              type="password"
              value={row.value}
              onChange={(e) => update(i, { value: e.target.value })}
              placeholder={row.name && !row.value ? '•••••• saved' : 'paste key'}
              className="flex-1 bg-[#310d1c]/60 border-purple-500/25 text-purple-50 text-xs font-mono placeholder:text-purple-500/30"
            />
            <button
              onClick={() => setRows((r) => (r.length > 1 ? r.filter((_, idx) => idx !== i) : [blank()]))}
              className="text-purple-500/50 hover:text-red-400 px-1"
              aria-label="Remove key"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        <datalist id="quinn-key-names">
          {SUGGESTED.map((s) => <option key={s} value={s} />)}
        </datalist>
      </div>

      <button
        onClick={() => setRows((r) => (r.length < 200 ? [...r, blank()] : r))}
        className="flex items-center gap-1.5 text-[10px] tracking-[0.25em] text-purple-300/80 hover:text-purple-50"
      >
        <Plus className="w-3.5 h-3.5" /> ADD KEY
      </button>

      <div className="space-y-1.5">
        <label className="text-[10px] tracking-[0.25em] text-purple-400/60 uppercase">Preferred provider (optional)</label>
        <Input
          value={primary}
          onChange={(e) => setPrimary(e.target.value)}
          placeholder="groq | openai | gemini | openrouter…"
          className="bg-[#310d1c]/60 border-purple-500/25 text-purple-50 text-xs font-mono placeholder:text-purple-500/30"
        />
      </div>

      {providers.length > 0 && (
        <div className="text-[10px] tracking-widest text-purple-400/60 uppercase">
          Ready: {providers.join(' · ')}
        </div>
      )}

      {status && (
        <div
          className={`flex items-start gap-2 rounded-md border p-3 text-xs ${
            status.ok ? 'border-purple-500/30 text-purple-200' : 'border-amber-500/40 text-amber-300'
          }`}
        >
          {status.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <AlertTriangle className="w-4 h-4 mt-0.5" />}
          <span>{status.text}</span>
        </div>
      )}

      <Button
        onClick={connect}
        disabled={busy}
        className="w-full rounded-full bg-purple-500/15 border border-purple-400/50 text-purple-50 hover:bg-purple-500/25 tracking-[0.3em] text-[11px] h-11"
      >
        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
        {busy ? 'CONNECTING…' : 'CONNECT & RUN'}
      </Button>
    </div>
  );
}
