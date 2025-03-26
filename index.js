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
const crypto = require('crypto'); // добавлено для кеширования

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

// Создаём директорию для кэша
const cacheFolder = path.join(__dirname, 'cache');
if (!fs.existsSync(cacheFolder)) {
  fs.mkdirSync(cacheFolder);
  console.log(`[Сервер] Директория кэша создана: ${cacheFolder}`);
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
    // Используем полный текст без ограничения (удалена логика обрезания до 200 символов)
    const urls = getAllAudioUrls(text, {
      lang: 'ru',
      slow: false,
      host: 'https://translate.google.com',
    });
    const buffers = [];
    for (const item of urls) {
      const url = typeof item === 'string' ? item : item.url;
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      buffers.push(Buffer.from(arrayBuffer));
    }
    const finalBuffer = Buffer.concat(buffers);
    fs.writeFileSync(outputFilePath, finalBuffer);
    console.log(`[generateSpeech] Успешно: ${outputFilePath}`);
  } catch (err) {
    console.error(`[Google TTS] Ошибка: ${err}`);
    throw new Error('Ошибка генерации речи');
  }
}

// Изменения в функции handleTextQuery: меняем модель на gpt-4o-mini
async function handleTextQuery(message, socket) {
  try {
    if (!message || message.trim() === '' || message === 'undefined') {
      console.warn('[WebSocket] Пустое или некорректное сообщение');
      return socket.emit('message', '⚠️ Пустое или некорректное сообщение не может быть обработано');
    }
    message = message.trim();

    // Добавляем проверку кэша
    const hash = crypto.createHash('md5').update(message).digest('hex');
    const cacheFile = path.join(cacheFolder, `${hash}.json`);
    if (fs.existsSync(cacheFile)) {
      const cachedData = fs.readFileSync(cacheFile, 'utf-8');
      const cachedResponse = JSON.parse(cachedData);
      console.log(`[Cache] Использование кэша для сообщения: ${message}`);
      socket.emit('message', cachedResponse.response);
      if (message.includes('audio')) {
        const audioFilePath = path.join(audioDir, `${socket.id}.mp3`);
        await generateSpeech(cachedResponse.response, audioFilePath);
        socket.emit('audio', `/audio/${socket.id}.mp3?ts=${Date.now()}`);
      }
      return;
    }

    // Новая логика: если запрос начинается с "SEARCH:"
    if (message.toLowerCase().startsWith("search:")) {
      const query = message.slice(7).trim();
      const GoogleSearch = require("google-search-results-nodejs").GoogleSearch;
      const search = new GoogleSearch(process.env.SERPAPI_KEY);
      const params = { q: query, hl: "ru", gl: "ru" };
      // Задаем локацию в зависимости от текста запроса
      if (query.toLowerCase().includes("погода")) {
        console.log("[Search] Запрос о погоде – не ограничиваем поиск по локации");
      } else if (query.toLowerCase().includes("киев")) {
        params.location = "Kyiv, Ukraine";
      } else if (query.toLowerCase().includes("берн")) {
        params.location = "Bern, Switzerland";
      } else if (query.toLowerCase().includes("лондон")) {
        params.location = "London, United Kingdom";
      } else {
        params.location = "En"; // По умолчанию - англоязычные результаты
      }
      try {
        const searchResults = await new Promise((resolve, reject) => {
          search.json(params, (data) => {
            if (!data) return reject(new Error("Пустой ответ от сервиса"));
            if (data.error) return reject(new Error(data.error));
            resolve(data);
          });
        });
        let resultText = "Результаты поиска не найдены.";
        if (searchResults.organic_results && searchResults.organic_results.length > 0) {
          const result = searchResults.organic_results[0];
          resultText = "";
          if (result.title) {
            resultText += result.title + ". ";
          }
          if (result.snippet) {
            resultText += result.snippet;
          }
          resultText = resultText.trim();
        }
        // Новая функция для извлечения релевантной информации
        function extractRelevantInfo(text, query) {
          if (query.toLowerCase().includes("погода")) {
            const tempMatch = text.match(/\d+[.,]?\d*\s*(°|градус(?:ов)?)/i);
            if (tempMatch) {
              return `Погода: ${tempMatch[0]}`;
            }
            return text; // если число не найдено, вернуть полный результат
          }
          // Для других запросов возвращаем полный текст
          return text;
        }
        resultText = extractRelevantInfo(resultText, query);
        console.log(`[Search] Результаты: ${resultText}`);
        socket.emit('message', resultText);
        // Генерируем голосовой ответ всегда
        const audioFilePath = path.join(audioDir, `${socket.id}.mp3`);
        await generateSpeech(resultText, audioFilePath);
        socket.emit('audio', `/audio/${socket.id}.mp3?ts=${Date.now()}`);
      } catch (err) {
        console.error("Ошибка поискового запроса:", err);
        socket.emit('message', "Ошибка при поиске в интернете.");
      }
      return;
    }

    // Новая логика: если запрос о дне или времени – используем системное время
    if (
      message.toLowerCase().includes("какой сегодня день") ||
      message.toLowerCase().includes("сколько сейчас время")
    ) {
      const now = new Date();
      const localTime = now.toLocaleString("ru-RU", { timeZone: "Europe/Berlin" }); // явная таймзона
      console.log(`[LocalTime] Отправка локального времени: ${localTime}`);
      socket.emit('message', localTime);
      if (message.includes('audio')) {
        const audioFilePath = path.join(audioDir, `${socket.id}.mp3`);
        await generateSpeech(localTime, audioFilePath);
        socket.emit('audio', `/audio/${socket.id}.mp3?ts=${Date.now()}`);
      }
      return;
    }

    // ...existing код сессии и вызова OpenAI...
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
    console.log(`[Bot] Ответ: ${botResponse}`);
    userSessions.set(socket.id, [...messages, { role: 'assistant', content: botResponse }]);

    // Кэшируем ответ
    fs.writeFileSync(cacheFile, JSON.stringify({ response: botResponse }));

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
    setTimeout(() => processMessageQueue(socket), 0);
  }
}

// WebSocket логика
io.on('connection', (socket) => {
  // Получаем реальный IP из заголовка X-Forwarded-For, если он передан
  const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  console.log(`[WebSocket] Новое подключение: ${socket.id}, IP: ${clientIp}`);
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

function sendMessage() {
  let message = document.getElementById('message-input').value.trim();
  if (!message) {
    console.warn('Пустое сообщение не отправлено');
    return;
  }
  let displayMessage = message;
  // Если сообщение отправлено голосом, добавляем метку для сервера,
  // но для отображения убираем суффикс " audio"
  if (isVoiceInput && !message.includes(' audio')) {
    message += ' audio';
    displayMessage = message.replace(/ audio$/, '');
  }
  addMessageToChat(displayMessage);
  console.log('Отправка сообщения:', message);
  socket.emit('message', message);
  document.getElementById('message-input').value = '';
  isVoiceInput = false;
  if (autoSendTimer) {
    clearTimeout(autoSendTimer);
    autoSendTimer = null;
  }
}