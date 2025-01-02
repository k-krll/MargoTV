# MargoTV - Видеохостинг с поддержкой субтитров

MargoTV - это веб-приложение для хостинга видео с поддержкой загрузки, конвертации и стриминга видео, а также работы с субтитрами.

## Основные возможности

- 🎥 Загрузка и хранение видео
- 🔄 Автоматическая конвертация видео в разные качества (240p - 1080p)
- 📝 Поддержка субтитров (формат SRT)
- 🎨 Современный интерфейс в стиле Netflix
- 📱 Адаптивный дизайн
- 🔄 Отслеживание прогресса обработки видео в реальном времени
- ✏️ Редактирование информации о видео
- 🗑️ Управление видео (удаление, обновление)

## Технологии

- Node.js
- Express.js
- MongoDB
- FFmpeg
- Socket.IO
- Docker
- Nginx

## Требования

- Docker и Docker Compose
- Node.js 18+
- MongoDB
- FFmpeg

## Установка и запуск

### 1. Клонирование репозитория

```bash
git clone https://github.com/your-username/margotv.git
cd margotv
```

### 2. Настройка переменных окружения

Создайте файл `.env` в корневой директории:

```env
MONGODB_URI=mongodb://mongodb:27017/margotv
NODE_ENV=production
```

### 3. Запуск с помощью Docker

```bash
# Сборка и запуск контейнеров
docker-compose up --build -d

# Проверка логов
docker-compose logs -f
```

Приложение будет доступно по адресу: `http://localhost:3005`

### 4. Ручная установка (без Docker)

```bash
# Установка зависимостей
npm install

# Запуск приложения
npm start
```

## Структура проекта

```
margotv/
├── app.js              # Основной файл приложения
├── models/             # Модели MongoDB
├── public/            # Статические файлы
│   ├── videos/       # Директория для видео
│   ├── thumbnails/   # Директория для превью
│   └── subtitles/    # Директория для субтитров
├── views/             # Шаблоны EJS
├── Dockerfile         # Конфигурация Docker
├── docker-compose.yml # Конфигурация Docker Compose
└── nginx.conf         # Конфигурация Nginx
```

## Развертывание на сервере

### 1. Подготовка сервера

```bash
# Обновление системы
sudo apt update
sudo apt upgrade

# Установка Docker и Docker Compose
sudo apt install docker.io docker-compose

# Запуск и включение Docker
sudo systemctl start docker
sudo systemctl enable docker
```

### 2. Настройка файрвола

```bash
# Открываем порты
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3005/tcp
```

### 3. Клонирование и запуск

```bash
# Клонирование репозитория
git clone https://github.com/your-username/margotv.git
cd margotv

# Создание необходимых директорий
mkdir -p public/videos public/thumbnails public/subtitles uploads

# Настройка прав доступа
chmod -R 755 public
chmod -R 755 uploads

# Запуск приложения
docker-compose up --build -d
```

### 4. Настройка Nginx (опционально)

Если вы хотите использовать домен и SSL:

```bash
# Установка Nginx
sudo apt install nginx

# Установка Certbot для SSL
sudo apt install certbot python3-certbot-nginx

# Получение SSL сертификата
sudo certbot --nginx -d your-domain.com
```

## Обновление приложения

```bash
# Остановка контейнеров
docker-compose down

# Получение последних изменений
git pull

# Перезапуск с обновлением
docker-compose up --build -d
```

## Мониторинг и логи

```bash
# Просмотр логов всех контейнеров
docker-compose logs -f

# Просмотр логов конкретного сервиса
docker-compose logs -f app
docker-compose logs -f mongodb
docker-compose logs -f nginx
```

## Резервное копирование

### Бэкап MongoDB

```bash
# Создание бэкапа
docker-compose exec mongodb mongodump --out /backup/

# Восстановление из бэкапа
docker-compose exec mongodb mongorestore /backup/
```

### Бэкап файлов

```bash
# Бэкап видео и других файлов
tar -czf backup.tar.gz public/videos public/thumbnails public/subtitles
```

## Устранение неполадок

1. Если видео не воспроизводится:
   - Проверьте права доступа к файлам
   - Проверьте логи FFmpeg при конвертации
   - Убедитесь, что видео успешно сконвертировано

2. Если не работают субтитры:
   - Проверьте формат файла (должен быть SRT)
   - Проверьте кодировку файла (UTF-8)
   - Проверьте логи конвертации субтитров

3. Если не работает загрузка:
   - Проверьте права доступа к директориям
   - Проверьте свободное место на диске
   - Проверьте лимиты загрузки в Nginx

## Лицензия

MIT License

## Поддержка

При возникновении проблем создавайте issue в репозитории проекта. 