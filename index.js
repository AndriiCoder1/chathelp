require('dotenv').config();
console.log(process.env.OPENAI_API_KEY);

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { OpenAI } = require('openai');
const path = require('path'); // Добавлено
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://chathelp-8763d47e225a.herokuapp.com', 
  },
});

app.use(express.static(path.join(__dirname, 'public'))); 

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
  console.log('Новое подключение');

  socket.on('message', async (message) => {
    console.log(`Получено сообщение: ${message}`);

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: message }],
      });

      const botResponse = response.choices[0].message.content;
      io.emit('message', botResponse);
    } catch (error) {
      console.error('Ошибка при получении ответа от OpenAI:', error);
      io.emit('message', 'Извините, я не могу ответить на ваш вопрос.');
    }
  });

  socket.on('disconnect', () => {
    console.log('Пользователь отключился');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
