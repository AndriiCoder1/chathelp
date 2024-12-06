require('dotenv').config();
console.log("OpenAI API Key:", process.env.OPENAI_API_KEY ? "Загружен" : "Не найден");
console.log("SerpAPI Key:", process.env.SERPAPI_KEY ? "Загружен" : "Не найден");

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { OpenAI } = require('openai');
const fetch = require('node-fetch'); 
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
  console.log('Новое подключение от клиента:', socket.id);
  userMessages[socket.id] = [];

  socket.on('message', async (message) => {
    console.log(`Получено сообщение от ${socket.id}: ${message}`);
  
    try {
      
      if (/поиск|найди|погода|информация|найти/i.test(message)) {
        console.log("Обрабатываю запрос через SerpAPI...");
        const searchQuery = message.replace(/поиск|найди|погода|информация|найти/gi, '').trim();
        
        
        const serpApiResponse = await fetch(`https://serpapi.com/search.json?q=${encodeURIComponent(searchQuery)}&engine=google&api_key=${process.env.SERPAPI_KEY}`, {
          timeout: 10000, 
        });
        const searchResults = await serpApiResponse.json();
  
        if (searchResults.error) {
          console.error("Ошибка от SerpAPI:", searchResults.error);
          throw new Error(searchResults.error);
        }
  
        
        const results = searchResults.organic_results || [];
        if (results.length === 0) {
          socket.emit('message', 'Не удалось найти результаты для вашего запроса.');
          return;
        }

        const formattedResults = results.slice(0, 3).map(result => `${result.title}: ${result.link}`).join('\n');
        socket.emit('message', `Вот результаты поиска:\n${formattedResults}`);
      } else {
        console.log("Обрабатываю сообщение с OpenAI...");
        userMessages[socket.id].push({ role: 'user', content: message });
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: userMessages[socket.id],
        });
  
        const botResponse = response.choices[0].message.content;
        socket.emit('message', botResponse);
        userMessages[socket.id].push({ role: 'assistant', content: botResponse });
      }
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
