require('dotenv').config();
console.log(process.env.OPENAI_API_KEY);

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { OpenAI } = require('openai');
const path = require('path');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://chathelp-y22r.onrender.com',  // Замените на ваш адрес фронтенда
  },
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// История сообщений для каждого клиента
const userMessages = {};

io.on('connection', (socket) => {
  console.log('Новое подключение');

  // Инициализация истории сообщений для нового пользователя
  userMessages[socket.id] = [];

  socket.on('message', async (message) => {
    console.log(`Получено сообщение от ${socket.id}: ${message}`);

    try {
      // Добавление сообщения в историю
      userMessages[socket.id].push({ role: 'user', content: message });

      // Отправка истории сообщений в OpenAI
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: userMessages[socket.id],  // Отправка всей истории сообщений для этого пользователя
      });

      const botResponse = response.choices[0].message.content;
      // Отправка ответа на тот же сокет, который отправил сообщение
      socket.emit('message', botResponse);

      // Добавление ответа бота в историю
      userMessages[socket.id].push({ role: 'assistant', content: botResponse });
    } catch (error) {
      console.error('Ошибка при получении ответа от OpenAI:', error);
      socket.emit('message', 'Извините, я не могу ответить на ваш вопрос.');
    }
  });

  socket.on('disconnect', () => {
    console.log('Пользователь отключился');
    // Очистка истории сообщений при отключении
    delete userMessages[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
