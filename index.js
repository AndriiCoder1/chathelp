require('dotenv').config();

// Логирование загрузки ключей
console.log("OpenAI API Key:", process.env.OPENAI_API_KEY ? "Загружен" : "Не найден");
console.log("SerpAPI Key:", process.env.SERPAPI_KEY ? "Загружен" : "Не найден");

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { OpenAI } = require('openai');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { exec } = require('child_process');

// Инициализация OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Проверка наличия ключа SerpAPI
const serpApiKey = process.env.SERPAPI_KEY;
if (!serpApiKey) {
  console.error("SerpAPI Key отсутствует!");
  process.exit(1);
}

// Настройка Express и Socket.IO
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://chathelp-y22r.onrender.com',
  },
});

// Настройка Multer для загрузки аудио
const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'audio/wav' || file.mimetype === 'audio/x-wav') {
    cb(null, true);
  } else {
    cb(new Error('Неподдерживаемый формат файла'), false);
  }
};

const upload = multer({
  dest: 'uploads/',
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
    files: 1,
  },
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

// Маршруты
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Хранение сообщений пользователей
const userMessages = {};

// Маршрут для обработки аудиофайлов
app.post('/process-audio', upload.single('audio'), (req, res) => {
  let audioFilePath;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Аудиофайл не был загружен.' });
    }

    audioFilePath = req.file.path;
    console.log(`[Аудио] Путь к файлу: ${audioFilePath}`);

    // Вызов Python-скрипта для транскрипции
    exec(
      `"${process.env.PYTHON_PATH || 'python'}" transcribe.py "${audioFilePath.replace(/\\/g, '/')}"`,
      { encoding: 'utf8' },
      (error, stdout, stderr) => {
        // Всегда удаляем файл после обработки
        if (fs.existsSync(audioFilePath)) {
          fs.unlinkSync(audioFilePath);
        }

        // Обработка ошибок
        if (error) {
          console.error('[Python] Ошибка выполнения:', error);
          return res.status(500).json({ error: 'Ошибка выполнения скрипта' });
        }

        // Проверяем вывод скрипта
        if (stdout && stdout.trim()) {
          console.log('[Python] Успешная транскрипция');
          return res.json({ transcription: stdout.trim() });
        }

        // Логируем stderr только если есть данные
        if (stderr) {
          console.error('[Python] Ошибка:', stderr);
        }

        res.status(500).json({ error: 'Не удалось выполнить транскрипцию' });
      }
    );
  } catch (error) {
    // Удаление файла в случае исключения
    if (audioFilePath && fs.existsSync(audioFilePath)) {
      fs.unlinkSync(audioFilePath);
    }
    console.error('[Сервер] Критическая ошибка:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Функция для обработки текстовых запросов с использованием GPT-3.5
async function handleTextQuery(message, socket, userMessages) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [...userMessages[socket.id], { role: 'user', content: message }],
    });
    const botResponse = response.choices[0].message.content;
    socket.emit('message', botResponse);
    userMessages[socket.id].push({ role: 'assistant', content: botResponse });
  } catch (error) {
    console.error('Ошибка при обработке текстового запроса:', error);
    socket.emit('message', 'Произошла ошибка при обработке вашего запроса.');
  }
}

// WebSocket логика
io.on('connection', (socket) => {
  console.log('Новое подключение от клиента:', socket.id);
  userMessages[socket.id] = [];

  socket.on('message', async (message) => {
    console.log(`Получено сообщение от ${socket.id}: ${message}`);
    try {
      if (/жест|видео|распознай/i.test(message)) {
        socket.emit('message', 'Отправьте видеокадры на /process-video для анализа жестов.');
        return;
      }

      userMessages[socket.id].push({ role: 'user', content: message });
      await handleTextQuery(message, socket, userMessages);
    } catch (error) {
      console.error('Ошибка при обработке сообщения:', error);
      socket.emit('message', 'Произошла ошибка при обработке вашего запроса.');
    }
  });

  socket.on('disconnect', () => {
    console.log('Пользователь отключился:', socket.id);
    delete userMessages[socket.id];
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});