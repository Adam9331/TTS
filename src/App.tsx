import { useState, useRef, useEffect } from "react";
import { generateTTS, VOICES, VoiceName } from "@/lib/gemini";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toast-provider";
import { toast } from "sonner";
import {
  Play, Square, Sparkles, Pause,
  ChevronLeft, ChevronRight, Search, Bookmark, Type, List, Monitor, History
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Waveform } from "@/components/Waveform";

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
  const [isPaused, setIsPaused] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [bufferingProgress, setBufferingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState<string | null>(null);
  const [chunksLoaded, setChunksLoaded] = useState<number[]>([]);
  const [totalChunks, setTotalChunks] = useState(0);

  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [combinedAudioData, setCombinedAudioData] = useState<string | null>(null);
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [isTrackingEnabled, setIsTrackingEnabled] = useState(true);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const startTimeRef = useRef(0);
  const pauseTimeRef = useRef(0);
  const animationFrameRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const totalWordsRef = useRef(0);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
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

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const stopPlayback = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch {}
      sourceNodeRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentWordIndex(-1);
  };

  const playAudioBuffer = async (buffer: AudioBuffer, startPosition: number = 0) => {
    if (!audioContextRef.current) return;

    const ctx = audioContextRef.current;

    // Resume if suspended
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // Stop previous source
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch {}
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    sourceNodeRef.current = source;

    const startOffset = startPosition * buffer.duration;
    startTimeRef.current = ctx.currentTime - startOffset;

    source.start(0, startOffset);
    setIsPlaying(true);
    setIsPaused(false);

    console.log('Playing audio:', { startPosition, duration: buffer.duration, state: ctx.state });

    const updateProgress = () => {
      if (!audioContextRef.current || !buffer) return;

      const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / buffer.duration, 1);

      setPlaybackProgress(progress);

      if (isTrackingEnabled && totalWordsRef.current > 0) {
        const wordIdx = Math.floor(progress * totalWordsRef.current);
        setCurrentWordIndex(wordIdx);
      }

      if (progress < 1 && sourceNodeRef.current) {
        animationFrameRef.current = requestAnimationFrame(updateProgress);
      }
    };

    animationFrameRef.current = requestAnimationFrame(updateProgress);

    source.onended = () => {
      cancelAnimationFrame(animationFrameRef.current);
      if (sourceNodeRef.current === source) {
        setIsPlaying(false);
        setIsPaused(false);
        setPlaybackProgress(1);
        setCurrentWordIndex(-1);
      }
    };
  };

  const handleSeek = (progress: number) => {
    if (!audioBufferRef.current) return;
    pauseTimeRef.current = progress * audioBufferRef.current.duration;
    playAudioBuffer(audioBufferRef.current, progress);
  };

  const handleSpeak = async (textToSpeak: string = text) => {
    if (!textToSpeak.trim()) {
      toast.error("Wprowadź tekst do przeczytania");
      return;
    }

    // Prevent double invocation
    if (isLoading) {
      console.log('Already loading, skipping...');
      return;
    }

    stopPlayback();
    setIsLoading(true);
    setIsBuffering(true);
    setCombinedAudioData(null);
    setPlaybackProgress(0);
    setTotalDuration(0);
    setLoadingStatus("Przygotowuję tekst...");
    setChunksLoaded([]);
    setTotalChunks(0);

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      // Create audio context
      if (audioContextRef.current) {
        await audioContextRef.current.close();
      }
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();

      // Count words
      const words = textToSpeak.trim().split(/\s+/).filter(w => w.length > 0);
      totalWordsRef.current = words.length;

      // Split text into chunks
      const chunks: string[] = [];
      const sentences = textToSpeak.match(/[^.!?]+[.!?]+|.{1,1000}/g) || [textToSpeak];

      let currentGroup = "";
      let isFirstChunk = true;
      const firstChunkLimit = 600;
      const normalChunkLimit = 3000;

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

      // Fetch all audio chunks
      const audioDataParts: string[] = [];
      setTotalChunks(chunks.length);
      setLoadingStatus(`Pobieram audio (0/${chunks.length})...`);
      console.log(`Starting to fetch ${chunks.length} chunks...`);

      for (let i = 0; i < chunks.length; i++) {
        if (signal.aborted) {
          console.log('Aborted at chunk', i);
          break;
        }

        const chunk = chunks[i];
        setLoadingStatus(`Przetwarzam część ${i + 1} z ${chunks.length}...`);
        console.log(`Fetching chunk ${i + 1}/${chunks.length}:`, chunk.substring(0, 50) + '...');

        try {
          const audio = await generateTTS(chunk, selectedVoice);
          console.log(`Chunk ${i + 1} received:`, audio ? `${audio.length} chars` : 'null');

          if (signal.aborted) {
            console.log('Aborted after fetch at chunk', i);
            break;
          }

          if (audio) {
            audioDataParts.push(audio);
            setChunksLoaded(prev => [...prev, i + 1]);
            setBufferingProgress(((i + 1) / chunks.length) * 100);
          }
        } catch (err) {
          console.error(`Error fetching chunk ${i + 1}:`, err);
          setLoadingStatus(`Błąd przy części ${i + 1}...`);
        }
      }

      setLoadingStatus("Łączę audio...");
      console.log(`Fetched ${audioDataParts.length}/${chunks.length} chunks`);

      if (signal.aborted) {
        console.log('Aborted before combining');
        return;
      }

      if (audioDataParts.length === 0) {
        toast.error("Nie udało się wygenerować audio");
        return;
      }

      setIsBuffering(false);
      setIsLoading(false);

      // Combine all audio data
      const allBytes: number[] = [];
      for (const part of audioDataParts) {
        const binaryString = atob(part);
        for (let i = 0; i < binaryString.length; i++) {
          allBytes.push(binaryString.charCodeAt(i));
        }
      }

      const combinedBytes = new Uint8Array(allBytes);
      let binaryStr = '';
      for (let i = 0; i < combinedBytes.length; i++) {
        binaryStr += String.fromCharCode(combinedBytes[i]);
      }
      const combinedBase64 = btoa(binaryStr);
      setCombinedAudioData(combinedBase64);

      // Create AudioBuffer
      const numSamples = combinedBytes.length / 2;
      const floatData = new Float32Array(numSamples);
      const dataView = new DataView(combinedBytes.buffer);

      for (let i = 0; i < numSamples; i++) {
        const sample = dataView.getInt16(i * 2, true);
        floatData[i] = sample / 32768;
      }

      const buffer = audioContextRef.current.createBuffer(1, numSamples, 24000);
      buffer.getChannelData(0).set(floatData);
      audioBufferRef.current = buffer;

      setTotalDuration(buffer.duration);
      console.log('Audio ready:', { samples: numSamples, duration: buffer.duration });

      // Start playback
      await playAudioBuffer(buffer, 0);

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error("TTS Error:", error);
        toast.error(`Błąd: ${error.message || "Nieznany błąd"}`);
      }
    } finally {
      setIsLoading(false);
      setIsBuffering(false);
      setLoadingStatus(null);
      setChunksLoaded([]);
      setTotalChunks(0);
    }
  };

  const handlePlayPause = () => {
    if (!audioBufferRef.current || !audioContextRef.current) {
      handleSpeak();
      return;
    }

    if (isPlaying) {
      // Pause
      pauseTimeRef.current = audioContextRef.current.currentTime - startTimeRef.current;
      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.stop();
        } catch {}
        sourceNodeRef.current = null;
      }
      cancelAnimationFrame(animationFrameRef.current);
      setIsPlaying(false);
      setIsPaused(true);
    } else if (isPaused && audioBufferRef.current) {
      // Resume
      playAudioBuffer(audioBufferRef.current, pauseTimeRef.current / audioBufferRef.current.duration);
    } else if (audioBufferRef.current) {
      // Start fresh
      playAudioBuffer(audioBufferRef.current, 0);
    }
  };

  const handleStop = () => {
    stopPlayback();
    setPlaybackProgress(0);
    pauseTimeRef.current = 0;
    audioBufferRef.current = null;
    setCombinedAudioData(null);
  };

  const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;
  const estimatedSeconds = Math.ceil((wordCount / 160) * 60);
  const minutes = Math.floor(estimatedSeconds / 60);
  const seconds = estimatedSeconds % 60;

  return (
    <div className="min-h-screen bg-[#FBF9F4] text-[#1A1A1A] font-sans selection:bg-[#5A5A40]/10 selection:text-[#5A5A40]">
      <Toaster position="top-center" />

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
            {text ? "Aria Reader" : "Aria Reader"}
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

      <main className="max-w-4xl mx-auto pt-32 pb-56 px-8 min-h-screen flex flex-col relative">
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

        <div className="flex-grow flex flex-col">
          <h1 className="font-serif text-5xl font-bold text-[#000080] mb-12 text-center tracking-tight leading-tight">
            Polski Czytnik TTS
          </h1>

          <div className="relative flex-grow">
            {(isPlaying || isPaused) && isTrackingEnabled && combinedAudioData ? (
              <div className="text-2xl leading-[1.8] font-serif text-black/80 text-justify whitespace-pre-wrap">
                {text.split(/\s+/).map((word, i) => {
                  const isCurrentWord = i === currentWordIndex;
                  const isPastWord = i < currentWordIndex;
                  return (
                    <span key={i} className="relative inline-block mr-[0.3em]">
                      <motion.span
                        animate={{
                          color: isCurrentWord ? "#000080" : isPastWord ? "#5A5A40" : "inherit",
                          backgroundColor: isCurrentWord ? "rgba(0, 0, 128, 0.08)" : "transparent"
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

        <div className="fixed bottom-0 left-0 right-0 p-6 flex flex-col items-center gap-4 bg-gradient-to-t from-[#FBF9F4] via-[#FBF9F4] to-transparent">

          <div className="w-full max-w-2xl">
            <Waveform
              audioData={combinedAudioData}
              isPlaying={isPlaying}
              progress={playbackProgress}
              duration={totalDuration || estimatedSeconds}
              onSeek={handleSeek}
            />
          </div>

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

            <div className="flex items-center gap-2">
              <Button
                onClick={handlePlayPause}
                disabled={isLoading || !text.trim()}
                className="w-16 h-16 rounded-full bg-[#5A5A40] hover:bg-[#4A4A30] text-white shadow-xl shadow-[#5A5A40]/20 flex items-center justify-center transition-transform active:scale-95"
              >
                {isLoading ? (
                  <Sparkles className="w-6 h-6 animate-pulse" />
                ) : isPlaying ? (
                  <Pause className="w-6 h-6 fill-current" />
                ) : (
                  <Play className="w-6 h-6 fill-current ml-1" />
                )}
              </Button>

              {(isPlaying || isPaused || combinedAudioData) && (
                <Button
                  onClick={handleStop}
                  variant="ghost"
                  className="w-12 h-12 rounded-full hover:bg-black/5"
                >
                  <Square className="w-5 h-5 fill-current text-black/40" />
                </Button>
              )}
            </div>

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

          <div className="flex gap-6 text-[10px] font-bold uppercase tracking-[0.2em] text-black/30">
            <span>{wordCount} słów</span>
            <span>
              {totalDuration > 0
                ? `${Math.floor(totalDuration / 60)} min ${Math.floor(totalDuration % 60)} sek`
                : estimatedSeconds > 0
                  ? `~ ${minutes} min ${seconds} sek`
                  : "0 min 0 sek"}
            </span>
          </div>

          <AnimatePresence>
            {(isLoading || isBuffering) && loadingStatus && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex flex-col items-center gap-3 bg-white/80 backdrop-blur-sm rounded-2xl px-6 py-4 shadow-lg border border-black/5"
              >
                <p className="text-sm font-medium text-[#5A5A40]">
                  {loadingStatus}
                </p>

                {totalChunks > 0 && (
                  <div className="flex gap-2">
                    {Array.from({ length: totalChunks }, (_, i) => {
                      const chunkNum = i + 1;
                      const isLoaded = chunksLoaded.includes(chunkNum);
                      const isCurrent = !isLoaded && chunksLoaded.length === i;
                      return (
                        <motion.div
                          key={i}
                          initial={{ scale: 0.8 }}
                          animate={{
                            scale: isLoaded ? 1 : isCurrent ? [1, 1.1, 1] : 0.8,
                            backgroundColor: isLoaded ? "#5A5A40" : isCurrent ? "#5A5A40" : "#e5e5e5"
                          }}
                          transition={{
                            scale: isCurrent ? { repeat: Infinity, duration: 0.8 } : { duration: 0.2 }
                          }}
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                          style={{ color: isLoaded || isCurrent ? "white" : "#999" }}
                        >
                          {isLoaded ? "✓" : chunkNum}
                        </motion.div>
                      );
                    })}
                  </div>
                )}

                <div className="w-48 h-1.5 bg-black/10 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-[#5A5A40] rounded-full"
                    initial={{ width: "0%" }}
                    animate={{ width: `${bufferingProgress}%` }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
