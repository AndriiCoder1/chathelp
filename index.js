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
const googleTTS = require('google-tts-api');
const { getAllAudioUrls } = require('google-tts-api');

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

// Обновляем путь к Python в зависимости от окружения
const pythonPath = process.env.NODE_ENV === 'production'
  ? 'python3'  // для production используем системный Python
  : '/c/Users/mozart/public/venv/Scripts/python.exe'; // для разработки

// Обновляем обработчик аудио
app.post('/process-audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      console.warn('[Аудио] Файл не получен');
      return res.status(400).json({ error: 'Аудиофайл не загружен' });
    }

    const audioPath = req.file.path;
    const outputPath = path.join(audioDir, `${req.file.filename}.mp3`);

    console.log(`[Аудио] Обработка файла: ${audioPath} (${req.file.size} байт)`);
    console.log(`[Аудио] Выходной файл: ${outputPath}`);

    if (req.file.size === 0) {
      console.error('[Аудио] Файл пустой');
      fs.unlinkSync(audioPath);
      return res.status(400).json({ error: 'Аудиофайл пустой' });
    }

    // Проверяем права доступа
    try {
      await fs.promises.access(audioPath, fs.constants.R_OK);
      await fs.promises.access(path.dirname(outputPath), fs.constants.W_OK);
    } catch (err) {
      console.error('[Аудио] Ошибка прав доступа:', err);
      return res.status(500).json({ error: 'Ошибка прав доступа к файлам' });
    }

    // Обновленная команда с выводом ошибок
    const command = `${pythonPath} "${path.join(__dirname, 'transcribe.py')}" "${audioPath}" "${outputPath}" 2>&1`;

    exec(command, { encoding: 'utf-8' }, async (error, stdout, stderr) => {
      try {
        // Очистка временных файлов
        if (fs.existsSync(audioPath)) {
          fs.unlinkSync(audioPath);
        }

        if (error || stderr) {
          console.error(`[Python] Ошибка выполнения: ${error?.message || stderr}`);
          return res.status(500).json({
            error: 'Ошибка транскрипции',
            details: stderr || error?.message
          });
        }

        const output = stdout.trim();
        console.log('[Python] Вывод:', output);

        if (!output) {
          console.warn('[Python] Пустой ответ');
          return res.status(500).json({ error: 'Не удалось распознать речь' });
        }

        console.log('[Python] Успешная транскрипция');
        res.json({ transcription: output });

        // Проверяем существование файла перед отправкой
        if (fs.existsSync(outputPath)) {
          io.emit('audio', `/audio/${req.file.filename}.mp3`);
        } else {
          console.error('[Аудио] Файл не создан:', outputPath);
        }
      } catch (err) {
        console.error('[Process] Ошибка обработки:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
      }
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
function splitText(text, maxLength = 200) {
  const parts = [];
  for (let i = 0; i < text.length; i += maxLength) {
    parts.push(text.slice(i, i + maxLength));
  }
  return parts;
}

async function generateSpeech(text, outputFilePath) {
  console.log(`[generateSpeech] Генерация речи для текста: ${text}`);
  try {
    const urls = getAllAudioUrls(text, {
      lang: 'ru',
      slow: false,
      host: 'https://translate.google.com',
    });

    const buffers = [];

    for (const urlObj of urls) {
      const url = urlObj.url; // Извлечение URL из объекта
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      buffers.push(Buffer.from(arrayBuffer));
    }

    // Объединение всех частей в один аудиофайл
    const finalBuffer = Buffer.concat(buffers);
    fs.writeFileSync(outputFilePath, finalBuffer);
    console.log(`[generateSpeech] Успешно: ${outputFilePath}`);
  } catch (err) {
    console.error(`[Google TTS] Ошибка: ${err}`);
    throw new Error('Ошибка генерации речи');
  }
}

// Добавили кэширование GPT-ответов
const gptCache = new Map();

async function getCachedGPTResponse(prompt) {
  const cacheKey = hashString(prompt);

  if (gptCache.has(cacheKey)) {
    console.log(`[GPT Кэш] Использование кэша для: ${cacheKey}`);
    return gptCache.get(cacheKey);
  }

  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [{ role: "user", content: prompt }]
  });

  gptCache.set(cacheKey, response);
  return response;
}

// Утилита для хеширования
function hashString(str) {
  return str.split('').reduce(
    (hash, char) => (hash << 5) - hash + char.charCodeAt(0),
    0
  ).toString(16);
}

async function handleTextQuery(message, socket, isVoiceMode) {
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

    const response = await getCachedGPTResponse(message);

    const botResponse = response.choices[0].message.content;
    console.log(`[Bot] Ответ: ${botResponse}`); // Логирование ответа бота
    userSessions.set(socket.id, [...messages, { role: 'assistant', content: botResponse }]);

    socket.emit('message', botResponse);

    // Генерируем голосовой ответ только если включен голосовой режим
    if (isVoiceMode) {
      const audioFilePath = path.join(audioDir, `${socket.id}.mp3`);
      try {
        await generateSpeech(botResponse, audioFilePath);
        activeResponses.set(socket.id, audioFilePath);
        socket.emit('audio', `/audio/${socket.id}.mp3`);
      } catch (error) {
        console.error('Ошибка генерации речи:', error.message);
        socket.emit('message', '⚠️ Произошла ошибка при генерации речи. Попробуйте еще раз.');
      }
    }

  } catch (error) {
    console.error(`[GPT] Ошибка: ${error.message}`);
    socket.emit('message', '⚠️ Произошла ошибка при обработке запроса');
  }
}

// Обработка очереди сообщений
async function processMessageQueue(socket, isVoiceMode) {
  const queue = messageQueues.get(socket.id) || [];
  if (queue.length === 0) return;

  const message = queue.shift();

  try {
    const response = await getCachedGPTResponse(message);
    const botResponse = response.choices[0].message.content;

    socket.emit('message', botResponse);

    // Генерируем голосовой ответ только в голосовом режиме
    if (isVoiceMode) {
      const audioFilePath = path.join(audioDir, `${socket.id}.mp3`);
      try {
        await generateSpeech(botResponse, audioFilePath);
        activeResponses.set(socket.id, audioFilePath);
        socket.emit('audio', `/audio/${socket.id}.mp3`);
      } catch (error) {
        console.error('Ошибка генерации речи:', error.message);
        socket.emit('message', '⚠️ Произошла ошибка при генерации речи.');
      }
    }
  } catch (error) {
    console.error(`[GPT] Ошибка: ${error.message}`);
    socket.emit('message', '⚠️ Произошла ошибка при обработке запроса');
  }

  messageQueues.set(socket.id, queue);
  if (queue.length > 0) {
    setTimeout(() => processMessageQueue(socket, isVoiceMode), 1000);
  }
}

// WebSocket логика
io.on('connection', (socket) => {
  console.log(`[WebSocket] Новое подключение: ${socket.id}`);
  userSessions.set(socket.id, []);
  messageQueues.set(socket.id, []);
  activeResponses.set(socket.id, null);

  // Добавляем отслеживание режима для каждого соединения
  let isVoiceMode = false;

  socket.on('mode', (data) => {
    isVoiceMode = data.isVoiceMode;
    console.log(`[WebSocket] Режим ${socket.id}: ${isVoiceMode ? 'голосовой' : 'текстовый'}`);
  });

  socket.on('message', async (message) => {
    try {
      console.log(`[WebSocket] Сообщение от ${socket.id}: ${message}`);

      if (/жест|видео|распознай/i.test(message)) {
        return socket.emit('message', '🎥 Отправьте видеофайл для анализа жестов');
      }

      const queue = messageQueues.get(socket.id) || [];
      queue.push(message);
      messageQueues.set(socket.id, queue);

      // Передаем информацию о режиме в обработчик очереди
      if (queue.length === 1) {
        await processMessageQueue(socket, isVoiceMode);
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
      processMessageQueue(socket, isVoiceMode);
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