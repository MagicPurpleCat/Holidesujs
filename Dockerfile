# Используем официальный образ Node.js 22 на Alpine (лёгкий)
FROM node:22-alpine

# Устанавливаем рабочую директорию внутри контейнера
WORKDIR /app

# Копируем package.json и package-lock.json (если есть)
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем весь остальной проект
COPY . .

# Открываем порт, если ваш бот слушает HTTP (необязательно, но полезно)
EXPOSE 3000

# Команда для запуска
CMD ["npm", "start"]
