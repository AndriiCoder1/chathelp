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
    fileSize: 25 * 1024 * 1024, // 25 MB
    files: 1
  }
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'images'))); // Раздача статических файлов из папки images
app.use('/audio', express.static(path.join(__dirname, 'audio'))); // Раздача аудиофайлов
app.use(express.json({ limit: '25mb' }));

// Проверка и создание директории для аудиофайлов
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
const messageQueues = new Map();
const activeResponses = new Map();

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
      fs.unlinkSync(audioPath);
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
      // Генерация голосового ответа
      const audioFilePath = path.join(audioDir, `${req.file.filename}.mp3`);
      generateSpeech(stdout.trim(), audioFilePath).then(() => {
        io.emit('audio', `/audio/${req.file.filename}.mp3`);
      });
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
async function generateSpeech(text, outputFilePath) {
  const response = await openai.audio.create({
    input: text,
    voice: 'ru-RU-Wavenet-D',
    audioConfig: { audioEncoding: 'MP3' }
  });

  fs.writeFileSync(outputFilePath, response.audioContent, 'binary');
  console.log(`Audio content written to file: ${outputFilePath}`);
}

async function handleTextQuery(message, socket) {
  try {
    if (!message || message.trim() === '' || message === 'undefined') {
      console.warn('[WebSocket] Пустое или некорректное сообщение');
      return socket.emit('message', '⚠️ Пустое или некорректное сообщение не может быть обработано');
    }

    const session = userSessions.get(socket.id) || [];
    const lastMessage = session[session.length - 1];
    if (lastMessage && lastMessage.content === message) {
      console.warn('[WebSocket] Дублирующееся сообщение');
      return;
    }

    const messages = [...session, { role: 'user', content: message }];

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messages,
      temperature: 0.7,
      max_tokens: 500
    });

    const botResponse = response.choices[0].message.content;
    console.log(`[Bot] Ответ: ${botResponse}`); // Логирование ответа бота
    userSessions.set(socket.id, [...messages, { role: 'assistant', content: botResponse }]);
    
    socket.emit('message', botResponse);

    // Генерация голосового ответа
    const audioFilePath = path.join(audioDir, `${socket.id}.mp3`);
    await generateSpeech(botResponse, audioFilePath);
    activeResponses.set(socket.id, audioFilePath);
    socket.emit('audio', `/audio/${socket.id}.mp3`);

  } catch (error) {
    console.error(`[GPT] Ошибка: ${error.message}`);
    socket.emit('message', '⚠️ Произошла ошибка при обработке запроса');
  }
}

// Обработка очереди сообщений
async function processMessageQueue(socket) {
  const queue = messageQueues.get(socket.id) || [];
  if (queue.length === 0) return;

  const message = queue.shift();
  await handleTextQuery(message, socket);

  messageQueues.set(socket.id, queue);
  if (queue.length > 0) {
    setTimeout(() => processMessageQueue(socket), 1000); // Задержка перед обработкой следующего сообщения
  }
}

// WebSocket логика
io.on('connection', (socket) => {
  console.log(`[WebSocket] Новое подключение: ${socket.id}`);
  userSessions.set(socket.id, []);
  messageQueues.set(socket.id, []);
  activeResponses.set(socket.id, null);

  socket.on('message', async (message) => {
    try {
      console.log(`[WebSocket] Сообщение от ${socket.id}: ${message}`);
      
      if (/жест|видео|распознай/i.test(message)) {
        return socket.emit('message', '🎥 Отправьте видеофайл для анализа жестов');
      }

      const queue = messageQueues.get(socket.id) || [];
      queue.push(message);
      messageQueues.set(socket.id, queue);

      if (queue.length === 1) {
        await processMessageQueue(socket);
      }
    } catch (error) {
      console.error(`[WebSocket] Ошибка: ${error.message}`);
      socket.emit('message', '⚠️ Ошибка обработки сообщения');
    }
  });

  socket.on('audio-ended', () => {
    console.log(`[WebSocket] Аудио завершено для: ${socket.id}`);
    activeResponses.set(socket.id, null);
    const queue = messageQueues.get(socket.id) || [];
    if (queue.length > 0) {
      processMessageQueue(socket);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[WebSocket] Отключение: ${socket.id}`);
    userSessions.delete(socket.id);
    messageQueues.delete(socket.id);
    activeResponses.delete(socket.id);
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Сервер] Запущен на порту ${PORT}`);
  console.log('[Сервер] Режим:', process.env.NODE_ENV || 'development');
});