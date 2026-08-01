// server.js — бэкенд UMAR
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

// CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// Multer для аватаров
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
            cb(new Error('Только изображения'));
        }
    }
});

// Инициализация БД
(async () => {
    await storage.initDatabase();
    await storage.ensureMatvey();
    console.log('✅ База данных готова');
})();

// === API ===

// Регистрация
app.post('/api/auth/register', upload.single('avatar'), async (req, res) => {
    try {
        const { username, password, name } = req.body;
        if (!username || !password || !req.file) {
            return res.status(400).json({ error: 'Все поля обязательны' });
        }
        if (username.length < 3) return res.status(400).json({ error: 'Логин минимум 3 символа' });
        if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });

        const avatarPath = `/uploads/avatars/${req.file.filename}`;
        const user = await storage.createUser(username, password, name, avatarPath);
        console.log('✅ Создан пользователь:', user.id);
        res.json({ success: true, user });
    } catch (err) {
        console.error('❌ Ошибка регистрации:', err.message);
        if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Логин уже занят' });
        }
        res.status(500).json({ error: err.message });
    }
});

// Логин
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Логин и пароль обязательны' });
        }
        const user = await storage.loginUser(username, password);
        console.log('✅ Вход:', user.id);
        res.json({ success: true, user });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Получить всех пользователей
app.get('/api/users', async (req, res) => {
    try {
        const users = await storage.getAllUsers();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Поиск
app.get('/api/users/search/:query', async (req, res) => {
    try {
        const users = await storage.searchUsers(req.params.query);
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Профиль
app.get('/api/users/:userId', async (req, res) => {
    try {
        const user = await storage.getUserById(req.params.userId);
        if (!user) return res.status(404).json({ error: 'Не найден' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Контакты — добавить
app.post('/api/contacts', async (req, res) => {
    try {
        const { userId, contactId } = req.body;
        if (!userId || !contactId) {
            return res.status(400).json({ error: 'ID обязательны' });
        }
        await storage.addContact(userId, contactId);
        console.log('✅ Контакт добавлен:', userId, '->', contactId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Контакты — получить
app.get('/api/contacts/:userId', async (req, res) => {
    try {
        const contacts = await storage.getContacts(req.params.userId);
        res.json(contacts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Создать чат
app.post('/api/chats', async (req, res) => {
    try {
        const { name, isGroup, members, creatorId, description } = req.body;
        if (!members || !members.length) {
            return res.status(400).json({ error: 'Участники обязательны' });
        }
        const result = await storage.createChat(name, isGroup, members, creatorId, description);
        res.json({ success: true, chatId: result.chatId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Чаты пользователя
app.get('/api/chats/:userId', async (req, res) => {
    try {
        const chats = await storage.getUserChats(req.params.userId);
        res.json(chats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Сообщения чата
app.get('/api/messages/:chatId', async (req, res) => {
    try {
        const messages = await storage.getMessages(req.params.chatId);
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === SOCKET.IO ===
const io = socketIO(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

const onlineUsers = new Set();

io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId;
    console.log('🔌 Подключился:', userId);

    if (userId) {
        onlineUsers.add(userId);
        storage.updateUserStatus(userId, true);
        io.emit('user_status', { userId, status: 'online' });
    }

    socket.on('send_message', async (data) => {
        try {
            const { chatId, senderId, text, file, voice, replyTo } = data;
            const savedMsg = await storage.saveMessage(chatId, senderId, text, file, voice, replyTo);
            const members = await storage.getChatMembers(chatId);

            const msgData = {
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
                if (m !== senderId) io.to(m).emit('new_message', msgData);
            });
            io.to(senderId).emit('message_sent', msgData);
        } catch (err) {
            socket.emit('error', err.message);
        }
    });

    socket.on('typing', ({ chatId, userId }) => {
        storage.getChatMembers(chatId).then(members => {
            members.forEach(m => {
                if (m !== userId) io.to(m).emit('user_typing', { chatId, userId });
            });
        });
    });

    socket.on('disconnect', () => {
        if (userId) {
            onlineUsers.delete(userId);
            storage.updateUserStatus(userId, false);
            io.emit('user_status', { userId, status: 'offline' });
            console.log('🔌 Отключился:', userId);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер на порту ${PORT}`);
});
