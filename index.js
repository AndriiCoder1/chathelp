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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const serpApiKey = process.env.SERPAPI_KEY;
if (!serpApiKey) {
  console.error("SerpAPI Key отсутствует!");
  process.exit(1);
}

console.log("SerpApi:", getJson);
console.log("serpApiKey:", serpApiKey);

const search = getJson;

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

// Маршрут для обработки видеоввода
app.post('/process-video', async (req, res) => {
  try {
    const { frames } = req.body; // Ожидается массив кадров в base64
    if (!frames || !Array.isArray(frames)) {
      return res.status(400).json({ error: 'Данные кадров отсутствуют или имеют неверный формат' });
    }

    // Анализируем каждый кадр через OpenAI
    const results = await Promise.all(
      frames.map(async (frame) => {
        const response = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            { role: 'system', content: 'Ты система распознавания жестов. Анализируй видео.' },
            { role: 'user', content: `Анализируй этот кадр: ${frame}` },
          ],
        });
        return response.choices[0].message.content;
      })
    );

    // Возвращаем результат анализа всех кадров
    res.json({ results });
  } catch (error) {
    console.error("Ошибка при обработке видеоввода:", error);
    res.status(500).json({ error: 'Ошибка при обработке видеоввода' });
  }
});

// Маршрут для обработки аудиофайлов
app.post('/process-audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Аудиофайл не был загружен.' });
    }

    const audioFilePath = req.file.path;

    // Обработка аудиофайла через OpenAI
    const response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioFilePath),
      model: 'whisper-1',
    });

    // Удаляем файл после обработки
    fs.unlinkSync(audioFilePath);

    // Возвращаем текстовую расшифровку
    res.json({ transcription: response.text });
  } catch (error) {
    console.error('Ошибка при обработке аудио:', error);
    res.status(500).json({ error: 'Ошибка при распознавании речи' });
  }
});

// Функция для обработки текстовых запросов
async function handleTextQuery(message, socket, userMessages) {
  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [...userMessages[socket.id], { role: 'user', content: message }],
  });
  const botResponse = response.choices[0].message.content;
  socket.emit('message', botResponse);
  userMessages[socket.id].push({ role: 'assistant', content: botResponse });
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
