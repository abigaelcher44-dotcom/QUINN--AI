import { useEffect, useRef, useState } from "react";
import { Mic, Square, Play, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  getVoiceCharacter,
  setVoiceCharacter,
  onVoiceCharacterChanged,
} from "@/lib/voiceMode";
import {
  VoiceProfile,
  listVoiceProfiles,
  getBuiltInVoiceProfiles,
  saveVoiceProfile,
  deleteVoiceProfile,
  setActiveVoice,
  getActiveVoiceId,
  speakWithProfile,
} from "@/lib/voiceProfiles";

const VoiceStudio = () => {
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [recording, setRecording] = useState(false);
  const [sample, setSample] = useState<string | undefined>();
  const [pitch, setPitch] = useState(1);
  const [rate, setRate] = useState(1);
  const [voiceURI, setVoiceURI] = useState<string>("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceCharacter, setVoiceCharacterState] = useState(getVoiceCharacter);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<BlobPart[]>([]);

  const refresh = () => {
    setProfiles([...getBuiltInVoiceProfiles(), ...listVoiceProfiles()]);
    setActiveId(
      getActiveVoiceId() ??
      (getVoiceCharacter() === "vegeta" ? "builtin-vegeta" : "builtin-goku")
    );
  };

  useEffect(() => {
    refresh();
    const unsubscribe = onVoiceCharacterChanged((character) => {
      setVoiceCharacterState(character);
      refresh();
    });
    const load = () => setVoices(speechSynthesis.getVoices());
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      unsubscribe();
      speechSynthesis.removeEventListener("voiceschanged", load);
    };
  }, []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = () => setSample(reader.result as string);
        reader.readAsDataURL(blob);
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch {
      toast.error("Microphone access denied.");
    }
  };

  const stop = () => {
    recRef.current?.stop();
    setRecording(false);
  };

  const save = () => {
    if (!name.trim()) return toast.error("Name the voice profile first.");
    saveVoiceProfile({
      id: crypto.randomUUID(),
      name: name.trim(),
      sample,
      voiceURI: voiceURI || undefined,
      pitch,
      rate,
      createdAt: Date.now(),
    });
    setName("");
    setSample(undefined);
    refresh();
    toast.success("Voice profile stored.");
  };

  return (
    <div className="p-4 space-y-5 text-purple-50">
      <div>
        <h3 className="text-sm tracking-[0.3em] text-purple-300">VOICE STUDIO</h3>
        <p className="text-xs text-purple-400/60 mt-1">
          Record a sample, tune the clone, and set QUINN's active speaking voice.
        </p>
      </div>

      <div className="rounded-md border border-emerald-500/30 bg-black/70 p-4 space-y-3">
        <div>
          <div className="text-sm font-bold tracking-widest text-emerald-200">
            QUINN VOICE CHARACTER
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Choose the personality and speaking profile QUINN should use.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            aria-pressed={voiceCharacter === "goku"}
            onClick={() => {
              setVoiceCharacter("goku");
              setVoiceCharacterState("goku");
              setActiveVoice("builtin-goku");
              refresh();
              toast.success("Goku voice profile selected.");
            }}
            className={`rounded-md border p-3 text-left transition-colors ${
              voiceCharacter === "goku"
                ? "border-orange-400 bg-orange-950/60 text-orange-100"
                : "border-slate-600 bg-slate-950 text-slate-300"
            }`}
          >
            <span className="block text-sm font-bold tracking-widest">GOKU</span>
            <span className="mt-1 block text-xs opacity-75">
              Energetic, optimistic and encouraging.
            </span>
            <span className="mt-2 block text-[10px] font-bold">
              {voiceCharacter === "goku" ? "ACTIVE" : "SELECT"}
            </span>
          </button>

          <button
            type="button"
            aria-pressed={voiceCharacter === "vegeta"}
            onClick={() => {
              setVoiceCharacter("vegeta");
              setVoiceCharacterState("vegeta");
              setActiveVoice("builtin-vegeta");
              refresh();
              toast.success("Vegeta voice profile selected.");
            }}
            className={`rounded-md border p-3 text-left transition-colors ${
              voiceCharacter === "vegeta"
                ? "border-blue-400 bg-blue-950/60 text-blue-100"
                : "border-slate-600 bg-slate-950 text-slate-300"
            }`}
          >
            <span className="block text-sm font-bold tracking-widest">VEGETA</span>
            <span className="mt-1 block text-xs opacity-75">
              Intense, disciplined and commanding.
            </span>
            <span className="mt-2 block text-[10px] font-bold">
              {voiceCharacter === "vegeta" ? "ACTIVE" : "SELECT"}
            </span>
          </button>
        </div>

        <p className="text-[10px] text-slate-500">
          Actual voice depth and tone depend on the speech voices installed on this PC.
        </p>
      </div>

      <div className="rounded-md border border-purple-500/25 bg-[#310d1c]/60 p-4 space-y-4">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Profile name (e.g. My Voice)"
          className="bg-[#240812] border-purple-500/30 text-purple-50"
        />

        <div className="flex items-center gap-2">
          {recording ? (
            <Button onClick={stop} className="bg-red-500/20 border border-red-400/40 text-red-100">
              <Square className="w-4 h-4 mr-2" /> Stop
            </Button>
          ) : (
            <Button onClick={start} className="bg-purple-500/20 border border-purple-400/40 text-purple-50">
              <Mic className="w-4 h-4 mr-2" /> Record sample
            </Button>
          )}
          {sample && <audio controls src={sample} className="h-8" />}
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <label className="space-y-1">
            <span className="text-purple-400/70">Pitch {pitch.toFixed(2)}</span>
            <input
              type="range" min={0.5} max={2} step={0.05}
              value={pitch} onChange={(e) => setPitch(Number(e.target.value))}
              className="w-full accent-purple-400"
            />
          </label>
          <label className="space-y-1">
            <span className="text-purple-400/70">Rate {rate.toFixed(2)}</span>
            <input
              type="range" min={0.5} max={2} step={0.05}
              value={rate} onChange={(e) => setRate(Number(e.target.value))}
              className="w-full accent-purple-400"
            />
          </label>
        </div>

        <select
          value={voiceURI}
          onChange={(e) => setVoiceURI(e.target.value)}
          className="w-full bg-[#240812] border border-purple-500/30 rounded-md text-xs p-2 text-purple-50"
        >
          <option value="">Auto timbre</option>
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>

        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() =>
              speakWithProfile("QUINN AI online. Your intelligent assistant, ready when you are.")
            }
            className="text-purple-300 border border-purple-500/30"
          >
            <Play className="w-4 h-4 mr-2" /> Preview
          </Button>
          <Button onClick={save} className="bg-purple-500/20 border border-purple-400/40 text-purple-50">
            Save profile
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {profiles.length === 0 && (
          <p className="text-xs text-purple-400/50">No voice profiles yet.</p>
        )}
        {profiles.map((p) => (
          <div
            key={p.id}
            className={`flex items-center gap-3 rounded-md border p-3 ${
              activeId === p.id ? "border-purple-400/60 bg-purple-500/10" : "border-purple-500/20 bg-[#310d1c]/50"
            }`}
          >
            <div className="flex-1">
              <div className="text-sm">{p.name}</div>
              {p.description && (
                <div className="text-[10px] text-purple-300/70">{p.description}</div>
              )}
              <div className="text-[10px] text-purple-400/60">
                pitch {p.pitch.toFixed(2)} · rate {p.rate.toFixed(2)}
                {p.builtIn ? " · built-in" : ""}
              </div>
            </div>
            {p.sample && <audio controls src={p.sample} className="h-7 w-32" />}
            <Button
              size="icon" variant="ghost"
              onClick={() => { setActiveVoice(p.id); refresh(); toast.success(`${p.name} active`); }}
              className="text-purple-300"
            >
              <Check className="w-4 h-4" />
            </Button>
            {!p.builtIn && (
              <Button
                size="icon" variant="ghost"
                onClick={() => { deleteVoiceProfile(p.id); refresh(); }}
                className="text-red-300"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default VoiceStudio;
