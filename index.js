/* =====================================================================
   Инициализация и подключение необходимых модулей.
   - dotenv: загрузка переменных окружения.
   - express, http, socket.io: настройка сервера для работы в реальном времени.
   - openai: взаимодействие с API OpenAI.
   - path, fs: работа с файловой системой.
   - multer: обработка загрузки аудиофайлов.
   - child_process.exec: выполнение внешних скриптов (транскрипция аудио через Python).
   - cors: настройка политики доступа сервера.
   - google-tts-api: генерация синтезированной речи.
   - crypto: реализация механизма кэширования запросов.
   ===================================================================== */

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
const crypto = require('crypto');

// Проверка ключей API:
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
    fileSize: 25 * 1024 * 1024,  // 25 MB Максимальный размер файла
    files: 1
  }
});

// Middleware для обработки JSON и статических файлов
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/audio', express.static(path.join(__dirname, 'audio')));
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

    // Проверка на пустой файл
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
      // Проверка на пустой ответ
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

// Функция обработки текстовых запросов
function splitText(text, maxLength = 200) {
  const parts = [];
  for (let i = 0; i < text.length; i += maxLength) {
    parts.push(text.slice(i, i + maxLength));
  }
  return parts;
}

// Функция генерации речи с использованием google-tts-api
async function generateSpeech(text, outputFilePath) {
  console.log(`[generateSpeech] Генерация речи для текста: ${text}`);
  try {
    const urls = getAllAudioUrls(text, {
      lang: 'ru', // Смена языка 
      slow: false,
      host: 'https://translate.google.com',
    });
    // Преобразование аудио в единый файл
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

// Обработка текстовых запросов с кэшированием и поиском
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
      const params = { q: query, hl: "ru", gl: "ru" }; // Настраиваемые параметры поиска

      // Определяем локацию по контексту запроса
      if (query.toLowerCase().includes("погода")) {
        console.log("[Search] Запрос о погоде – не ограничиваем поиск по локации");
      } else if (query.toLowerCase().includes("киев")) {
        params.location = "Kyiv, Ukraine";
      } else if (query.toLowerCase().includes("берн")) {
        params.location = "Bern, Switzerland";
      } else if (query.toLowerCase().includes("лондон")) {
        params.location = "London, United Kingdom";
      } else {
        params.location = "En"; // Англоязычные параметры поиска по умолчанию 
      }
      try {
        // Выполняем поиск
        const searchResults = await new Promise((resolve, reject) => {
          search.json(params, (data) => {
            if (!data) return reject(new Error("Пустой ответ от сервиса"));
            if (data.error) return reject(new Error(data.error));
            resolve(data);
          });
        });
        let resultText = "Результаты поиска не найдены.";
        let firstLink = searchResults.organic_results?.[0]?.link || null;

        // Проверяем наличие блока answer_box для погоды
        if (searchResults.answer_box?.type === "weather_result") {
          const weather = searchResults.answer_box;
          resultText = `Погода в ${weather.location} на ${weather.date}: ${weather.weather}, температура ${weather.temperature}°${weather.unit}, осадки ${weather.precipitation}, влажность ${weather.humidity}, ветер ${weather.wind}.`;
          if (firstLink) {
            resultText += ` Подробнее: <a href="${firstLink}" target="_blank">${firstLink}</a>`;
          }
        } else if (searchResults.organic_results && searchResults.organic_results.length > 0) {
          const result = searchResults.organic_results[0];
          resultText = "";
          if (result.title) {
            resultText += result.title + ". ";
          }
          if (result.snippet) {
            resultText += result.snippet;
          }
          if (firstLink) {
            resultText += ` Подробнее: <a href="${firstLink}" target="_blank">${firstLink}</a>`;
          }
        }

        console.log(`[Search] Результаты: ${resultText}`);

        // Кэшируем и отправляем результат поиска  
        fs.writeFileSync(cacheFile, JSON.stringify({ response: resultText }));
        socket.emit('message', resultText);

        // Генерируем голосовой ответ
        const audioFilePath = path.join(audioDir, `${socket.id}.mp3`);
        await generateSpeech(resultText.replace(/<[^>]+>/g, ''), audioFilePath);
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
      // Текущее время
      const now = new Date();
      const localTime = now.toLocaleString("ru-RU", { timeZone: "Europe/Berlin" });
      console.log(`[LocalTime] Отправка локального времени: ${localTime}`);
      socket.emit('message', localTime);
      // Кэшируем ответ
      fs.writeFileSync(cacheFile, JSON.stringify({ response: localTime }));
      if (message.includes('audio')) {
        const audioFilePath = path.join(audioDir, `${socket.id}.mp3`);
        await generateSpeech(localTime, audioFilePath);
        socket.emit('audio', `/audio/${socket.id}.mp3?ts=${Date.now()}`);
      }
      return;
    }

    const session = userSessions.get(socket.id) || [];
    // Проверяем на дублирование последнего сообщения
    const lastMessage = session[session.length - 1];
    if (lastMessage && lastMessage.content === message) {
      console.warn('[WebSocket] Дублирующееся сообщение');
      return;
    }
    // Обновляем сессию
    const messages = [...session, { role: 'user', content: message }];

    // Вызов OpenAI 
    console.log(`[GPT] Отправка запроса: ${message}`);
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messages,
      temperature: 0.7, // Температура для креативности ответов
      max_tokens: 500 // Количество токенов в ответе
    });
    // Ответ бота
    const botResponse = response.choices[0].message.content;
    console.log(`[Bot] Ответ: ${botResponse}`);
    // Обновляем сессию пользователя
    userSessions.set(socket.id, [...messages, { role: 'assistant', content: botResponse }]);
    // Кэшируем ответ
    fs.writeFileSync(cacheFile, JSON.stringify({ response: botResponse }));
    // Отправляем ответ пользователю
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

// Socket.IO события
io.on('connection', (socket) => {
  console.log(`[Socket] Подключен: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`[Socket] Отключен: ${socket.id}`);
    userSessions.delete(socket.id);
    messageQueues.delete(socket.id);
    activeResponses.delete(socket.id);
  });
  // Очистка данных при отключении
  socket.on('message', (message) => {
    console.log(`[Сообщение] ${socket.id}: ${message}`);

    // Добавляем сообщение в очередь
    const queue = messageQueues.get(socket.id) || [];
    queue.push(message);
    messageQueues.set(socket.id, queue);

    // Обрабатываем очередь сообщений
    if (queue.length === 1) {
      processMessageQueue(socket);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Сервер] Запуск на порту ${PORT}`);
}); 