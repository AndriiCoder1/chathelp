require('dotenv').config();

console.log("OpenAI API Key:", process.env.OPENAI_API_KEY ? "Загружен" : "Не найден");
console.log("SerpAPI Key:", process.env.SERPAPI_KEY ? "Загружен" : "Не найден");

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { OpenAI } = require('openai');
const path = require('path');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const processGesture = async (gestureData, socket) => {
  console.log("Получен жест:", gestureData);

  const message = `Обработан жест: ${JSON.stringify(gestureData)}`;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: message }],
    });

    const botResponse = response.choices[0].message.content;
    console.log("Ответ от OpenAI:", botResponse);
    socket.emit('gestureResponse', botResponse);
  } catch (error) {
    console.error("Ошибка при обработке жеста:", error);
    socket.emit('message', 'Произошла ошибка при обработке вашего жеста.');
  }
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://chathelp-y22r.onrender.com',
  },
});

// Список пользователей и сообщений
const userMessages = {};

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// WebSocket подключение
io.on('connection', (socket) => {
  console.log('Новое подключение:', socket.id);
  userMessages[socket.id] = [];

  // Обработка текстовых сообщений
  socket.on('message', async (message) => {
    console.log(`Сообщение от ${socket.id}: ${message}`);
    try {
      if (!message || typeof message !== 'string') {
        throw new Error('Некорректное сообщение');
      }

      userMessages[socket.id].push({ role: 'user', content: message });

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: userMessages[socket.id],
      });

      const botResponse = response.choices[0].message.content;
      socket.emit('message', botResponse);

      userMessages[socket.id].push({ role: 'assistant', content: botResponse });
    } catch (error) {
      console.error('Ошибка обработки сообщения:', error);
      socket.emit('message', 'Ошибка обработки запроса.');
    }
  });

  // Обработка жестов
  socket.on('gesture', (gestureData) => {
    if (gestureData && typeof gestureData === 'object') {
      processGesture(gestureData, socket);
    } else {
      socket.emit('message', 'Некорректный формат данных для жестов.');
    }
  });

  // Отключение пользователя
  socket.on('disconnect', () => {
    console.log('Пользователь отключился:', socket.id);
    delete userMessages[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
