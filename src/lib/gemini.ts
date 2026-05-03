export type VoiceName = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export const VOICES: { name: VoiceName; label: string; description: string }[] = [
  { name: 'Kore', label: 'Kore', description: 'Jasny i wyraźny głos' },
  { name: 'Zephyr', label: 'Zephyr', description: 'Spokojny i głęboki głos' },
  { name: 'Puck', label: 'Puck', description: 'Energiczny i radosny głos' },
  { name: 'Charon', label: 'Charon', description: 'Poważny i autorytatywny głos' },
  { name: 'Fenrir', label: 'Fenrir', description: 'Mocny i zdecydowany głos' },
];

const API_URL = 'http://localhost:3001';

export async function generateTTS(text: string, voice: VoiceName): Promise<string | null> {
  try {
    const response = await fetch(`${API_URL}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'TTS request failed');
    }

    const data = await response.json();
    return data.audio || null;
  } catch (error) {
    console.error('TTS API Error:', error);
    throw error;
  }
}
