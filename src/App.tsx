import { useState, useRef, useEffect } from "react";
import { ai, TTS_MODEL, VOICES, VoiceName } from "./lib/gemini";
import { playPCMAudio } from "./lib/audio";
import { Modality } from "@google/genai";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { Toaster } from "./components/ui/toaster";
import { toast } from "sonner";
import { 
  Volume2, Play, Square, History, Trash2, Languages, Sparkles, 
  ChevronLeft, ChevronRight, Search, Bookmark, Type, List, Monitor
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface HistoryItem {
  id: string;
  text: string;
  timestamp: number;
  voice: string;
}

export default function App() {
  const [text, setText] = useState("");
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>("Kore");
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [bufferingProgress, setBufferingProgress] = useState(0);
  const [currentChunk, setCurrentChunk] = useState<string | null>(null);

  useEffect(() => {
    let interval: any;
    if (isBuffering) {
      setBufferingProgress(0);
      interval = setInterval(() => {
        setBufferingProgress(prev => {
          if (prev < 90) return prev + (90 - prev) * 0.1;
          return prev;
        });
      }, 200);
    } else {
      setBufferingProgress(0);
    }
    return () => clearInterval(interval);
  }, [isBuffering]);
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [isTrackingEnabled, setIsTrackingEnabled] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleSpeak = async (textToSpeak: string = text) => {
    if (!textToSpeak.trim()) {
      toast.error("Wprowadź tekst do przeczytania");
      return;
    }

    setIsLoading(true);
    setIsBuffering(true);
    setIsPlaying(true);
    setCurrentWordIndex(-1);
    
    // Stop any previous playback if necessary (not fully implemented here but using abortControllerRef)
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

    try {
      // Split text into intelligent chunks
      // First chunk is small for instant response, subsequent are larger for efficiency
      const chunks: string[] = [];
      const sentences = textToSpeak.match(/[^.!?]+[.!?]+|.{1,1000}/g) || [textToSpeak];
      
      let currentGroup = "";
      let isFirstChunk = true;
      const firstChunkLimit = 600; // Small first chunk for fast start
      const normalChunkLimit = 3000; // Larger subsequent chunks

      for (const sentence of sentences) {
        const limit = isFirstChunk ? firstChunkLimit : normalChunkLimit;
        if ((currentGroup + sentence).length < limit) { 
          currentGroup += sentence;
        } else {
          if (currentGroup) {
            chunks.push(currentGroup.trim());
            isFirstChunk = false;
          }
          currentGroup = sentence;
        }
      }
      if (currentGroup) chunks.push(currentGroup.trim());

      // Add to history
      if (textToSpeak === text) {
        const newItem: HistoryItem = {
          id: crypto.randomUUID(),
          text: textToSpeak,
          timestamp: Date.now(),
          voice: selectedVoice,
        };
        setHistory(prev => [newItem, ...prev].slice(0, 10));
      }

      // Helper to fetch audio for a specific chunk
      const fetchAudio = async (chunk: string): Promise<string | null> => {
        try {
          const response = await ai.models.generateContent({
            model: TTS_MODEL,
            contents: [{ parts: [{ text: chunk }] }],
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: selectedVoice },
                },
              },
            },
          });
          return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
        } catch (err) {
          console.error("Fetch audio error:", err);
          return null;
        }
      };

      // Prefetch state
      const prefetchQueue: Promise<string | null>[] = [];
      const MAX_PREFETCH = 2;

      // Word tracking global offset
      let globalWordOffset = 0;

      for (let i = 0; i < chunks.length; i++) {
        if (signal.aborted) break;

        const chunk = chunks[i];
        
        while (prefetchQueue.length < MAX_PREFETCH && (i + prefetchQueue.length) < chunks.length) {
          const nextIdx = i + prefetchQueue.length;
          prefetchQueue.push(fetchAudio(chunks[nextIdx]));
        }

        const audioPromise = prefetchQueue.shift();
        const base64Audio = await audioPromise;

        if (signal.aborted) break;
        
        // Disable buffering indicator once we have the first chunk and start playing
        if (i === 0) {
          setIsBuffering(false);
          setIsLoading(false);
        }

        if (!base64Audio) continue;

        setCurrentChunk(chunk);

        const chunkOffset = globalWordOffset;
        const chunkWords = chunk.split(/\s+/).filter(w => w.length > 0);

        await playPCMAudio(base64Audio, 24000, (progress) => {
          if (isTrackingEnabled && !signal.aborted) {
            const weightedWords = chunkWords.map(word => {
              let weight = word.length;
              if (word.endsWith('.') || word.endsWith('!') || word.endsWith('?')) weight += 15;
              else if (word.endsWith(',')) weight += 8;
              return weight;
            });
            
            const totalWeight = weightedWords.reduce((a, b) => a + b, 0);
            let currentWeightSum = 0;
            for (let j = 0; j < chunkWords.length; j++) {
              currentWeightSum += weightedWords[j];
              if (currentWeightSum / totalWeight >= progress) {
                setCurrentWordIndex(chunkOffset + j);
                break;
              }
            }
          }
        }, signal, audioContext);

        globalWordOffset += chunkWords.length;
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error("TTS Error Details:", error);
        toast.error(`Błąd: ${error.message || "Nieznany błąd"}`);
      }
    } finally {
      audioContext.close().catch(() => {});
      setIsLoading(false);
      setIsBuffering(false);
      setIsPlaying(false);
      setCurrentChunk(null);
      setCurrentWordIndex(-1);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const clearHistory = () => {
    setHistory([]);
    toast.success("Historia wyczyszczona");
  };

  const copyFromHistory = (itemText: string) => {
    setText(itemText);
    toast.success("Tekst skopiowany do edytora");
  };

  // Estimate duration: ~160 words per minute
  const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;
  const estimatedSeconds = Math.ceil((wordCount / 160) * 60);
  const minutes = Math.floor(estimatedSeconds / 60);
  const seconds = estimatedSeconds % 60;

  return (
    <div className="min-h-screen bg-[#FBF9F4] text-[#1A1A1A] font-sans selection:bg-[#5A5A40]/10 selection:text-[#5A5A40]">
      <Toaster position="top-center" />
      
      {/* Top Navigation Bar */}
      <nav className="fixed top-0 left-0 right-0 h-16 bg-[#FBF9F4]/80 backdrop-blur-md z-50 px-6 flex items-center justify-between border-b border-black/5">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="rounded-full hover:bg-black/5">
            <List className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full hover:bg-black/5">
            <Monitor className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full hover:bg-black/5">
            <History className="w-5 h-5" />
          </Button>
        </div>

        <div className="absolute left-1/2 -translate-x-1/2 text-center">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-black/40 truncate max-w-[300px]">
            {text ? "Nawyk samodyscypliny. Zaprogramuj wewnętrznego stróża" : "Aria Reader"}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="rounded-full hover:bg-black/5">
            <Type className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full hover:bg-black/5">
            <Search className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full hover:bg-black/5">
            <Bookmark className="w-5 h-5" />
          </Button>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto pt-32 pb-24 px-8 min-h-screen flex flex-col relative">
        {/* Navigation Arrows */}
        <div className="fixed left-8 top-1/2 -translate-y-1/2 hidden xl:block">
          <Button variant="ghost" size="icon" className="w-12 h-12 rounded-full hover:bg-black/5">
            <ChevronLeft className="w-8 h-8 opacity-40" />
          </Button>
        </div>
        <div className="fixed right-8 top-1/2 -translate-y-1/2 hidden xl:block">
          <Button variant="ghost" size="icon" className="w-12 h-12 rounded-full hover:bg-black/5">
            <ChevronRight className="w-8 h-8 opacity-40" />
          </Button>
        </div>

        {/* Content Area */}
        <div className="flex-grow flex flex-col">
          <h1 className="font-serif text-5xl font-bold text-[#000080] mb-12 text-center tracking-tight leading-tight">
            Nowa definicja odkładania działania
          </h1>

          <div className="relative flex-grow">
            {isPlaying && isTrackingEnabled && currentChunk ? (
              <div className="text-2xl leading-[1.8] font-serif text-black/80 text-justify whitespace-pre-wrap">
                {text.split(/\s+/).map((word, i) => {
                  const isCurrentWord = i === currentWordIndex;
                  return (
                    <span key={i} className="relative inline-block mr-[0.3em]">
                      <motion.span
                        animate={{ 
                          color: isCurrentWord ? "#000080" : "inherit",
                          backgroundColor: isCurrentWord ? "rgba(0, 0, 128, 0.05)" : "transparent"
                        }}
                        className="px-1 rounded-sm transition-colors duration-200"
                      >
                        {word}
                      </motion.span>
                    </span>
                  );
                })}
              </div>
            ) : (
              <textarea
                placeholder="Wklej tutaj tekst do przeczytania..."
                className="w-full min-h-[500px] bg-transparent text-2xl leading-[1.8] font-serif text-black/80 text-justify resize-none border-none outline-none placeholder:text-black/10"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            )}
          </div>
        </div>

        {/* Bottom Controls */}
        <div className="fixed bottom-0 left-0 right-0 p-8 flex flex-col items-center gap-6 bg-gradient-to-t from-[#FBF9F4] via-[#FBF9F4] to-transparent">
          <div className="flex items-center gap-8">
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-black/30">Głos</span>
              <select 
                value={selectedVoice} 
                onChange={(e) => setSelectedVoice(e.target.value as VoiceName)}
                className="bg-transparent text-xs font-bold uppercase tracking-widest outline-none cursor-pointer hover:text-[#5A5A40]"
              >
                {VOICES.map(v => <option key={v.name} value={v.name}>{v.label}</option>)}
              </select>
            </div>

            <Button 
              onClick={() => isPlaying ? handleStop() : handleSpeak()}
              disabled={(isLoading && !isPlaying) || !text.trim()}
              className="w-16 h-16 rounded-full bg-[#5A5A40] hover:bg-[#4A4A30] text-white shadow-xl shadow-[#5A5A40]/20 flex items-center justify-center transition-transform active:scale-95"
            >
              {isLoading ? (
                <Sparkles className="w-6 h-6 animate-pulse" />
              ) : isPlaying ? (
                <Square className="w-6 h-6 fill-current" />
              ) : (
                <Play className="w-6 h-6 fill-current ml-1" />
              )}
            </Button>

            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-black/30">Śledzenie</span>
              <button 
                onClick={() => setIsTrackingEnabled(!isTrackingEnabled)}
                className={`text-xs font-bold uppercase tracking-widest transition-colors ${isTrackingEnabled ? 'text-[#5A5A40]' : 'text-black/20'}`}
              >
                {isTrackingEnabled ? 'Włączone' : 'Wyłączone'}
              </button>
            </div>
          </div>

          <div className="w-full max-w-md flex flex-col gap-2">
            <div className="flex justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-black/20">
              <span>{wordCount} słów</span>
              <span>
                {estimatedSeconds > 0 
                  ? `~ ${minutes} min ${seconds} sek nagrania` 
                  : "0 min 0 sek"}
              </span>
            </div>
            
            <div className="h-1 bg-black/5 rounded-full overflow-hidden relative">
              {/* Buffering Progress Bar (First chunk) */}
              <AnimatePresence>
                {isBuffering && (
                  <motion.div 
                    initial={{ width: "0%" }}
                    animate={{ width: `${bufferingProgress}%` }}
                    exit={{ width: "100%", transition: { duration: 0.2 } }}
                    className="absolute inset-0 bg-[#5A5A40]/40 z-10"
                  />
                )}
              </AnimatePresence>

              {/* Main reading progress */}
              <motion.div 
                className="h-full bg-[#5A5A40]"
                initial={{ width: "0%" }}
                animate={{ 
                  width: isPlaying && !isBuffering 
                    ? `${Math.min(100, (currentWordIndex / Math.max(1, wordCount)) * 100)}%` 
                    : "0%" 
                }}
                transition={{ type: "spring", bounce: 0, duration: 0.5 }}
              />
            </div>
            {isBuffering && (
              <motion.p 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-[9px] font-bold uppercase tracking-widest text-[#5A5A40] text-center mt-1"
              >
                Przygotowanie audio: {Math.round(bufferingProgress)}%
              </motion.p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
