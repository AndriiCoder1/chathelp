require('dotenv').config();
console.log("OpenAI API Key:", process.env.OPENAI_API_KEY ? "Загружен" : "Не найден");
console.log("SerpAPI Key:", process.env.SERPAPI_KEY ? "Загружен" : "Не найден");

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { OpenAI } = require('openai');
const path = require('path');
const { SerpAPI } = require('serpapi');

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

const serpApi = new SerpAPI(process.env.SERPAPI_KEY);

async function searchFutureEvent(message) {
  const query = `выборы США ${message}`;

  try {
    const searchResults = await serpApi.getJson({
      q: query,
      location: "Russia",
      hl: "ru",
      gl: "ru",
    });
    return searchResults.organic_results && searchResults.organic_results[0]
      ? searchResults.organic_results[0].snippet
      : "Не удалось найти информацию по вашему запросу.";
  } catch (error) {
    console.error("Ошибка при поиске информации:", error);
    return "Произошла ошибка при поиске информации.";
  }
}

async function handleYearBasedQuery(message, socket, userMessages) {
  const yearMatch = message.match(/\b\d{4}\b/); 
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
      socket.emit('message', "Извините, у меня нет информации о событиях в будущем.");
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

      const simpleResponses = [
        /добрый вечер/i,
        /привет/i,
        /как дела/i,
        /что нового/i,
        /какой сегодня день/i,
      ];
      if (simpleResponses.some(regex => regex.test(message))) {
        let botResponse = '';
        if (/добрый вечер/i.test(message)) {
          botResponse = 'Добрый вечер! Чем могу помочь?';
        } else if (/привет/i.test(message)) {
          botResponse = 'Привет! Как я могу помочь?';
        } else if (/как дела/i.test(message)) {
          botResponse = 'Все хорошо, спасибо! А у тебя как?';
        } else if (/что нового/i.test(message)) {
          botResponse = 'Всё по-прежнему, если хочешь, могу помочь чем-то еще!';
        } else if (/какой сегодня день/i.test(message)) {
          const currentDate = new Date();
          const date = currentDate.toLocaleDateString('ru-RU', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });
          botResponse = `Сегодня ${date}`;
        }
        socket.emit('message', botResponse);
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
