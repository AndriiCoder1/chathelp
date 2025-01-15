// Импорт переменных окружения
require('dotenv').config();

console.log("OpenAI API Key:", process.env.OPENAI_API_KEY ? "Загружен" : "Не найден");
console.log("SerpAPI Key:", process.env.SERPAPI_KEY ? "Загружен" : "Не найден");

// Импорт необходимых модулей
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { OpenAI } = require('openai');
const { getJson } = require('serpapi');

// Инициализация OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://chathelp-y22r.onrender.com',
  },
});

// Хранилище пользовательских сессий
const userSessions = new Map();

// Настройка статических файлов
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Функция для обращения к OpenAI
const getOpenAIResponse = async (message, socket) => {
  try {
    console.log("Отправка сообщения в OpenAI:", message);
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: message }],
    });

    const botResponse = response.choices[0].message.content;
    console.log("Ответ OpenAI:", botResponse);
    if (socket) {
      socket.emit('aiResponse', { text: botResponse });
    }
    return botResponse;
  } catch (error) {
    console.error("Ошибка OpenAI:", error);
    if (socket) {
      socket.emit('aiResponse', { text: 'Ошибка при обработке запроса.' });
    }
  }
};

// Обработка жестов через OpenAI
const processGesture = async (gestureData, socket) => {
  try {
    console.log("Получены данные жеста:", gestureData);
    const message = `Жест распознан: ${gestureData.util}`;
    const response = await getOpenAIResponse(message, socket);
    return response;
  } catch (error) {
    console.error("Ошибка обработки жеста:", error);
    if (socket) {
      socket.emit('aiResponse', { text: 'Ошибка при распознавании жеста.' });
    }
  }
};

// Обработка соединений WebSocket
io.on('connection', (socket) => {
  console.log(`Пользователь подключился: ${socket.id}`);

  // Инициализация пользовательской сессии
  userSessions.set(socket.id, {
    messages: [], // Сообщения пользователя
  });

  // Обработка текстовых сообщений
  socket.on('message', async (message) => {
    console.log(`Сообщение от ${socket.id}:`, message);
    const session = userSessions.get(socket.id);
    if (!session) return;

    session.messages.push({ role: "user", content: message });

    // Логика обращения к OpenAI
    const botResponse = await getOpenAIResponse(message, socket);

    session.messages.push({ role: "assistant", content: botResponse });
  });

  // Обработка видеопотока (жесты)
  socket.on('videoStream', async (data) => {
    console.log(`Видео данные от ${socket.id}:`, data);

    if (data && data.util) {
      const response = await processGesture(data, socket);
      console.log("Ответ на жест:", response);
    } else {
      console.error("Некорректные данные жеста.");
      socket.emit('aiResponse', { text: 'Некорректные данные жеста.' });
    }
  });

  // Отключение пользователя
  socket.on('disconnect', () => {
    console.log(`Пользователь отключился: ${socket.id}`);
    userSessions.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});
