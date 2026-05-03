/**
 * Utility to play raw PCM audio data from Gemini TTS
 */

export async function playPCMAudio(
  base64Data: string, 
  sampleRate: number = 24000, 
  onProgress?: (progress: number) => void
) {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  
  // Convert base64 to binary
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  // PCM 16-bit is 2 bytes per sample
  const numSamples = len / 2;
  const floatData = new Float32Array(numSamples);
  const dataView = new DataView(bytes.buffer);
  
  for (let i = 0; i < numSamples; i++) {
    // Read 16-bit signed integer (Little Endian)
    const sample = dataView.getInt16(i * 2, true);
    // Normalize to [-1, 1]
    floatData[i] = sample / 32768;
  }
  
  const audioBuffer = audioContext.createBuffer(1, numSamples, sampleRate);
  audioBuffer.getChannelData(0).set(floatData);
  
  const duration = audioBuffer.duration;
  
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);
  
  source.start();
  const startTime = audioContext.currentTime;

  let animationFrame: number;
  const updateProgress = () => {
    const elapsed = audioContext.currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    if (onProgress) onProgress(progress);
    if (progress < 1) {
      animationFrame = requestAnimationFrame(updateProgress);
    }
  };
  animationFrame = requestAnimationFrame(updateProgress);
  
  return new Promise<void>((resolve) => {
    source.onended = () => {
      cancelAnimationFrame(animationFrame);
      audioContext.close();
      resolve();
    };
  });
}
