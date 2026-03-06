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
//const { OpenAI } = require('openai');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { exec } = require('child_process');
const cors = require('cors');
const googleTTS = require('google-tts-api');
const { getAllAudioUrls } = require('google-tts-api');
const crypto = require('crypto');

// Проверка ключей API:
//console.log("[Сервер] OpenAI API Key:", process.env.OPENAI_API_KEY ? "OK" : "Отсутствует");
console.log("[Сервер] SerpAPI Key:", process.env.SERPAPI_KEY ? "OK" : "Отсутствует");

// Инициализация OpenAI
//const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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


          // Сохраняем ссылку отдельно для текстового ответа
          const linkText = firstLink ? ` Подробнее: ${firstLink}` : '';

          // Для отображения в чате оставляем HTML
          const displayText = resultText + (firstLink ? ` Подробнее: <a href="${firstLink}" target="_blank">${firstLink}</a>` : '');

          // Для озвучки убираем HTML и ссылку
          const speechText = resultText; // Без ссылки и HTML

          console.log(`[Search] Результаты: ${displayText}`);

          // Кэшируем и отправляем результат поиска  
          fs.writeFileSync(cacheFile, JSON.stringify({ response: displayText }));
          socket.emit('message', displayText);

          // Генерируем голосовой ответ без ссылки и HTML
          const audioFilePath = path.join(audioDir, `${socket.id}.mp3`);
          await generateSpeech(speechText, audioFilePath);
          socket.emit('audio', `/audio/${socket.id}.mp3?ts=${Date.now()}`);

        } else if (searchResults.organic_results && searchResults.organic_results.length > 0) {
          const result = searchResults.organic_results[0];
          resultText = "";
          if (result.title) {
            resultText += result.title + ". ";
          }
          if (result.snippet) {
            resultText += result.snippet;
          }

          // Для отображения в чате
          const displayText = resultText + (firstLink ? ` Подробнее: <a href="${firstLink}" target="_blank">${firstLink}</a>` : '');

          // Для озвучки (без ссылки)
          const speechText = resultText;

          console.log(`[Search] Результаты: ${displayText}`);

          // Кэшируем и отправляем
          fs.writeFileSync(cacheFile, JSON.stringify({ response: displayText }));
          socket.emit('message', displayText);

          // Генерируем голосовой ответ
          const audioFilePath = path.join(audioDir, `${socket.id}.mp3`);
          await generateSpeech(speechText, audioFilePath);
          socket.emit('audio', `/audio/${socket.id}.mp3?ts=${Date.now()}`);
        } else {
          socket.emit('message', "Ничего не найдено по вашему запросу.");
        }

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

    // Проверка на дублирующиеся сообщения
    const session = userSessions.get(socket.id) || [];
    const lastMessage = session[session.length - 1];
    if (lastMessage && lastMessage.content === message) {
      console.warn('[WebSocket] Дублирующееся сообщение');
      return;
    }

    console.log(`[HF] Отправка запроса в Hugging Face Space: ${message}`);

    try {
      // Вызов Space на Hugging Face
      const spaceResponse = await axios.post('https://Andrii1-my-chat-model.hf.space/chat', {
        text: `Ответь кратко и по существу. Вопрос: ${message}`,
        type: 'text'
      }, {
        timeout: 120000 // 120 секунд таймаут
      });

      const botResponse = spaceResponse.data.response;
      console.log(`[Bot] Ответ от Hugging Face: ${botResponse}`);

      // Обновляем сессию пользователя (для контекста)
      userSessions.set(socket.id, [...session, { role: 'user', content: message }, { role: 'assistant', content: botResponse }]);

      // Кэшируем ответ
      fs.writeFileSync(cacheFile, JSON.stringify({ response: botResponse }));

      // Отправляем ответ пользователю
      socket.emit('message', botResponse);

      // Если запрос был голосовым, генерируем речь
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
      console.error(`[HF] Ошибка: ${error.message}`);

      // Обработка различных ошибок
      if (error.code === 'ECONNABORTED') {
        socket.emit('message', '⚠️ Сервис AI отвечает слишком долго. Попробуйте еще раз.');
      } else if (error.code === 'ECONNREFUSED') {
        socket.emit('message', '⚠️ Сервис AI временно недоступен. Попробуйте позже.');
      } else {
        socket.emit('message', '⚠️ Произошла ошибка при обработке запроса');
      }
    }

  } catch (error) {
    console.error(`[Критическая ошибка] ${error.message}`);
    socket.emit('message', '⚠️ Произошла критическая ошибка при обработке запроса');
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