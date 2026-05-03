import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn("GEMINI_API_KEY is not set. AI features will not work.");
}

export const ai = new GoogleGenAI({ apiKey: apiKey || "" });

// gemini-3.1-flash-tts-preview is the specialized model for high-quality TTS
export const TTS_MODEL = "gemini-3.1-flash-tts-preview";

export type VoiceName = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export const VOICES: { name: VoiceName; label: string; description: string }[] = [
  { name: 'Kore', label: 'Kore', description: 'Jasny i wyraźny głos' },
  { name: 'Zephyr', label: 'Zephyr', description: 'Spokojny i głęboki głos' },
  { name: 'Puck', label: 'Puck', description: 'Energiczny i radosny głos' },
  { name: 'Charon', label: 'Charon', description: 'Poważny i autorytatywny głos' },
  { name: 'Fenrir', label: 'Fenrir', description: 'Mocny i zdecydowany głos' },
];
