require('dotenv').config();

console.log("OpenAI API Key:", process.env.OPENAI_API_KEY ? "Загружен" : "Не найден");
console.log("SerpAPI Key:", process.env.SERPAPI_KEY ? "Загружен" : "Не найден");

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://chathelp-y22r.onrender.com', // Разрешите домен, на котором работает фронтенд
  },
});

// Хранилище сессий пользователей
const userSessions = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Обработка соединения
io.on('connection', (socket) => {
  console.log(`Подключился пользователь: ${socket.id}`);

  // Инициализация персональной сессии
  userSessions.set(socket.id, {
    videoBuffer: [], // Сохраняем кадры видео (опционально, для примера)
  });

  // Обработка отправки видеопотока
  socket.on('videoStream', (data) => {
    // data будет содержать кадры или данные видео (base64)
    console.log(`Видео данные от ${socket.id}:`, data.frame?.slice(0, 50)); // Пример: показываем начало фрейма

    // Обработка фрейма через OpenAI (вставьте вашу обработку здесь)
    const recognizedText = "Пример жеста"; // Это будет результат от OpenAI
    socket.emit('recognizedText', { text: recognizedText });
  });

  // Редактирование текста перед отправкой
  socket.on('sendEditedText', async (editedText) => {
    console.log(`Пользователь ${socket.id} отправил текст для обработки:`, editedText);

    // Отправка текста в OpenAI
    const aiResponse = `Ответ на текст: "${editedText}"`; // Здесь вызывается OpenAI API
    socket.emit('aiResponse', { text: aiResponse });
  });

  // Отключение пользователя
  socket.on('disconnect', () => {
    console.log(`Пользователь ${socket.id} отключился`);
    userSessions.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});

