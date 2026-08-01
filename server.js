// server.js — бэкенд UMAR (использует storage.js)
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const storage = require('./storage');

const app = express();
const server = http.createServer(app);

// ========== НАСТРОЙКА CORS ==========
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.options('*', cors());

// ========== MIDDLEWARE ==========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// ========== НАСТРОЙКА MULTER ДЛЯ АВАТАРОВ ==========
const multerStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads/avatars';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}-${uuidv4()}${ext}`);
    }
});

const upload = multer({
    storage: multerStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Только изображения (JPEG, PNG, GIF, WEBP)'));
        }
    }
});

// ========== ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ ==========
(async () => {
    await storage.initDatabase();
    await storage.ensureMatvey();
    console.log('✅ База данных инициализирована');
})();

// ========== API ЭНДПОИНТЫ ==========

// === 1. РЕГИСТРАЦИЯ ===
app.post('/api/auth/register', upload.single('avatar'), async (req, res) => {
    try {
        const { username, password, name } = req.body;

        if (!username) return res.status(400).json({ error: 'Логин обязателен' });
        if (!password) return res.status(400).json({ error: 'Пароль обязателен' });
        if (!req.file) return res.status(400).json({ error: 'Аватар обязателен' });
        if (username.length < 3) return res.status(400).json({ error: 'Логин должен быть минимум 3 символа' });
        if (password.length < 6) return res.status(400).json({ error: 'Пароль должен быть минимум 6 символов' });

        const avatarPath = `/uploads/avatars/${req.file.filename}`;
        const user = await storage.createUser(username, password, name, avatarPath);

        console.log('✅ Пользователь создан:', user.id, user.username);
        res.json({ success: true, user });
    } catch (err) {
        console.error('❌ Ошибка регистрации:', err.message);
        if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Логин уже занят' });
        }
        res.status(500).json({ error: err.message });
    }
});

// === 2. ЛОГИН ===
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Логин и пароль обязательны' });
        }

        const user = await storage.loginUser(username, password);
        console.log('✅ Вход успешен:', user.id, user.username);
        res.json({ success: true, user });
    } catch (err) {
        console.error('❌ Ошибка входа:', err.message);
        res.status(400).json({ error: err.message });
    }
});

// === 3. ПОЛУЧЕНИЕ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ ===
app.get('/api/users', async (req, res) => {
    try {
        const users = await storage.getAllUsers();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === 4. ПОИСК ПОЛЬЗОВАТЕЛЕЙ ===
app.get('/api/users/search/:query', async (req, res) => {
    try {
        const { query } = req.params;
        const users = await storage.searchUsers(query);
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === 5. ПОЛУЧЕНИЕ ПРОФИЛЯ ===
app.get('/api/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await storage.getUserById(userId);
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === 6. ОБНОВЛЕНИЕ ПРОФИЛЯ ===
app.post('/api/users/profile', upload.single('avatar'), async (req, res) => {
    try {
        const { userId, name, bio } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId обязателен' });

        const data = { name, bio };
        if (req.file) {
            data.avatar = `/uploads/avatars/${req.file.filename}`;
        }

        const result = await storage.updateProfile(userId, data);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === 7. КОНТАКТЫ — ДОБАВЛЕНИЕ ===
app.post('/api/contacts', async (req, res) => {
    try {
        const { userId, contactId } = req.body;
        if (!userId || !contactId) {
            return res.status(400).json({ error: 'ID обязательны' });
        }

        const result = await storage.addContact(userId, contactId);
        console.log('✅ Контакт добавлен:', userId, '->', contactId);
        res.json(result);
    } catch (err) {
        console.error('❌ Ошибка добавления контакта:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// === 8. КОНТАКТЫ — ПОЛУЧЕНИЕ ===
app.get('/api/contacts/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const contacts = await storage.getContacts(userId);
        res.json(contacts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === 9. СОЗДАНИЕ ЧАТА ===
app.post('/api/chats', async (req, res) => {
    try {
        const { name, isGroup, members, creatorId, description } = req.body;
        if (!members || !members.length) {
            return res.status(400).json({ error: 'Участники обязательны' });
        }

        const result = await storage.createChat(name, isGroup, members, creatorId, description);
        console.log('✅ Чат создан:', result.chatId);
        res.json({ success: true, chatId: result.chatId });
    } catch (err) {
        console.error('❌ Ошибка создания чата:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// === 10. ПОЛУЧЕНИЕ ЧАТОВ ПОЛЬЗОВАТЕЛЯ ===
app.get('/api/chats/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const chats = await storage.getUserChats(userId);
        res.json(chats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === 11. ПОЛУЧЕНИЕ СООБЩЕНИЙ ===
app.get('/api/messages/:chatId', async (req, res) => {
    try {
        const { chatId } = req.params;
        const messages = await storage.getMessages(chatId);
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== SOCKET.IO ==========
const io = socketIO(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true
    }
});

const onlineUsers = new Set();

io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId;
    console.log('🔌 Пользователь подключился:', userId);

    if (userId) {
        onlineUsers.add(userId);
        storage.updateUserStatus(userId, true);
        io.emit('user_status', { userId, status: 'online' });
    }

    // === ОТПРАВКА СООБЩЕНИЯ ===
    socket.on('send_message', async (data) => {
        try {
            const { chatId, senderId, text, file, voice, replyTo } = data;
            console.log('💬 Сообщение от', senderId, 'в чат', chatId);

            // Сохраняем сообщение в БД
            const savedMsg = await storage.saveMessage(chatId, senderId, text, file, voice, replyTo);

            // Получаем участников чата
            const members = await storage.getChatMembers(chatId);

            // Отправляем всем участникам
            const messageData = {
                id: savedMsg.id,
                chatId: savedMsg.chatId,
                senderId: savedMsg.senderId,
                text: savedMsg.text,
                file: savedMsg.file,
                voice: savedMsg.voice,
                replyTo: savedMsg.replyTo,
                created_at: savedMsg.created_at
            };

            members.forEach(m => {
                if (m !== senderId) {
                    io.to(m).emit('new_message', messageData);
                }
            });

            // Отправляем обратно отправителю
            io.to(senderId).emit('message_sent', messageData);

        } catch (err) {
            console.error('❌ Ошибка отправки сообщения:', err.message);
            socket.emit('error', err.message);
        }
    });

    // === ПЕЧАТАЕТ ===
    socket.on('typing', ({ chatId, userId }) => {
        storage.getChatMembers(chatId).then(members => {
            members.forEach(m => {
                if (m !== userId) {
                    io.to(m).emit('user_typing', { chatId, userId });
                }
            });
        });
    });

    // === ОТКЛЮЧЕНИЕ ===
    socket.on('disconnect', () => {
        if (userId) {
            onlineUsers.delete(userId);
            storage.updateUserStatus(userId, false);
            io.emit('user_status', { userId, status: 'offline' });
            console.log('🔌 Пользователь отключился:', userId);
        }
    });
});

// ========== ЗАПУСК ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 UMAR сервер запущен на порту ${PORT}`);
    console.log(`📁 Папка uploads: ${__dirname}/uploads`);
    console.log(`📋 База данных: ${__dirname}/umar.db`);
    console.log(`🔗 API: http://localhost:${PORT}`);
});
