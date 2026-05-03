import { useRef, useEffect, useState, useCallback } from "react";
import { motion } from "motion/react";

interface WaveformProps {
  audioData: string | null; // Base64 PCM audio
  isPlaying: boolean;
  progress: number; // 0-1
  duration: number; // seconds
  onSeek: (progress: number) => void;
}

export function Waveform({ audioData, isPlaying, progress, duration, onSeek }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [isHovering, setIsHovering] = useState(false);
  const [hoverPosition, setHoverPosition] = useState(0);

  // Generate waveform data from audio
  useEffect(() => {
    if (!audioData) {
      // Generate placeholder waveform
      const bars = 100;
      const placeholder = Array.from({ length: bars }, () => 0.2 + Math.random() * 0.6);
      setWaveformData(placeholder);
      return;
    }

    try {
      const binaryString = atob(audioData);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const numSamples = len / 2;
      const dataView = new DataView(bytes.buffer);

      // Sample down to ~100 bars
      const bars = 100;
      const samplesPerBar = Math.floor(numSamples / bars);
      const waveform: number[] = [];

      for (let i = 0; i < bars; i++) {
        let sum = 0;
        for (let j = 0; j < samplesPerBar; j++) {
          const idx = (i * samplesPerBar + j) * 2;
          if (idx + 1 < len) {
            const sample = Math.abs(dataView.getInt16(idx, true));
            sum += sample;
          }
        }
        const avg = sum / samplesPerBar / 32768;
        waveform.push(Math.min(1, avg * 3)); // Amplify for visibility
      }

      setWaveformData(waveform);
    } catch (e) {
      console.error("Error parsing audio for waveform:", e);
    }
  }, [audioData]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformData.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const barWidth = width / waveformData.length;
    const gap = 2;

    ctx.clearRect(0, 0, width, height);

    waveformData.forEach((value, index) => {
      const barHeight = Math.max(4, value * height * 0.8);
      const x = index * barWidth;
      const y = (height - barHeight) / 2;

      const barProgress = index / waveformData.length;
      const isPlayed = barProgress <= progress;

      // Gradient effect for played portion
      if (isPlayed) {
        ctx.fillStyle = "#5A5A40";
      } else {
        ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
      }

      // Draw rounded bar
      const radius = Math.min(2, (barWidth - gap) / 2);
      ctx.beginPath();
      ctx.roundRect(x + gap / 2, y, barWidth - gap, barHeight, radius);
      ctx.fill();
    });

    // Draw hover indicator
    if (isHovering) {
      ctx.fillStyle = "rgba(90, 90, 64, 0.3)";
      ctx.fillRect(hoverPosition * width, 0, 2, height);
    }

    // Draw playhead
    if (isPlaying || progress > 0) {
      ctx.fillStyle = "#5A5A40";
      ctx.fillRect(progress * width - 1, 0, 2, height);
    }
  }, [waveformData, progress, isHovering, hoverPosition, isPlaying]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const newProgress = Math.max(0, Math.min(1, x / rect.width));
    onSeek(newProgress);
  }, [onSeek]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    setHoverPosition(x / rect.width);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        ref={containerRef}
        className="relative h-16 cursor-pointer group"
        onClick={handleClick}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onMouseMove={handleMouseMove}
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full"
        />

        {/* Hover time tooltip */}
        {isHovering && duration > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute -top-8 transform -translate-x-1/2 bg-black/80 text-white text-xs px-2 py-1 rounded"
            style={{ left: `${hoverPosition * 100}%` }}
          >
            {formatTime(hoverPosition * duration)}
          </motion.div>
        )}
      </div>

      {/* Time display */}
      <div className="flex justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-black/30 mt-2">
        <span>{formatTime(progress * duration)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
