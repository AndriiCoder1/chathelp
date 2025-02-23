require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { OpenAI } = require('openai');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { exec } = require('child_process');
const cors = require('cors');
const gTTS = require('gtts');

// Логирование загрузки ключей
console.log("[Сервер] OpenAI API Key:", process.env.OPENAI_API_KEY ? "OK" : "Отсутствует");
console.log("[Сервер] SerpAPI Key:", process.env.SERPAPI_KEY ? "OK" : "Отсутствует");

// Инициализация OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Проверка ключей
if (!process.env.SERPAPI_KEY) {
  console.error("[Сервер] SerpAPI Key отсутствует!");
  process.exit(1);
}

// Настройка Express
const app = express();
const server = http.createServer(app);

// Настройка CORS
app.use(cors({
  origin: 'https://chathelp-y22r.onrender.com',
  methods: ['GET', 'POST']
}));

// Настройка Socket.IO
const io = new Server(server, {
  cors: {
    origin: 'https://chathelp-y22r.onrender.com',
    methods: ['GET', 'POST']
  }
});

// Улучшенная конфигурация Multer
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (/^audio\/(wav|x-wav|webm)$/.test(file.mimetype)) {
      console.log(`[Аудио] Принят формат: ${file.mimetype}`);
      cb(null, true);
    } else {
      console.warn(`[Аудио] Неподдерживаемый формат: ${file.mimetype}`);
      cb(new Error('Поддерживаются только WAV/WEBM файлы'), false);
    }
  },
  limits: {
    fileSize: 25 * 1024 * 1024, // Максимальный размер 25 MB
    files: 1
  }
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '25mb' }));

// Функция статической раздачи файлов
app.use('/audio', express.static(path.join(__dirname, 'audio')));
app.use('/images', express.static(path.join(__dirname, 'images'))); 

// Проверка и создание директории audio
const audioDir = path.join(__dirname, 'audio');
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir);
  console.log(`[Сервер] Директория создана: ${audioDir}`);
}

// Маршруты
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Хранение сессий
const userSessions = new Map();
const activeSessions = new Set();
const audioQueue = new Map();

// Обработка аудио
app.post('/process-audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      console.warn('[Аудио] Файл не получен');
      return res.status(400).json({ error: 'Аудиофайл не загружен' });
    }

    const audioPath = req.file.path;
    console.log(`[Аудио] Обработка файла: ${audioPath} (${req.file.size} байт)`);

    if (req.file.size === 0) {
      console.error('[Аудио] Файл пустой');
      return res.status(400).json({ error: 'Аудиофайл пустой' });
    }

    // Запуск транскрипции
    const command = `python3 "${path.join(__dirname, 'transcribe.py')}" "${audioPath}"`;
    
    exec(command, { encoding: 'utf-8' }, (error, stdout, stderr) => {
      // Очистка временных файлов
      fs.unlinkSync(audioPath);

      if (error) {
        console.error(`[Python] Ошибка: ${stderr}`);
        return res.status(500).json({ 
          error: 'Ошибка транскрипции',
          details: stderr
        });
      }

      if (!stdout?.trim()) {
        console.warn('[Python] Пустой ответ');
        return res.status(500).json({ error: 'Не удалось распознать речь' });
      }

      console.log('[Python] Успешная транскрипция');
      res.json({ transcription: stdout.trim() });
    });

  } catch (error) {
    console.error(`[Сервер] Критическая ошибка: ${error.message}`);
    res.status(500).json({ 
      error: 'Внутренняя ошибка сервера',
      details: error.message
    });
  }
});

// Обработка текстовых запросов
async function handleTextQuery(message, socket) {
  try {
    const session = userSessions.get(socket.id) || [];
    const messages = [...session, { role: 'user', content: message }];

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Используем модель gpt-3.5-turbo
      messages: messages,
      temperature: 0.7,
      max_tokens: 500
    });

    const botResponse = response.choices[0].message.content;
    userSessions.set(socket.id, [...messages, { role: 'assistant', content: botResponse }]);
    
    socket.emit('message', botResponse);

    // Генерация голосового ответа
    const audioPath = path.join(audioDir, `${socket.id}_response.mp3`);
    const gtts = new gTTS(botResponse, 'ru');
    gtts.save(audioPath, function (err, result) {
      if (err) {
        console.error(`[gTTS] Ошибка: ${err.message}`);
        socket.emit('message', '⚠️ Произошла ошибка при генерации голосового ответа');
      } else {
        console.log(`[gTTS] Аудиофайл сохранен: ${audioPath}`);
        if (!audioQueue.has(socket.id)) {
          audioQueue.set(socket.id, []);
        }
        audioQueue.get(socket.id).push(audioPath);
        playNextAudio(socket);
      }
    });
  } catch (error) {
    console.error(`[GPT] Ошибка: ${error.message}`);
    socket.emit('message', '⚠️ Произошла ошибка при обработке запроса');
  }
}

// Воспроизведение следующего аудио в очереди
function playNextAudio(socket) {
  const queue = audioQueue.get(socket.id);
  if (queue && queue.length > 0) {
    const audioPath = queue.shift();
    console.log(`[Audio] Воспроизведение аудио: ${audioPath}`);
    socket.emit('audio', `/audio/${path.basename(audioPath)}`);
    fs.unlink(audioPath, (err) => {
      if (err) console.error(`[Очистка] Ошибка удаления файла: ${err.message}`);
    });
  }
}

// WebSocket логика
io.on('connection', (socket) => {
  console.log(`[WebSocket] Новое подключение: ${socket.id}`);
  userSessions.set(socket.id, []);
  activeSessions.add(socket.id);

  socket.on('message', async (message) => {
    try {
      console.log(`[WebSocket] Сообщение от ${socket.id}: ${message}`);
      
      if (/жест|видео|распознай/i.test(message)) {
        return socket.emit('message', '🎥 Отправьте видеофайл для анализа жестов');
      }

      await handleTextQuery(message, socket);
    } catch (error) {
      console.error(`[WebSocket] Ошибка: ${error.message}`);
      socket.emit('message', '⚠️ Ошибка обработки сообщения');
    }
  });

  socket.on('disconnect', () => {
    console.log(`[WebSocket] Отключение: ${socket.id}`);
    userSessions.delete(socket.id);
    activeSessions.delete(socket.id);
    audioQueue.delete(socket.id);
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Сервер] Запущен на порту ${PORT}`);
  console.log('[Сервер] Режим:', process.env.NODE_ENV || 'development');
});