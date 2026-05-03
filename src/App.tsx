import { useState, useRef, useEffect } from "react";
import { ai, TTS_MODEL, VOICES, VoiceName } from "@/lib/gemini";
import { playPCMAudio } from "@/lib/audio";
import { Modality } from "@google/genai";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
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
  const [currentChunk, setCurrentChunk] = useState<string | null>(null);
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [isTrackingEnabled, setIsTrackingEnabled] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleSpeak = async (textToSpeak: string = text) => {
    if (!textToSpeak.trim()) {
      toast.error("Wprowadź tekst do przeczytania");
      return;
    }

    setIsLoading(true);
    setIsPlaying(true);
    
    try {
      // Only split if text is really long (over 4000 characters) to avoid unnecessary fragmentation
      let chunks: string[] = [];
      if (textToSpeak.length <= 4000) {
        chunks = [textToSpeak];
      } else {
        // Split by sentences but group them into larger chunks of ~4000 chars
        const sentences = textToSpeak.match(/[^.!?]+[.!?]+|.{1,1000}/g) || [textToSpeak];
        let currentChunk = "";
        for (const sentence of sentences) {
          if ((currentChunk + sentence).length < 4000) {
            currentChunk += sentence;
          } else {
            if (currentChunk) chunks.push(currentChunk.trim());
            currentChunk = sentence;
          }
        }
        if (currentChunk) chunks.push(currentChunk.trim());
      }
      
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

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i].trim();
        if (!chunk) continue;

        setCurrentChunk(chunk);

        if (chunks.length > 1) {
          toast.info(`Przetwarzanie części ${i + 1} z ${chunks.length}...`, { duration: 1500 });
        }

        const response = await ai.models.generateContent({
          model: TTS_MODEL,
          contents: [{ 
            parts: [{ 
              text: chunk // No need for "Przeczytaj..." prefix for the specialized TTS model
            }] 
          }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: selectedVoice },
              },
            },
          },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        
        if (base64Audio) {
          await playPCMAudio(base64Audio, 24000, (progress) => {
            if (isTrackingEnabled) {
              const words = chunk.split(/\s+/);
              
              // Calculate weights for each word to simulate pauses at punctuation
              // This helps sync the highlighting when the TTS model pauses
              const weightedWords = words.map(word => {
                let weight = word.length;
                // Add "phantom" length for punctuation to simulate pauses
                if (word.endsWith('.') || word.endsWith('!') || word.endsWith('?')) weight += 12;
                else if (word.endsWith(',')) weight += 6;
                else if (word.endsWith(';') || word.endsWith(':')) weight += 4;
                return weight;
              });
              
              const totalWeight = weightedWords.reduce((a, b) => a + b, 0);
              
              // Find the word corresponding to the current progress
              let currentWeightSum = 0;
              for (let j = 0; j < words.length; j++) {
                currentWeightSum += weightedWords[j];
                if (currentWeightSum / totalWeight >= progress) {
                  setCurrentWordIndex(j);
                  break;
                }
              }
            }
          });
        } else {
          console.error("No audio data in response candidate:", response.candidates?.[0]);
          throw new Error("Nie otrzymano danych audio dla fragmentu " + (i + 1));
        }
      }
    } catch (error: any) {
      console.error("TTS Error Details:", error);
      const errorMessage = error?.message || "Nieznany błąd";
      toast.error(`Błąd: ${errorMessage}. Spróbuj ponownie za chwilę.`);
    } finally {
      setIsLoading(false);
      setIsPlaying(false);
      setCurrentChunk(null);
      setCurrentWordIndex(-1);
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
              onClick={() => handleSpeak()}
              disabled={isLoading || !text.trim()}
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
              <span>20 z 407</span>
              <span>4 str. do końca rozdziału</span>
            </div>
            <div className="h-1 bg-black/5 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-[#5A5A40]/20"
                initial={{ width: "0%" }}
                animate={{ width: "15%" }}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
