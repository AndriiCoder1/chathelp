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

// Обновляем путь к Python и добавляем проверку зависимостей
const pythonPath = process.env.NODE_ENV === 'production'
  ? 'python3'  // для production используем системный Python
  : '/c/Users/mozart/public/venv/Scripts/python.exe'; // для разработки

// Проверяем Python и зависимости при старте
exec(`${pythonPath} -c "import openai; import pydub; import gtts"`, (error) => {
  if (error) {
    console.error('[Python] Ошибка проверки зависимостей:', error);
    console.log('[Python] Устанавливаем зависимости...');
    exec(`${pythonPath} -m pip install -r requirements.txt`, (err, stdout) => {
      if (err) {
        console.error('[Python] Ошибка установки:', err);
        process.exit(1);
      }
      console.log('[Python] Зависимости установлены:', stdout);
    });
  } else {
    console.log('[Python] Все зависимости установлены');
  }
});

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

    // Запуск Python-скрипта с подробным выводом ошибок
    const command = `${pythonPath} "${path.join(__dirname, 'transcribe.py')}" "${audioPath}" "${outputPath}" 2>&1`;

    exec(command, { encoding: 'utf-8' }, (error, stdout, stderr) => {
      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }

      if (error || stderr) {
        console.error(`[Python] Ошибка: ${stderr || error?.message}`);
        return res.status(500).json({
          error: 'Ошибка транскрипции',
          details: stderr || error?.message
        });
      }

      console.log('[Python] Успешная транскрипция:', stdout);
      res.json({ transcription: stdout.trim() });

      if (fs.existsSync(outputPath)) {
        io.emit('audio', `/audio/${req.file.filename}.mp3`);
      }
    });
  } catch (error) {
    console.error(`[Сервер] Ошибка: ${error.message}`);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Обновляем генерацию речи, добавляя обработку ошибок и повторные попытки
async function generateSpeech(text, outputFilePath, retries = 3) {
  console.log(`[generateSpeech] Генерация речи для текста: ${text}`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const urls = getAllAudioUrls(text, {
        lang: 'ru',
        slow: false,
        host: 'https://translate.google.com',
      });

      const buffers = [];
      for (const urlObj of urls) {
        const response = await fetch(urlObj.url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        buffers.push(Buffer.from(arrayBuffer));
      }

      const finalBuffer = Buffer.concat(buffers);
      await fs.promises.writeFile(outputFilePath, finalBuffer);
      console.log(`[generateSpeech] Успешно: ${outputFilePath}`);
      return;
    } catch (err) {
      console.error(`[TTS] Попытка ${attempt}/${retries} неудачна:`, err);
      if (attempt === retries) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Пауза перед следующей попыткой
    }
  }
}

// Обработка текстовых запросов
function splitText(text, maxLength = 200) {
  const parts = [];
  for (let i = 0; i < text.length; i += maxLength) {
    parts.push(text.slice(i, i + maxLength));
  }
  return parts;
}

// Кэширование для аудио и текстовых ответов
const audioCache = new Map();
const gptCache = new Map();
const ttsCache = new Map();

// Функция разделения текста на части
function splitTextForTTS(text, maxLength = 200) {
  const parts = [];
  const sentences = text.split(/([.!?]+)\s+/);
  let currentPart = '';

  for (let i = 0; i < sentences.length; i += 2) {
    const sentence = sentences[i] + (sentences[i + 1] || '');
    if ((currentPart + sentence).length <= maxLength) {
      currentPart += sentence + ' ';
    } else {
      if (currentPart) parts.push(currentPart.trim());
      currentPart = sentence + ' ';
    }
  }
  if (currentPart) parts.push(currentPart.trim());
  return parts;
}

// Улучшенная функция генерации речи с кэшированием
async function generateSpeech(text, outputFilePath) {
  const cacheKey = hashString(text);
  console.log(`[TTS] Генерация речи для текста (${text.length} символов)`);

  try {
    // Проверяем кэш
    if (ttsCache.has(cacheKey)) {
      console.log('[TTS] Использование кэша');
      const cachedBuffer = ttsCache.get(cacheKey);
      await fs.promises.writeFile(outputFilePath, cachedBuffer);
      return;
    }

    // Разделяем текст на части
    const textParts = splitTextForTTS(text);
    console.log(`[TTS] Текст разделен на ${textParts.length} частей`);

    const buffers = [];
    for (const part of textParts) {
      const urls = getAllAudioUrls(part, {
        lang: 'ru',
        slow: false,
        host: 'https://translate.google.com',
      });

      for (const urlObj of urls) {
        const response = await fetch(urlObj.url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        buffers.push(Buffer.from(arrayBuffer));
      }
    }

    const finalBuffer = Buffer.concat(buffers);

    // Сохраняем в кэш
    ttsCache.set(cacheKey, finalBuffer);

    // Записываем файл
    await fs.promises.writeFile(outputFilePath, finalBuffer);
    console.log(`[TTS] Успешно сгенерировано: ${outputFilePath}`);
  } catch (err) {
    console.error(`[TTS] Ошибка: ${err.message}`);
    throw err;
  }
}

// Улучшенная функция обработки текстовых запросов
async function handleTextQuery(message, socket, isVoiceMode) {
  try {
    const cacheKey = hashString(message);
    let response;

    // Проверяем кэш GPT
    if (gptCache.has(cacheKey)) {
      console.log('[GPT] Использование кэша');
      response = gptCache.get(cacheKey);
    } else {
      response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: message }]
      });
      gptCache.set(cacheKey, response);
    }

    const botResponse = response.choices[0].message.content;
    console.log(`[Bot] Ответ (${botResponse.length} символов)`);

    socket.emit('message', botResponse);

    if (isVoiceMode) {
      try {
        const audioFilePath = path.join(audioDir, `${socket.id}.mp3`);
        await generateSpeech(botResponse, audioFilePath);
        socket.emit('audio', `/audio/${socket.id}.mp3`);
      } catch (error) {
        console.error('[TTS] Ошибка генерации речи:', error);
        socket.emit('message', '⚠️ Ошибка генерации голосового ответа');
      }
    }
  } catch (error) {
    console.error(`[GPT] Ошибка: ${error.message}`);
    socket.emit('message', '⚠️ Ошибка обработки запроса');
  }
}

// Периодическая очистка кэша (каждые 6 часов)
setInterval(() => {
  const maxCacheSize = 1000;
  if (gptCache.size > maxCacheSize) {
    const entries = Array.from(gptCache.entries());
    entries.slice(0, entries.length - maxCacheSize).forEach(([key]) => gptCache.delete(key));
  }
  if (ttsCache.size > maxCacheSize) {
    const entries = Array.from(ttsCache.entries());
    entries.slice(0, entries.length - maxCacheSize).forEach(([key]) => ttsCache.delete(key));
  }
  console.log(`[Кэш] Очистка: GPT=${gptCache.size}, TTS=${ttsCache.size}`);
}, 6 * 60 * 60 * 1000);

// Утилита для хеширования
function hashString(str) {
  return str.split('').reduce(
    (hash, char) => (hash << 5) - hash + char.charCodeAt(0),
    0
  ).toString(16);
}

async function handleTextQuery(message, socket, isVoiceMode) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: message }]
    });

    const botResponse = response.choices[0].message.content;
    console.log(`[Bot] Ответ: ${botResponse}`);

    socket.emit('message', botResponse);

    // Генерируем голосовой ответ только в голосовом режиме
    if (isVoiceMode) {
      try {
        const audioFilePath = path.join(audioDir, `${socket.id}.mp3`);
        await generateSpeech(botResponse, audioFilePath);
        socket.emit('audio', `/audio/${socket.id}.mp3`);
      } catch (error) {
        console.error('[TTS] Ошибка:', error);
      }
    }
  } catch (error) {
    console.error(`[GPT] Ошибка: ${error.message}`);
    socket.emit('message', '⚠️ Ошибка обработки запроса');
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