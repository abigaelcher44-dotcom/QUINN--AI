import { useState } from "react";
import { FileText, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { streamChat, fileToDataUrl } from "@/lib/ai";
import { toast } from "sonner";
import { logReasoning } from "@/lib/reasoningLog";

type Att = { kind: "image" | "file"; mime: string; dataUrl: string; name: string };

const DocumentSection = () => {
  const [prompt, setPrompt] = useState("Summarize this and extract key facts, dates and action items.");
  const [atts, setAtts] = useState<Att[]>([]);
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);

  const onUpload = async (files: FileList | null) => {
    if (!files) return;
    const next: Att[] = [];
    for (const f of Array.from(files)) {
      const dataUrl = await fileToDataUrl(f);
      next.push({
        kind: f.type.startsWith("image/") ? "image" : "file",
        mime: f.type || "application/octet-stream",
        dataUrl, name: f.name,
      });
    }
    setAtts((prev) => [...prev, ...next]);
  };

  const run = async () => {
    if (busy) return;
    if (!atts.length && !prompt.trim()) return toast.error("Attach a file or type a prompt");
    setBusy(true); setOutput("");
    logReasoning("Docs", "analyzing", atts.map((a) => a.name).join(", ") || "prompt only", 0.9);
    try {
      await streamChat("quinn-analyze", { prompt, attachments: atts }, (d) => setOutput((o) => o + d));
    } catch (e: any) {
      toast.error(e.message || "Analysis failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="p-4 space-y-4 bg-[#240812] text-purple-50 min-h-[28rem]">
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-purple-300" />
        <h2 className="text-sm tracking-widest">DOCUMENT INTELLIGENCE</h2>
      </div>
      <div className="flex gap-2 items-center">
        <label className="flex items-center gap-2 cursor-pointer bg-purple-500/15 border border-purple-400/40 px-3 py-2 rounded text-xs tracking-widest hover:bg-purple-500/25">
          <Upload className="w-4 h-4" /> ATTACH
          <input type="file" multiple accept="image/*,application/pdf,.txt,.md,.csv" hidden onChange={(e) => onUpload(e.target.files)} />
        </label>
        <span className="text-[11px] text-purple-400/70">{atts.length ? `${atts.length} file(s) queued` : "PDFs, images, text"}</span>
      </div>
      {atts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {atts.map((a, i) => (
            <span key={i} className="text-[10px] px-2 py-1 border border-purple-500/30 rounded bg-[#310d1c]/60">{a.name}</span>
          ))}
        </div>
      )}
      <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What do you want to know?"
        className="bg-[#310d1c] border-purple-500/30 text-purple-50 placeholder:text-purple-500/40" />
      <Button onClick={run} disabled={busy} className="bg-purple-500/20 border border-purple-400/40 text-purple-50 hover:bg-purple-500/30">
        {busy ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Analyzing…</> : "Analyze"}
      </Button>
      <div className="min-h-[10rem] p-3 rounded border border-purple-500/20 bg-[#310d1c]/60 text-sm whitespace-pre-wrap leading-relaxed">
        {output || <span className="text-purple-500/50 text-xs tracking-widest">AWAITING INPUT</span>}
      </div>
    </div>
  );
};

export default DocumentSection;
