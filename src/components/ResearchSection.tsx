import { useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { streamChat } from "@/lib/ai";
import { toast } from "sonner";
import { logReasoning } from "@/lib/reasoningLog";

const ResearchSection = () => {
  const [q, setQ] = useState("");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (!q.trim() || busy) return;
    setBusy(true); setOut("");
    logReasoning("Research", "compiling findings", q.slice(0, 60), 0.85);
    try {
      await streamChat("quinn-chat", {
        messages: [
          { role: "system", content: "You are QUINN AI's Research agent. Provide a structured briefing with: TL;DR, Key findings (numbered), Contrasting views, Recommended sources (with URLs when known). Flag uncertainty explicitly. Never fabricate URLs — if unsure, say 'no verifiable source'." },
          { role: "user", content: q },
        ],
      }, (d) => setOut((o) => o + d));
    } catch (e: any) {
      toast.error(e.message || "Research failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="p-4 space-y-4 bg-[#240812] text-purple-50 min-h-[28rem]">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-purple-300" />
        <h2 className="text-sm tracking-widest">RESEARCH BRIEFING</h2>
      </div>
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder="Ask anything — competitors, science, market data…"
          className="bg-[#310d1c] border-purple-500/30 text-purple-50 placeholder:text-purple-500/40" />
        <Button onClick={go} disabled={busy} className="bg-purple-500/20 border border-purple-400/40 text-purple-50 hover:bg-purple-500/30">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Brief"}
        </Button>
      </div>
      <div className="min-h-[14rem] p-3 rounded border border-purple-500/20 bg-[#310d1c]/60 text-sm whitespace-pre-wrap leading-relaxed">
        {out || <span className="text-purple-500/50 text-xs tracking-widest">AWAITING QUERY</span>}
      </div>
    </div>
  );
};

export default ResearchSection;
