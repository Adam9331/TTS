import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Basic Auth - tylko jeśli ustawiono hasło
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
if (AUTH_PASSWORD) {
  app.use((req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="TTS Reader"');
      return res.status(401).send('Wymagane logowanie');
    }

    const credentials = Buffer.from(auth.split(' ')[1], 'base64').toString();
    const [user, pass] = credentials.split(':');

    if (pass === AUTH_PASSWORD) {
      next();
    } else {
      res.setHeader('WWW-Authenticate', 'Basic realm="TTS Reader"');
      return res.status(401).send('Nieprawidłowe hasło');
    }
  });
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// API endpoint
app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice = 'Kore' } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-tts-preview',
      contents: [{ parts: [{ text }] }],
      config: {
        systemInstruction: "Jesteś profesjonalnym polskim lektorem. Twoim jedynym zadaniem jest przeczytanie podanego tekstu DOKŁADNIE tak, jak jest napisany. Nie streszczaj, nie komentuj, nie zmieniaj treści. Czytaj słowo w słowo od początku do końca.",
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    });

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (!audioData) {
      return res.status(500).json({ error: 'No audio data received' });
    }

    res.json({ audio: audioData });
  } catch (error) {
    console.error('TTS Error:', error);
    res.status(500).json({ error: error.message || 'TTS generation failed' });
  }
});

// Serve static files in production
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// SPA fallback - serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
