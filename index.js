require('dotenv').config();
console.log("OpenAI API Key:", process.env.OPENAI_API_KEY ? "Загружен" : "Не найден");
console.log("SerpAPI Key:", process.env.SERPAPI_KEY ? "Загружен" : "Не найден");

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { getJson } = require('serpapi');
const { OpenAI } = require('openai');
const path = require('path');

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

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

const userMessages = {};

// Вспомогательная функция для обработки запросов по годам
async function handleYearBasedQuery(message, socket, userMessages) {
  const yearMatch = message.match(/\b\d{4}\b/); // Ищем год в запросе
  if (yearMatch) {
    const year = parseInt(yearMatch[0]);
    if (year <= 2023) {
      // Если год до или равен 2023, отвечаем из базы
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [...userMessages[socket.id], { role: 'user', content: message }],
      });
      const botResponse = response.choices[0].message.content;
      socket.emit('message', botResponse);
    } else {
      // Если год больше 2023, выполняем поиск в интернете
      const params = {
        q: message,
        google_domain: "google.com",
        gl: "us",
        hl: "ru",
        api_key: serpApiKey,
      };
      try {
        const results = await search(params);
        const topResults = results.organic_results.slice(0, 3);
        const summaries = topResults.map(result => {
          return `Название: ${result.title}\nСсылка: ${result.link}\nОписание: ${result.snippet || "Описание отсутствует"}\n`;
        }).join('\n');
        socket.emit('message', `Вот результаты поиска:\n${summaries}`);
      } catch (err) {
        console.error("Ошибка при выполнении поиска:", err);
        socket.emit('message', "Произошла ошибка при выполнении поиска.");
      }
    }
  } else {
    // Если год не указан, возвращаем ответ из базы
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [...userMessages[socket.id], { role: 'user', content: message }],
    });
    const botResponse = response.choices[0].message.content;
    socket.emit('message', botResponse);
  }
}

// Главный обработчик подключений
io.on('connection', (socket) => {
  console.log('Новое подключение от клиента:', socket.id);
  userMessages[socket.id] = [];

  socket.on('message', async (message) => {
    console.log(`Получено сообщение от ${socket.id}: ${message}`);
    
    try {
      if (/кто победил|победитель/i.test(message)) {
        // Обработка запросов по годам
        await handleYearBasedQuery(message, socket, userMessages);
        return;
      }

      // Проверка на простые запросы
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

      // Обработка поисковых запросов
      if (/поиск|найди|события|погода|мероприятия/i.test(message)) {
        const searchQuery = message.replace(/поиск|найди|события|погода|мероприятия/gi, '').trim();
        console.log(`Запрос к поиску: ${searchQuery}`);
        const params = {
          q: searchQuery,
          google_domain: "google.com",
          gl: "us",
          hl: "ru",
          api_key: serpApiKey,
        };
        try {
          const results = await search(params);
          const topResults = results.organic_results.slice(0, 3);
          const summaries = topResults.map(result => {
            return `Название: ${result.title}\nСсылка: ${result.link}\nОписание: ${result.snippet || "Описание отсутствует"}\n`;
          }).join('\n');
          socket.emit('message', `Вот результаты поиска:\n${summaries}`);
        } catch (err) {
          console.error("Ошибка при выполнении поиска:", err);
          socket.emit('message', "Произошла ошибка при выполнении поиска.");
        }
        return;
      }

      // OpenAI API для остальных запросов
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
