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

interface AudioChunk {
  index: number;
  text: string;
  buffer: AudioBuffer | null;
  status: 'pending' | 'fetching' | 'ready' | 'scheduled' | 'error';
  wordsCount: number;
}

export default function App() {
  const [text, setText] = useState("");
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>("Kore");
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isPlaying, _setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const setIsPlaying = (val: boolean) => {
    isPlayingRef.current = val;
    _setIsPlaying(val);
  };

  const [isPaused, setIsPaused] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string | null>(null);

  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [isTrackingEnabled, setIsTrackingEnabled] = useState(true);

  // Streaming State Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSourcesRef = useRef<Map<number, AudioBufferSourceNode>>(new Map());
  const chunksQueueRef = useRef<AudioChunk[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentChunkIndexRef = useRef(-1);
  const nextStartTimeRef = useRef(0);
  const globalWordsPlayedRef = useRef(0);
  const animationFrameRef = useRef<number>(0);
  const playbackStartTimeRef = useRef(0);
  
  // Waveform state for the current active chunk
  const [currentVisualData, setCurrentVisualData] = useState<string | null>(null);
  const [currentChunkDuration, setCurrentChunkDuration] = useState(0);
  const [totalEstimatedDuration, setTotalEstimatedDuration] = useState(0);

  useEffect(() => {
    return () => {
      stopPlayback();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  const stopPlayback = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    setIsPlaying(false);
    setIsPaused(false);
    
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch {}
    });
    activeSourcesRef.current.clear();
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    setIsLoading(false);
    setIsBuffering(false);
    setLoadingStatus(null);
    setCurrentWordIndex(-1);
    setPlaybackProgress(0);
    setCurrentVisualData(null);
    
    chunksQueueRef.current = [];
    currentChunkIndexRef.current = -1;
    nextStartTimeRef.current = 0;
    globalWordsPlayedRef.current = 0;
  };

  const decodeAudioBase64 = async (ctx: AudioContext, base64: string): Promise<AudioBuffer> => {
    try {
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const numSamples = bytes.length / 2;
      const floatData = new Float32Array(numSamples);
      const dataView = new DataView(bytes.buffer);

      for (let i = 0; i < numSamples; i++) {
        if (i * 2 + 1 < bytes.length) {
          floatData[i] = dataView.getInt16(i * 2, true) / 32768;
        }
      }

      const buffer = ctx.createBuffer(1, numSamples, 24000);
      buffer.getChannelData(0).set(floatData);
      return buffer;
    } catch (e) {
      console.error("Decode error:", e);
      throw e;
    }
  };

  const fetchNextChunk = async () => {
    const queue = chunksQueueRef.current;
    if (!isPlayingRef.current || !abortControllerRef.current) return;

    // Find next pending chunk
    const nextChunk = queue.find(c => c.status === 'pending');
    if (!nextChunk) return;

    nextChunk.status = 'fetching';
    // Only show status if we are still buffering the very beginning
    if (nextChunk.index < 3) {
      setLoadingStatus(`Pobieram fragment ${nextChunk.index + 1}...`);
    }
    
    try {
      const audioBase64 = await generateTTS(nextChunk.text, selectedVoice);
      if (abortControllerRef.current?.signal.aborted) return;
      
      if (audioBase64 && audioContextRef.current) {
        nextChunk.buffer = await decodeAudioBase64(audioContextRef.current, audioBase64);
        nextChunk.status = 'ready';
        
        // Save base64 for waveform if it's the first one
        if (nextChunk.index === 0) {
          setCurrentVisualData(audioBase64);
        }
        
        // Trigger scheduling immediately
        scheduleNextChunks();
      } else {
        nextChunk.status = 'error';
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        nextChunk.status = 'error';
        console.error("Fetch error:", e);
      }
    }
    
    // Proactively fetch next
    if (isPlayingRef.current) {
      fetchNextChunk();
    }
  };

  const scheduleNextChunks = () => {
    const ctx = audioContextRef.current;
    if (!ctx || !isPlayingRef.current) return;
    
    const PRELOAD_TIME = 3.0; 
    const queue = chunksQueueRef.current;

    for (let i = 0; i < queue.length; i++) {
      const chunk = queue[i];
      if (chunk.status === 'ready') {
        
        if (nextStartTimeRef.current === 0) {
          nextStartTimeRef.current = ctx.currentTime + 0.2;
          playbackStartTimeRef.current = nextStartTimeRef.current;
          setIsBuffering(false);
          setIsLoading(false);
          setLoadingStatus(null);
        }

        if (nextStartTimeRef.current <= ctx.currentTime + PRELOAD_TIME) {
          chunk.status = 'scheduled'; // FIXED: Prevent loop
          const source = ctx.createBufferSource();
          source.buffer = chunk.buffer;
          source.connect(ctx.destination);
          
          source.start(nextStartTimeRef.current);
          activeSourcesRef.current.set(chunk.index, source);
          
          source.onended = () => {
             activeSourcesRef.current.delete(chunk.index);
             if (chunk.index === queue.length - 1) {
                 stopPlayback();
             }
          };

          nextStartTimeRef.current += chunk.buffer!.duration;
        }
      }
    }
  };

  const updateProgressLoop = () => {
    if (!audioContextRef.current || !isPlayingRef.current) return;
    const ctx = audioContextRef.current;
    const queue = chunksQueueRef.current;
    
    let timeAccumulator = playbackStartTimeRef.current;
    let playingIdx = -1;
    let timeIntoCurrentChunk = 0;
    
    for (let i = 0; i < queue.length; i++) {
      const chunk = queue[i];
      if (chunk.buffer) {
        const chunkEnd = timeAccumulator + chunk.buffer.duration;
        if (ctx.currentTime >= timeAccumulator && ctx.currentTime < chunkEnd) {
          playingIdx = i;
          timeIntoCurrentChunk = ctx.currentTime - timeAccumulator;
          break;
        }
        timeAccumulator += chunk.buffer.duration;
      }
    }

    if (playingIdx !== -1) {
       if (playingIdx !== currentChunkIndexRef.current) {
         currentChunkIndexRef.current = playingIdx;
         setCurrentChunkDuration(queue[playingIdx].buffer!.duration);
       }
       
       const chunkProgress = timeIntoCurrentChunk / queue[playingIdx].buffer!.duration;
       setPlaybackProgress(chunkProgress);

       if (isTrackingEnabled) {
          let wordsBefore = 0;
          for (let i = 0; i < playingIdx; i++) wordsBefore += queue[i].wordsCount;
          const currentChunkWord = Math.floor(chunkProgress * queue[playingIdx].wordsCount);
          setCurrentWordIndex(wordsBefore + currentChunkWord);
       }
       
       // Periodically check if we need to schedule more
       scheduleNextChunks();
    }

    animationFrameRef.current = requestAnimationFrame(updateProgressLoop);
  };

  const handleSpeak = async () => {
    if (!text.trim()) {
      toast.error("Wprowadź tekst");
      return;
    }

    stopPlayback();
    setIsLoading(true);
    setIsBuffering(true);
    setIsPlaying(true); // Set both state and ref
    
    abortControllerRef.current = new AbortController();

    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;
      await ctx.resume();

      const words = text.trim().split(/\s+/).filter(w => w.length > 0);
      setTotalEstimatedDuration(words.length / (160/60));

      const chunks: AudioChunk[] = [];
      const sentences = text.match(/[^.!?\n]+[.!?\n]+|.{1,400}/g) || [text];
      let currentGroup = "";

      for (const sentence of sentences) {
        if ((currentGroup + sentence).length < 600) {
          currentGroup += sentence;
        } else {
          if (currentGroup.trim()) {
            chunks.push({ index: chunks.length, text: currentGroup.trim(), buffer: null, status: 'pending', wordsCount: currentGroup.trim().split(/\s+/).length });
          }
          currentGroup = sentence;
        }
      }
      if (currentGroup.trim()) {
        chunks.push({ index: chunks.length, text: currentGroup.trim(), buffer: null, status: 'pending', wordsCount: currentGroup.trim().split(/\s+/).length });
      }

      chunksQueueRef.current = chunks;
      
      // Start loops
      fetchNextChunk();
      // Start second parallel fetcher for speed
      setTimeout(() => fetchNextChunk(), 500);
      
      animationFrameRef.current = requestAnimationFrame(updateProgressLoop);
    } catch (e) {
      console.error("Context error:", e);
      stopPlayback();
    }
  };

  const handlePlayPause = async () => {
    if (!audioContextRef.current || chunksQueueRef.current.length === 0) {
      handleSpeak();
      return;
    }

    const ctx = audioContextRef.current;
    if (ctx.state === 'running') {
      await ctx.suspend();
      setIsPlaying(false);
      setIsPaused(true);
      cancelAnimationFrame(animationFrameRef.current);
    } else if (ctx.state === 'suspended') {
      await ctx.resume();
      setIsPlaying(true);
      setIsPaused(false);
      animationFrameRef.current = requestAnimationFrame(updateProgressLoop);
      scheduleNextChunks(); // Make sure the pipeline continues
    }
  };

  const handleSeek = (progress: number) => {
    // Advanced seeking in a streamed setup is complex. 
    // For this prototype, we'll disable seeking or only allow it if fully buffered.
    toast.info("Przewijanie jest wyłączone w trybie odtwarzania na żywo.");
  };

  const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;
  const minutes = Math.floor(totalEstimatedDuration / 60);
  const seconds = Math.floor(totalEstimatedDuration % 60);

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
            {text ? "Aria Reader (Live Streaming)" : "Aria Reader"}
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
            Polski Czytnik TTS (Live)
          </h1>

          <div className="relative flex-grow">
            {(isPlaying || isPaused) && isTrackingEnabled ? (
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
                placeholder="Wklej tutaj dowolnie długi tekst (nawet 15 minut czytania!). Od razu zacznie go czytać, pobierając resztę w tle..."
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
              audioData={currentVisualData}
              isPlaying={isPlaying}
              progress={playbackProgress}
              duration={currentChunkDuration}
              onSeek={handleSeek}
            />
            {loadingStatus && (
               <p className="text-xs text-center text-black/30 mt-1 uppercase font-bold tracking-wider">{loadingStatus}</p>
            )}
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
                disabled={isLoading && isBuffering && !isPlaying}
                className="w-16 h-16 rounded-full bg-[#5A5A40] hover:bg-[#4A4A30] text-white shadow-xl shadow-[#5A5A40]/20 flex items-center justify-center transition-transform active:scale-95"
              >
                {isBuffering ? (
                  <Sparkles className="w-6 h-6 animate-pulse" />
                ) : isPlaying ? (
                  <Pause className="w-6 h-6 fill-current" />
                ) : (
                  <Play className="w-6 h-6 fill-current ml-1" />
                )}
              </Button>

              {(isPlaying || isPaused || currentChunkIndexRef.current >= 0) && (
                <Button
                  onClick={stopPlayback}
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
              ~ {minutes} min {seconds} sek
            </span>
          </div>

        </div>
      </main>
    </div>
  );
}
