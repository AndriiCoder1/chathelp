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

const getOpenAIResponse = async (message, socket) => {
  try {
    console.log("Отправка запроса в OpenAI с сообщением:", message);
    const response = await openai.chat.completions.create({
      model: "gpt-4o",  
      messages: [{ role: "user", content: message }],
    });

    console.log("Ответ от OpenAI:", response);
    const botResponse = response.choices[0].message.content;
    if (socket) {
      socket.emit('message', botResponse);
    }
    return botResponse;

  } catch (error) {
    console.error("Ошибка при получении ответа от OpenAI:", error);
    if (socket) {
      socket.emit('message', 'Произошла ошибка при обработке вашего жеста.');
    }
  }
};

const processGesture = (gestureData, socket) => {
  console.log("Получен жест:", gestureData);
  const message = `Обработан жест: ${gestureData}`;
  return getOpenAIResponse(message, socket);
};

const serpApiKey = process.env.SERPAPI_KEY;
if (!serpApiKey) {
  console.error("SerpAPI Key отсутствует!");
  process.exit(1);
}

const search = getJson;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://chathelp-y22r.onrender.com',
  },
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); 

app.get('/', (req, res) => {
  console.log("Запрос к главной странице...");
  res.sendFile(path.join(__dirname, 'index.html'));
});

const userMessages = {};

io.on('connection', (socket) => {
  console.log('Новое подключение от клиента:', socket.id);
  userMessages[socket.id] = [];

  socket.on('message', async (message) => {
    console.log(`Получено сообщение от ${socket.id}: ${message}`);

    try {
      
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
          botResponse = 'Всё по-прежнему. Если нужно что-то конкретное, скажи!';
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
        console.log("Ответ от бота:", botResponse);
        return;
      }

      userMessages[socket.id].push({ role: 'user', content: message });

      if (!message || typeof message !== 'string') {
        throw new Error('Некорректный формат сообщения');
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: userMessages[socket.id],
      });
      const botResponse = response.choices[0].message.content;
      console.log("Ответ от бота:", botResponse);
      socket.emit('message', botResponse);

      userMessages[socket.id].push({ role: 'assistant', content: botResponse });

    } catch (error) {
      console.error('Ошибка при обработке сообщения:', error);
      socket.emit('message', 'Произошла ошибка при обработке вашего запроса.');
    }
  });

  socket.on('gesture', async (gestureData) => {
    console.log("Получены данные о жесте от клиента:", gestureData);
    try {
      const response = await processGesture(gestureData, socket);
      console.log("Ответ на жест от OpenAI:", response);
    } catch (error) {
      console.error("Ошибка при обработке жеста:", error);
      socket.emit('message', 'Произошла ошибка при обработке вашего жеста.');
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

if (process.env.NODE_ENV === 'development') {
  processGesture("жест указателя", null).then(response => {
    console.log("Ответ от OpenAI:", response);
  });
}
