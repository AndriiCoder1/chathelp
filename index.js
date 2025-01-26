require('dotenv').config();
console.log("OpenAI API Key:", process.env.OPENAI_API_KEY ? "Загружен" : "Не найден");
console.log("SerpAPI Key:", process.env.SERPAPI_KEY ? "Загружен" : "Не найден");

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { getJson } = require('serpapi');
const { OpenAI } = require('openai');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { exec } = require('child_process');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const serpApiKey = process.env.SERPAPI_KEY;
if (!serpApiKey) {
  console.error("SerpAPI Key отсутствует!");
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://chathelp-y22r.onrender.com',
  },
});

// Для обработки загрузки аудиофайлов
const upload = multer({ dest: 'uploads/' });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' })); // Для обработки больших данных, включая кадры видео

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

const userMessages = {};

// Маршрут для обработки аудиофайлов
app.post('/process-audio', upload.single('audio'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Аудиофайл не был загружен.' });
    }

    const audioFilePath = req.file.path;

    // Вызов Python-скрипта для транскрипции
    exec(`"C:/Users/mozart/AppData/Local/Programs/Python/Python38/python.exe" transcribe.py "${audioFilePath.replace(/\\/g, '/')}"`, (error, stdout, stderr) => {
      if (error) {
        console.error('Ошибка при выполнении Python-скрипта:', error);
        return res.status(500).json({ error: 'Ошибка при транскрипции аудио' });
      
      }

      if (stderr) {
        console.error('Ошибка в Python-скрипте:', stderr);
        return res.status(500).json({ error: 'Ошибка при транскрипции аудио' });
      }

      // Удаляем файл после обработки
      fs.unlinkSync(audioFilePath);

      // Возвращаем текстовую расшифровку
      res.json({ transcription: stdout.trim() });
    });
  } catch (error) {
    console.error('Ошибка при обработке аудио:', error);
    res.status(500).json({ error: 'Ошибка при распознавании речи' });
  }
});

// Функция для обработки текстовых запросов с использованием gpt-3.5-turbo
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});