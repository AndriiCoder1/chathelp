// Загружаем переменные окружения
require('dotenv').config();
console.log("OpenAI API Key:", process.env.OPENAI_API_KEY ? "Загружен" : "Не найден");
console.log("SerpAPI Key:", process.env.SERPAPI_KEY ? "Загружен" : "Не найден");

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// Асинхронная функция для импорта fetch
async function fetchData() {
  const { default: fetch } = await import('node-fetch');
  // Теперь можно использовать fetch, например:
  // const response = await fetch('https://api.example.com/data');
  // const data = await response.json();
  // console.log(data);
}

const cheerio = require('cheerio');
const path = require('path');
const { SerpApi } = require('serpapi'); // Для работы с SerpAPI
const { OpenAI } = require('openai'); // Для работы с OpenAI

// Инициализация OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Инициализация SerpAPI
const serpApiKey = process.env.SERPAPI_KEY;
const search = new SerpApi.GoogleSearch(serpApiKey);

// Создание Express сервера
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://chathelp-y22r.onrender.com', // Укажи нужный URL клиента
  },
});

// Раздача статичных файлов
app.use(express.static(path.join(__dirname, 'public')));

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Хранение сообщений пользователя
const userMessages = {};

// Обработка соединений через WebSocket
io.on('connection', (socket) => {
  console.log('Новое подключение от клиента:', socket.id);
  userMessages[socket.id] = [];

  socket.on('message', async (message) => {
    console.log(`Получено сообщение от ${socket.id}: ${message}`);

    try {
      // Если сообщение содержит запрос на дату или время
      if (/какой сегодня день|какое сейчас время|какая дата/i.test(message)) {
        const now = new Date();
        const formattedDate = now.toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const formattedTime = now.toLocaleTimeString('ru-RU');
        socket.emit('message', `Сегодня ${formattedDate}, текущее время: ${formattedTime}`);
        return;
      }

      // Если сообщение содержит запрос на поиск
      if (/поиск|найди|события|погода|мероприятия/i.test(message)) {
        const searchQuery = message.replace(/поиск|найди|события|погода|мероприятия/gi, '').trim();
        socket.emit('message', `Вы хотите, чтобы я нашёл эту информацию в интернете? Ответьте "да" или "нет".`);

        socket.once('confirmation', async (confirmation) => {
          if (confirmation.toLowerCase() === 'да') {
            console.log("Пользователь подтвердил поиск в интернете.");
            const params = {
              q: searchQuery,
              location: "Russia",
              google_domain: "google.com",
              gl: "us",  // Язык
              hl: "en",  // Язык
            };

            // Запрос к SerpAPI для поиска
            const results = await search.json(params);
            const topResults = results.organic_results.slice(0, 3);
            const summaries = topResults.map(result => {
              return `Название: ${result.title}\nСсылка: ${result.link}\nОписание: ${result.snippet || "Описание отсутствует"}\n`;
            }).join('\n');
            socket.emit('message', `Вот результаты поиска:\n${summaries}`);
          } else {
            console.log("Пользователь отказался от поиска в интернете.");
            socket.emit('message', 'Хорошо, ничего не ищу.');
          }
        });
        return;
      }

      // Прочие запросы обрабатываем через OpenAI
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

// Запуск сервера на порту 3000 или на порту из переменной окружения
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
