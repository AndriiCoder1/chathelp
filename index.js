require('dotenv').config();
console.log("OpenAI API Key:", process.env.OPENAI_API_KEY ? "Загружен" : "Не найден");
console.log("SerpAPI Key:", process.env.SERPAPI_KEY ? "Загружен" : "Не найден");

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { SerpApi } = require('serpapi');
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

const search = new SerpApi.SerpApiSearch(serpApiKey);

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
      if (/какой сегодня день|какое сейчас время|какая дата/i.test(message)) {
        const now = new Date();
        const formattedDate = now.toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const formattedTime = now.toLocaleTimeString('ru-RU');
        socket.emit('message', `Сегодня ${formattedDate}, текущее время: ${formattedTime}`);
        return;
      }

      if (/поиск|найди|события|погода|мероприятия/i.test(message)) {
        const searchQuery = message.replace(/поиск|найди|события|погода|мероприятия/gi, '').trim();
        socket.emit('message', `Вы хотите, чтобы я нашёл эту информацию в интернете? Ответьте "да" или "нет".`);

        socket.once('confirmation', async (confirmation) => {
          if (confirmation.toLowerCase() === 'да') {
            console.log("Пользователь подтвердил поиск в интернете.");
            const params = {
              q: searchQuery,
              location: "Europe", 
              google_domain: "google.com",
              gl: "us", 
              hl: "ru",  
            };

            try {
              const results = await search.json(params);
              const topResults = results.organic_results.slice(0, 3);
              const summaries = topResults.map(result => {
                return `Название: ${result.title}\nСсылка: ${result.link}\nОписание: ${result.snippet || "Описание отсутствует"}\n`;
              }).join('\n');
              socket.emit('message', `Вот результаты поиска:\n${summaries}`);
            } catch (err) {
              console.error("Ошибка при выполнении поиска:", err);
              socket.emit('message', "Произошла ошибка при выполнении поиска.");
            }
          } else {
            console.log("Пользователь отказался от поиска в интернете.");
            socket.emit('message', 'Хорошо, ничего не ищу.');
          }
        });
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
