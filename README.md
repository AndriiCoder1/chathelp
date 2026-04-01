# Personal AI Chat Assistant (ChatHelp)

A personal chat assistant with voice input and AI responses. The project is designed for daily use in language learning and task solving. Completely free, powered by Hugging Face Spaces.

## 🚀 Key Features

- 🎤 **Voice input** with automatic transcription via Whisper
- 💬 **Text chat** with AI assistant (LLaMA 3.1 8B)
- 🌐 **Internet search** through SerpAPI (weather, rates, news)
- 🔊 **Voice responses** with Google TTS
- 🧠 **Smart search** with query type detection (prices, products, events)
- 📝 **Code generation** in Python and JavaScript
- 🌍 **Multi-language support** (Russian, English, German)
- ⏰ **Local time and date** with language detection
- 💾 **Response caching** for speed
- 🌓 **Dark/light theme** interface

## 🛠️ Technology Stack

### Frontend
- **Vanilla JavaScript** (pure JS without frameworks)
- **HTML5, CSS3** - responsive interface
- **Web Speech API** - speech recognition in browser
- **MediaRecorder API** - audio recording
- **Socket.IO Client** - real-time communication

### Backend (Node.js)
- **Express.js** - web server
- **Socket.IO** - WebSocket connections
- **SerpAPI** - search queries
- **Google TTS API** - voice synthesis
- **Axios** - HTTP requests

### AI and Audio Processing
- **Hugging Face Spaces** - AI model hosting
- **LLaMA 3.1 8B** - language model (via Ollama)
- **OpenAI Whisper** - audio transcription (via Hugging Face)
- **gTTS** - speech synthesis

## 🏗️ Project Architecture

The project uses a distributed architecture:

1. **Client (browser)** - voice recording, chat display
2. **Node.js server (Render)** - request handling, search, caching
3. **Hugging Face Spaces** - LLaMA 3.1 8B AI model
4. **Hugging Face Inference API** - Whisper speech recognition

### Voice input workflow:
Browser (MediaRecorder) → Node.js → Python (Whisper) → Hugging Face API → text

### AI response workflow:
Text → Node.js → Hugging Face Space (LLaMA) → response → TTS → browser

### Internet search workflow:
Question → type detection → query optimization → SerpAPI → AI answer extraction


## 📦 Installation & Setup

### Local Development

```bash
# Clone repository
git clone https://github.com/AndriiCoder1/chathelp.git
cd chathelp

# Install Node.js dependencies
npm install

# Install Python dependencies
pip install -r requirements.txt

# Create .env file
cp .env.example .env
# Add API keys: HF_TOKEN, SERPAPI_KEY

# Start server
npm start

Deploy to Render
Connect GitHub repository

Add environment variables:

HF_TOKEN - Hugging Face token

SERPAPI_KEY - search API key

Automatic deploy on push

🔑 Required API Keys

HF_TOKEN - get from huggingface.co/settings/tokens

SERPAPI_KEY - get from serpapi.com

🧠 AI Models Used

LLaMA 3.1 8B - main language model (hosted on Hugging Face)

Whisper Large V3 - speech recognition (via Hugging Face Inference API)

📁 Project Structure

chathelp/
├── index.html          # Client interface
├── index.js            # Node.js server
├── transcribe.py       # Python script for Whisper
├── package.json        # Node.js dependencies
├── requirements.txt    # Python dependencies
├── .env.example        # Environment variables example
├── cache/              # Response cache (auto-generated)
├── audio/              # Temporary audio files
└── uploads/            # Uploaded audio files

✨ Implementation Highlights

✅ Silence detection - auto-stop recording after 3 seconds of silence

✅ Caching - repeated questions answered instantly

✅ Conversation context - AI remembers previous messages

✅ Search optimization - queries automatically improved

✅ Answer extraction - AI picks the most relevant information

✅ Multi-language TTS - voice in the correct language

🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

🙏 Acknowledgements

Hugging Face - for free AI model hosting

Meta - for LLaMA model

OpenAI - for Whisper

Render - for free hosting

SerpAPI - for search API

---

## 👨‍💻 About the Author

This project was created by **Andrii Kovalov** ([@AndriiCoder1](https://github.com/AndriiCoder1)).

- **Purpose:** Personal AI assistant for daily tasks, language learning, and quick answers
- **Tech Stack:** Node.js, Express, Socket.IO, Hugging Face (LLaMA 3.1 8B, Whisper), SerpAPI, Google TTS
- **License:** MIT

If you find this project useful, feel free to **star ⭐** the repository or fork it for your own needs!

---

## 🔗 Related Projects

Part of my portfolio of open-source projects:

| Project | Description | Tech Stack |
|---------|-------------|------------|
| [**EverRest**](https://github.com/AndriiCoder1/copy_everest) | Digital memorial platform (SaaS) | Django, PostgreSQL, Docker, Celery, Ollama AI |
| [**Video Chat with Sign Language**](https://github.com/AndriiCoder1/video-chat) | Real-time sign language translation | React, Three.js, MediaPipe, WebRTC |
| [**ChatHelp**](https://github.com/AndriiCoder1/chathelp) | Personal AI assistant with voice | Node.js, Hugging Face, Whisper |

---

## 📫 Contact & Social

- **GitHub:** [github.com/AndriiCoder1](https://github.com/AndriiCoder1)
- **Email:** [denisov20051985@gmail.com](mailto:denisov20051985@gmail.com)

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

Copyright (c) 2024 Andrii Kovalov

---

*Built with ❤️ for the open-source community*
