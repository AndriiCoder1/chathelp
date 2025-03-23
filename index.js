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
const { getJson: search } = require('serpapi');

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
// Добавляем настройку доверия к прокси, чтобы получать реальный IP
app.set('trust proxy', true);
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

// Добавляем глобальный кэш для ответов (ключ – нормализованный вопрос)
const globalCache = new Map();

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
    const pythonPath = process.env.PYTHON_PATH || 'python3';
    const command = `"${pythonPath}" "${path.join(__dirname, 'transcribe.py')}" "${audioPath}" "${audioPath.replace('.webm', '.mp3')}"`;

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
      }).catch(err => {
        console.error('Ошибка генерации речи:', err.message);
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
// eslint-disable-next-line no-unused-vars
function splitText(text, maxLength = 200) {
  const parts = [];
  for (let i = 0; i < text.length; i += maxLength) {
    parts.push(text.slice(i, i + maxLength));
  }
  return parts;
}

async function generateSpeech(text, outputFilePath) {
  // Проверка: если текст пустой, пропускаем генерацию речи
  if (!text || !text.trim()) {
    console.error("[generateSpeech] Пустой текст для генерации речи");
    return;
  }
  console.log(`[generateSpeech] Генерация речи для текста: ${text}`);
  try {
    const urls = getAllAudioUrls(text, {
      lang: 'ru',
      slow: false,
      host: 'https://translate.google.com',
    });

    const buffers = [];

    for (const item of urls) {
      const url = typeof item === 'string' ? item : item.url;  // извлекаем URL если элемент объект
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

async function handleTextQuery(message, socket) {
  try {
    if (!message || message.trim() === '' || message === 'undefined') {
      console.warn('[WebSocket] Пустое или некорректное сообщение');
      return socket.emit('message', '⚠️ Пустое или некорректное сообщение не может быть обработано');
    }

    // Сброс сессии, если пользователь задаёт вопрос, чтобы не включать предыдущий ответ
    let session = userSessions.get(socket.id) || [];
    if (session.length > 0 && message.toLowerCase().includes("умеешь делать")) {
      // сбрасываем контекст для нового запроса
      session = [];
      userSessions.set(socket.id, session);
    }

    // Обновлённая логика определения запросов о дате и времени:
    // Если сообщение содержит ключевые слова для времени, но не содержит указаний на поиск,
    // то обрабатываем как запрос о времени
    if (/(время|сейчас|день|число)\b/i.test(message) && !/(айфон|интернете|посмотри)/i.test(message)) {
      const now = new Date();
      const options = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone  // добавлено для локального времени
      };
      const currentTime = now.toLocaleString('ru-RU', options);
      console.log(`[Time] Отправка локального времени: ${currentTime}`);
      socket.emit('message', `Сейчас ${currentTime}`);

      // Генерация голосового ответа для времени
      const audioFilePath = path.join(audioDir, `${socket.id}_time.mp3`);
      await generateSpeech(`Сейчас ${currentTime}`, audioFilePath);
      socket.emit('audio', `/audio/${socket.id}_time.mp3?ts=${Date.now()}`);
      return;
    }

    const normalizedMessage = message.toLowerCase().trim();
    if (globalCache.has(normalizedMessage)) {
      const cachedAnswer = globalCache.get(normalizedMessage);
      console.log(`[Cache] Используем кэшированный ответ для: "${message}"`);
      socket.emit('message', cachedAnswer);
      if (message.includes('audio')) {
        const audioFilePath = path.join(audioDir, `${socket.id}.mp3`);
        try {
          await generateSpeech(cachedAnswer, audioFilePath);
          activeResponses.set(socket.id, audioFilePath);
          socket.emit('audio', `/audio/${socket.id}.mp3?ts=${Date.now()}`);
        } catch (error) {
          console.error('Ошибка генерации речи:', error.message);
          socket.emit('message', '⚠️ Произошла ошибка при генерации речи. Попробуйте еще раз.');
        }
      }
      return;
    }

    // Рабочая логика для новой сессии
    const lastMessage = session[session.length - 1];
    if (lastMessage && lastMessage.content === message) {
      console.warn('[WebSocket] Дублирующееся сообщение');
      return;
    }
    let messages;
    if (session.length === 0) {
      messages = [
        { role: 'system', content: 'Отвечай максимально подробно и информативно, не оставляй пустых ответов. Давай содержательное объяснение.' },
        { role: 'user', content: message }
      ];
    } else {
      messages = [...session, { role: 'user', content: message }];
    }

    // При необходимости временно поменяйте модель, например, на "gpt-3.5-turbo"
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",  // изменено с "o3-mini"
      messages: messages,
      max_completion_tokens: 500
    });
    console.log("[GPT] Полный ответ:", JSON.stringify(response)); // новое логирование

    let botResponse = response.choices[0].message.content.trim();
    if (!botResponse) {
      console.warn("[Bot] Пустой ответ от модели. Подставляем дефолтное сообщение.");
      botResponse = "Извините, система не смогла сформулировать ответ на ваш запрос.";
    }
    console.log(`[Bot] Ответ: ${botResponse}`);
    globalCache.set(normalizedMessage, botResponse);
    userSessions.set(socket.id, [...messages, { role: 'assistant', content: botResponse }]);
    socket.emit('message', botResponse);
    if (message.includes('audio')) {
      const audioFilePath = path.join(audioDir, `${socket.id}.mp3`);
      try {
        await generateSpeech(botResponse, audioFilePath);
        activeResponses.set(socket.id, audioFilePath);
        socket.emit('audio', `/audio/${socket.id}.mp3?ts=${Date.now()}`);
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
async function processMessageQueue(socket) {
  const queue = messageQueues.get(socket.id) || [];
  if (queue.length === 0) return;

  const message = queue.shift();
  await handleTextQuery(message, socket);

  messageQueues.set(socket.id, queue);
  if (queue.length > 0) {
    setTimeout(() => processMessageQueue(socket), 0); // убрана задержка
  }
}

// WebSocket логика
io.on('connection', (socket) => {
  console.log(`[WebSocket] Новое подключение: ${socket.id}, IP: ${socket.handshake.address}`);
  userSessions.set(socket.id, []);
  messageQueues.set(socket.id, []);
  activeResponses.set(socket.id, null);

  socket.on('message', async (message) => {
    try {
      console.log(`[WebSocket] Сообщение от ${socket.id}: ${message}`);

      // Новая логика для запроса поиска
      if (message.startsWith("SEARCH:")) {
        const query = message.replace(/^SEARCH:\s*/, "");
        const params = {
          q: query,
          google_domain: "google.com",
          gl: "us",
          hl: "ru",
          api_key: process.env.SERPAPI_KEY,
        };
        try {
          const results = await search(params);
          const topResults = results.organic_results.slice(0, 3);
          const summaries = topResults.map(result => {
            return `Название: ${result.title}\nСсылка: ${result.link}\nОписание: ${result.snippet || "Описание отсутствует"}\n`;
          }).join('\n');
          socket.emit('message', `Вот результаты поиска:\n${summaries}`);
        } catch (err) {
          console.error("Ошибка при выполнении поиска:", err);
          socket.emit('message', "Произошла ошибка при выполнении поиска.");
        }
        return;
      }

      // ...existing code для остальных сообщений...
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

function sendMessage() {
  let message = document.getElementById('message-input').value.trim();
  if (!message) {
    console.warn('Пустое сообщение не отправлено');
    return;
  }
  if (isSearchMode) {
    message = "SEARCH: " + message;
    isSearchMode = false;
    messageInput.placeholder = "Eingabe nachricht...";
  }
  // Больше не добавляем суффикс " audio" для голосового ввода
  let messageToSend = message;
  addMessageToChat(message);
  console.log('Отправка сообщения:', messageToSend);
  socket.emit('message', messageToSend);
  document.getElementById('message-input').value = '';
  isVoiceInput = false;
  if (autoSendTimer) {
    clearTimeout(autoSendTimer);
    autoSendTimer = null;
  }
}