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
    origin: 'https://chathelp-y22r.onrender.com',  
  },
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});


const userMessages = {};

io.on('connection', (socket) => {
  console.log('Новое подключение');

  
  userMessages[socket.id] = [];

  socket.on('message', async (message) => {
    console.log(`Получено сообщение от ${socket.id}: ${message}`);

    try {
     
      userMessages[socket.id].push({ role: 'user', content: message });

     
      const response = await openai.chat.completions.create({
        model: "gpt-4o", 
        messages: userMessages[socket.id],  
      });

      const botResponse = response.choices[0].message.content;
      
      socket.emit('message', botResponse);

     
      userMessages[socket.id].push({ role: 'assistant', content: botResponse });
    } catch (error) {
      console.error('Ошибка при получении ответа от OpenAI:', error);
      socket.emit('message', 'Извините, я не могу ответить на ваш вопрос.');
    }
  });

  socket.on('disconnect', () => {
    console.log('Пользователь отключился');
    
    delete userMessages[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
