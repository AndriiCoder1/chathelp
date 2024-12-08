require('dotenv').config();
console.log("OpenAI API Key:", process.env.OPENAI_API_KEY ? "Загружен" : "Не найден");
console.log("SerpAPI Key:", process.env.SERPAPI_KEY ? "Загружен" : "Не найден");

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { OpenAI } = require('openai');
const axios = require('axios');
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

// Функция для выполнения поиска с помощью SerpAPI
async function searchFutureEvent(message) {
  const query = `выборы США ${message}`;
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${process.env.SERPAPI_KEY}`;

  try {
    const response = await axios.get(url);
    const results = response.data.organic_results;
    if (results && results.length > 0) {
      return results[0].snippet || "Не удалось найти информацию по вашему запросу.";
    }
    return "Информация не найдена.";
  } catch (error) {
    console.error("Ошибка при поиске через SerpAPI:", error);
    return "Произошла ошибка при поиске информации.";
  }
}

async function handleYearBasedQuery(message, socket, userMessages) {
  const yearMatch = message.match(/\b\d{4}\b/); // Ищем год в запросе
  const currentYear = new Date().getFullYear();

  if (yearMatch) {
    const year = parseInt(yearMatch[0]);

    if (year <= currentYear) {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [...userMessages[socket.id], { role: 'user', content: message }],
      });
      const botResponse = response.choices[0].message.content;
      socket.emit('message', botResponse);
    } else {
      const futureInfo = await searchFutureEvent(year);
      socket.emit('message', futureInfo);
    }
  } else {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [...userMessages[socket.id], { role: 'user', content: message }],
    });
    const botResponse = response.choices[0].message.content;
    socket.emit('message', botResponse);
  }
}

io.on('connection', (socket) => {
  console.log('Новое подключение от клиента:', socket.id);
  userMessages[socket.id] = [];

  socket.on('message', async (message) => {
    console.log(`Получено сообщение от ${socket.id}: ${message}`);

    try {
      if (/кто победил|победитель/i.test(message)) {
        await handleYearBasedQuery(message, socket, userMessages);
        return;
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
