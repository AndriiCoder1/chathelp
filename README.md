# Personal AI Chat Assistant (ChatHelp)
A personal chat assistant with voice input and AI responses. The project is designed for daily use in language learning and task solving.

## 🚀 Key Features

- **Voice input** with automatic audio-to-text transcription
- **Text chat** with AI assistant (OpenAI GPT-3.5)
- **Internet search** through search API integration
- **Voice responses** with text-to-speech synthesis
- **Dark/light theme** interface

## 🛠️ Technology Stack

### Frontend
- **Vanilla JavaScript** (pure JS without frameworks)
- **HTML5, CSS3** - responsive interface
- **Web Speech API** - speech recognition in browser
- **Socket.IO Client** - real-time communication

### Backend (Node.js)
- **Express.js** - web server
- **Socket.IO** - WebSocket connections
- **OpenAI API** - AI assistant (GPT-3.5-turbo)
- **Google TTS API** - voice response synthesis
- **SerpAPI** - search queries

### Audio Processing (Python)
- **OpenAI Whisper** - audio-to-text transcription
- **pydub** - audio format conversion

## 🏗️ Project Architecture

The project uses a hybrid approach to speech recognition:

### Client-side (browser)
- **Web Speech API** - fast real-time voice capture
- **MediaRecorder API** - audio recording for subsequent processing

### Server-side processing (Python)
- **OpenAI Whisper** - high-precision audio file transcription
- **pydub** - audio format conversion for compatibility

This architecture provides a balance between speed and recognition accuracy.
