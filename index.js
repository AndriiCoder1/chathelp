/* =====================================================================
   Инициализация и подключение необходимых модулей.
   - dotenv: загрузка переменных окружения.
   - express, http, socket.io: настройка сервера для работы в реальном времени.
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
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { exec } = require('child_process');
const cors = require('cors');
const googleTTS = require('google-tts-api');
const { getAllAudioUrls } = require('google-tts-api');
const crypto = require('crypto');

// Проверка ключей 
console.log("[Сервер] SerpAPI Key:", process.env.SERPAPI_KEY ? "OK" : "Отсутствует");
console.log("[Сервер] HF_TOKEN:", process.env.HF_TOKEN ? "OK" : "Отсутствует");

// Проверка ключей
if (!process.env.SERPAPI_KEY) {
  console.error("[Сервер] SerpAPI Key отсутствует!");
  process.exit(1);
}

if (!process.env.HF_TOKEN) {
  console.error("[Сервер] HF_TOKEN отсутствует!");
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

// Конфигурация Multer
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
    fileSize: 25 * 1024 * 1024,
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
    const pythonPath = process.env.PYTHON_PATH || 'python';
    const command = `"${pythonPath}" "${path.join(__dirname, 'transcribe.py')}" "${audioPath}" "none" "ru"`;

    exec(command, { encoding: 'utf-8' }, (error, stdout, stderr) => {

      if (stderr) {
        console.log(`[Python stderr]: ${stderr}`);
      }

      // Очистка временного файла загруженного аудио
      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }

      if (error) {
        console.error(`[Python] Ошибка: ${stderr}`);
        return res.status(500).json({
          error: 'Ошибка транскрипции',
          details: stderr
        });
      }

      // Получаем последнюю строку вывода (это и есть транскрипция)
      const lines = stdout.trim().split('\n');
      const transcription = lines[lines.length - 1];
      console.log(`[Python] Транскрипция: "${transcription}"`);

      if (!transcription || transcription === "Ошибка распознавания речи") {
        console.warn('[Python] Ошибка или пустой ответ');
        return res.status(200).json({ transcription: "Ошибка распознавания речи" });
      }

      console.log('[Python] Успешная транскрипция');
      res.json({ transcription: transcription });

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
  // Определяем язык по тексту
  let lang = 'ru'; // по умолчанию
  if (/[a-zA-Z]/.test(text) && !/[а-яА-Я]/.test(text)) {
    lang = 'en';
  } else if (/[äöüß]/.test(text)) {
    lang = 'de';
  }

  console.log(`[generateSpeech] Определён язык: ${lang}`);

  try {
    const urls = getAllAudioUrls(text, {
      lang: lang,
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

// Функция проверки, нужен ли поиск в интернете
function shouldSearchInternet(message) {
  const lowerMsg = message.toLowerCase();

  // Ключевые слова, указывающие на необходимость поиска в интернете
  const searchTriggers = [
    'какой сегодня', 'сколько сейчас', 'погода', 'новости',
    'последние', 'свежие', 'новый', 'новое', 'новые',
    'this year', 'today', 'now', 'current', 'news', 'latest',
    'dieses Jahr', 'heute', 'jetzt', 'aktuell', 'neu',
    '2026', '2025', '2024', // текущие года
    'цены на', 'курс', 'доллар', 'евро', 'биткоин',
    'выборы', 'президент', 'чемпион', 'победитель',
    'купить', 'продажа', 'магазин', 'велосипед', 'сайт',
    'где', 'адрес', 'номер телефона', 'контакты', 'часы',
    'bike', 'shop', 'store', 'buy', 'sell', 'картины',
    'вышел', 'вышла', 'вышло' // новые фильмы/альбомы
  ];

  // Проверяем наличие ключевых слов
  for (const trigger of searchTriggers) {
    if (lowerMsg.includes(trigger)) {
      console.log(`[Search] Триггер поиска: "${trigger}"`);
      return true;
    }
  }

  // Проверяем, содержит ли вопрос дату или время
  const datePattern = /\d{1,2}\.\d{1,2}\.\d{4}|\d{4}-\d{2}-\d{2}/;
  if (datePattern.test(message)) {
    return true;
  }

  return false;
}

// Функция определения типа запроса
function determineQueryType(message) {
  const lowerMsg = message.toLowerCase();

  const types = {
    price: ['цена', 'стоит', 'курс', 'price', 'cost', 'сколько стоит', 'биткоин', 'bitcoin'],
    weather: ['погода', 'weather', 'температура'],
    time: ['время', 'time', 'час', 'который'],
    date: ['дата', 'date', 'день', 'число'],
    product: ['купить', 'продажа', 'buy', 'sell', 'магазин', 'порошок', 'кошачий корм'],
    event: ['билет', 'ticket', 'мероприятие', 'театр', 'кино', 'концерт'],
    news: ['новости', 'последние', 'свежие', 'news'],
    comparison: ['лучше чем', 'сравнить', 'compare', 'vs', 'или']
  };

  for (const [type, keywords] of Object.entries(types)) {
    if (keywords.some(k => lowerMsg.includes(k))) {
      return type;
    }
  }
  return 'general';
}

// Функция оптимизации поискового запроса
function optimizeSearchQuery(message, type) {
  const optimizers = {
    price: message + " цена стоимость прайс 2026",
    product: message + " купить отзывы цена характеристики",
    event: message + " афиша билеты расписание",
    general: message
  };
  return optimizers[type] || message;
}

// Функция извлечения ответа с помощью AI
async function extractAnswerWithAI(searchResults, originalQuestion, type) {
  // Фильтруем только релевантные результаты (не PDF, не словари)
  const relevantResults = searchResults.organic_results
    .filter(r => !r.link.includes('.pdf') &&
      !r.title.toLowerCase().includes('словарь') &&
      !r.snippet?.toLowerCase().includes('словарь'))
    .slice(0, 3);

  if (relevantResults.length === 0) {
    return "Не удалось найти релевантную информацию.";
  }

  const snippets = relevantResults
    .map(r => `[${r.title}]: ${r.snippet}`)
    .join('\n\n');

  const prompt = `Найди в этих результатах ответ на вопрос: "${originalQuestion}". Если есть магазины, сайты, цены — укажи их. Игнорируй словари и PDF. Ответь кратко.`;

  try {
    const response = await axios.post('https://Andrii1-my-chat-model.hf.space/chat', {
      text: `${prompt}\n\nРезультаты поиска:\n${snippets}`,
      type: 'text'
    }, { timeout: 15000 });
    return response.data.response;
  } catch {
    return searchResults.organic_results[0]?.snippet || "Не удалось найти информацию";
  }
}

// Обработка текстовых запросов с кэшированием и поиском
async function handleTextQuery(message, socket) {
  try {
    // Получаем текст и флаг из сообщения (может быть строкой или объектом)
    const messageText = typeof message === 'object' ? message.text : message;
    const isVoice = typeof message === 'object' ? message.isVoice : false;
    // Создаем cacheFile сразу
    const hash = crypto.createHash('md5').update(messageText).digest('hex');
    const cacheFile = path.join(cacheFolder, `${hash}.json`);

    if (!messageText || messageText.trim() === '' || messageText === 'undefined') {
      console.warn('[WebSocket] Пустое или некорректное сообщение');
      return socket.emit('message', '⚠️ Пустое или некорректное сообщение не может быть обработано');
    }
    // Получаем сессию пользователя
    let session = userSessions.get(socket.id) || [];
    console.log(`[DEBUG] Текущая сессия содержит ${session.length} сообщений`);
    console.log(`[DEBUG] isVoice = ${isVoice}, messageText = "${messageText}"`);

    // Логика если запрос о дне или времени
    if (
      messageText.toLowerCase().includes("какой сегодня день") ||
      messageText.toLowerCase().includes("сколько сейчас время") ||
      messageText.toLowerCase().includes("который час") ||
      messageText.toLowerCase().includes("текущее время") ||
      messageText.toLowerCase().includes("сегодняшняя дата") ||
      messageText.toLowerCase().includes("what time") ||
      messageText.toLowerCase().includes("current time") ||
      messageText.toLowerCase().includes("what day") ||
      messageText.toLowerCase().includes("today's date") ||
      messageText.toLowerCase().includes("wie spät") ||
      messageText.toLowerCase().includes("aktuelle zeit") ||
      messageText.toLowerCase().includes("welcher tag") ||
      messageText.toLowerCase().includes("heutiges datum")
    ) {
      const now = new Date();

      // Определяем язык для ответа
      let locale = "ru-RU";
      if (messageText.toLowerCase().includes("what") ||
        messageText.toLowerCase().includes("current") ||
        messageText.toLowerCase().includes("today")) {
        locale = "en-US";
      } else if (messageText.toLowerCase().includes("wie") ||
        messageText.toLowerCase().includes("aktuelle") ||
        messageText.toLowerCase().includes("welcher") ||
        messageText.toLowerCase().includes("heutiges")) {
        locale = "de-DE";
      }

      const localTime = now.toLocaleString(locale, {
        timeZone: "Europe/Berlin",
        dateStyle: "full",
        timeStyle: "medium"
      });

      console.log(`[LocalTime] Отправка времени на ${locale}: ${localTime}`);
      socket.emit('message', localTime);

      if (isVoice) {
        const audioFilePath = path.join(audioDir, `${socket.id}.mp3`);
        await generateSpeech(localTime, audioFilePath);
        socket.emit('audio', `/audio/${socket.id}.mp3?ts=${Date.now()}`);
      }
      return;
    }
    // Проверяем кэш
    if (fs.existsSync(cacheFile)) {
      const cachedData = fs.readFileSync(cacheFile, 'utf-8');
      const cachedResponse = JSON.parse(cachedData);
      console.log(`[Cache] Использование кэша для сообщения: ${messageText}`);
      socket.emit('message', cachedResponse.response);
      if (isVoice) {
        const audioFilePath = path.join(audioDir, `${socket.id}.mp3`);
        await generateSpeech(cachedResponse.response, audioFilePath);
        socket.emit('audio', `/audio/${socket.id}.mp3?ts=${Date.now()}`);
      }
      return;
    }

    // Проверяем, нужно ли искать в интернете
    if (shouldSearchInternet(messageText)) {
      console.log('[Search] Автоматический поиск в интернете');

      // Определяем тип запроса
      const queryType = determineQueryType(messageText);
      const optimizedQuery = optimizeSearchQuery(messageText, queryType);

      // Отправляем запрос через SerpAPI
      const GoogleSearch = require("google-search-results-nodejs").GoogleSearch;
      const search = new GoogleSearch(process.env.SERPAPI_KEY);
      const params = { q: optimizedQuery, hl: "ru", gl: "ru" };

      try {
        const searchResults = await new Promise((resolve, reject) => {
          search.json(params, (data) => {
            if (!data) return reject(new Error("Пустой ответ от сервиса"));
            if (data.error) return reject(new Error(data.error));
            resolve(data);
          });
        });

        // Извлекаем ответ с помощью AI
        let resultText = await extractAnswerWithAI(searchResults, messageText, queryType);
        let firstLink = searchResults.organic_results?.[0]?.link || null;

        const displayText = resultText + (firstLink ? ` Подробнее: <a href="${firstLink}" target="_blank">${firstLink}</a>` : '');
        const speechText = resultText;

        console.log(`[Search] Результаты: ${displayText}`);
        fs.writeFileSync(cacheFile, JSON.stringify({ response: displayText }));
        socket.emit('message', displayText);

        const audioFilePath = path.join(audioDir, `${socket.id}.mp3`);
        await generateSpeech(speechText, audioFilePath);
        socket.emit('audio', `/audio/${socket.id}.mp3?ts=${Date.now()}`);

        return;

      } catch (err) {
        console.error("Ошибка поискового запроса:", err);
        socket.emit('message', "Ошибка при поиске в интернете.");
        return;
      }
    }

    // Логика если запрос начинается с "SEARCH:"
    if (messageText.toLowerCase().startsWith("search:")) {
      const query = messageText.slice(7).trim();
      const GoogleSearch = require("google-search-results-nodejs").GoogleSearch;
      const search = new GoogleSearch(process.env.SERPAPI_KEY);
      const params = { q: query, hl: "ru", gl: "ru" };

      if (query.toLowerCase().includes("погода")) {
        console.log("[Search] Запрос о погоде – не ограничиваем поиск по локации");
      } else if (query.toLowerCase().includes("киев")) {
        params.location = "Kyiv, Ukraine";
      } else if (query.toLowerCase().includes("берн")) {
        params.location = "Bern, Switzerland";
      } else if (query.toLowerCase().includes("лондон")) {
        params.location = "London, United Kingdom";
      } else {
        params.location = "En";
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
        let firstLink = searchResults.organic_results?.[0]?.link || null;

        if (searchResults.answer_box?.type === "weather_result") {
          const weather = searchResults.answer_box;
          resultText = `Погода в ${weather.location} на ${weather.date}: ${weather.weather}, температура ${weather.temperature}°${weather.unit}, осадки ${weather.precipitation}, влажность ${weather.humidity}, ветер ${weather.wind}.`;
          const displayText = resultText + (firstLink ? ` Подробнее: <a href="${firstLink}" target="_blank">${firstLink}</a>` : '');
          const speechText = resultText;

          console.log(`[Search] Результаты: ${displayText}`);
          fs.writeFileSync(cacheFile, JSON.stringify({ response: displayText }));
          socket.emit('message', displayText);

          const audioFilePath = path.join(audioDir, `${socket.id}.mp3`);
          await generateSpeech(speechText, audioFilePath);
          socket.emit('audio', `/audio/${socket.id}.mp3?ts=${Date.now()}`);

        } else if (searchResults.organic_results && searchResults.organic_results.length > 0) {
          const result = searchResults.organic_results[0];
          resultText = "";
          if (result.title) resultText += result.title + ". ";
          if (result.snippet) resultText += result.snippet;

          const displayText = resultText + (firstLink ? ` Подробнее: <a href="${firstLink}" target="_blank">${firstLink}</a>` : '');
          const speechText = resultText;

          console.log(`[Search] Результаты: ${displayText}`);
          fs.writeFileSync(cacheFile, JSON.stringify({ response: displayText }));
          socket.emit('message', displayText);

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

    // Проверка на дублирующиеся сообщения
    const lastMessage = session[session.length - 1];
    if (lastMessage && lastMessage.content === messageText) {
      console.warn('[WebSocket] Дублирующееся сообщение');
      return;
    }

    console.log(`[HF] Отправка запроса в Hugging Face Space: ${messageText}`);

    // Определяем, нужен ли код
    const isCodeRequest = messageText.toLowerCase().includes('код') ||
      messageText.toLowerCase().includes('function') ||
      messageText.toLowerCase().includes('def ') ||
      messageText.toLowerCase().includes('напиши') ||
      messageText.toLowerCase().includes('функцию');


    let prompt;
    if (isCodeRequest) {
      prompt = `Ты — AI-помощник, специализирующийся на написании кода на Python и JavaScript.
      Правила:
      1. Отвечай ТОЛЬКО кодом, без пояснений и комментариев
      2. Используй латинские буквы для названий функций и переменных
      3. Пиши полные, рабочие функции
      4. Для Python: используй def и return
      5. Для JavaScript: используй function или async function, console.log для вывода
      6. Если просят конкретный язык — используй его
      7. Код должен быть готов к копированию и запуску
      
      Запрос: ${messageText}
  
      Код:`;
    } else {
      prompt = `Ответь кратко и по существу. Вопрос: ${messageText}`;
    }

    try {
      // Вызов Space на Hugging Face
      const spaceResponse = await axios.post('https://Andrii1-my-chat-model.hf.space/chat', {
        text: prompt,
        type: 'text'
      }, {
        timeout: 300000
      });

      const botResponse = spaceResponse.data.response;
      console.log(`[Bot] Ответ от Hugging Face: ${botResponse}`);

      // Обновляем сессию пользователя
      userSessions.set(socket.id, [...session, { role: 'user', content: messageText }, { role: 'assistant', content: botResponse }]);

      // Кэшируем ответ
      fs.writeFileSync(cacheFile, JSON.stringify({ response: botResponse }));

      // Отправляем ответ пользователю
      socket.emit('message', botResponse);

      // Если это был голосовой запрос - генерируем речь
      if (isVoice) {
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

  socket.on('message', (message) => {
    const messageText = typeof message === 'object' ? message.text : message;
    console.log(`[Сообщение] ${socket.id}: ${messageText}`);

    const queue = messageQueues.get(socket.id) || [];
    queue.push(message);
    messageQueues.set(socket.id, queue);

    if (queue.length === 1) {
      processMessageQueue(socket);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Сервер] Запуск на порту ${PORT}`);
});